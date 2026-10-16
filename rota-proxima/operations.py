"""Operational exports and manual route ordering. No privileged browser credentials."""
import server as rota

BACKUP_TABLES = (
    'settings', 'profiles', 'pevs', 'scheduling_requests', 'routes', 'route_stops',
    'route_weighings', 'route_evidences', 'driver_location_updates', 'audit_logs',
    'route_templates', 'route_template_pevs',
)


def evidence_download_link(token, evidence):
    path = str(evidence.get('storage_path') or '')
    if not evidence.get('storage_deleted_at'):
        response = rota.HTTP.post(
            f'{rota.SUPABASE_URL}/storage/v1/object/sign/rota-evidencias/{path}',
            headers=rota.Supa.headers(token), json={'expiresIn': 120}, timeout=15)
        if response.ok:
            value = response.json().get('signedURL') or response.json().get('signedUrl')
            if value:
                return value if value.startswith('https://') else f'{rota.SUPABASE_URL}/storage/v1{value}'
    if evidence.get('sharepoint_item_id'):
        import server_sharepoint
        upload_url = server_sharepoint.AZURE_FUNCTION_UPLOAD_URL
        if upload_url:
            url = upload_url.replace('/upload-rota-pev', '/evidence-download-link')
            response = rota.HTTP.post(url, json={'item_id': evidence['sharepoint_item_id']}, timeout=20)
            if response.ok:
                value = response.json().get('download_url')
                if value and value.startswith('https://'):
                    return value
    raise ValueError('Não foi possível obter a foto. Confira o Storage e a integração SharePoint; o backup não será marcado como completo.')


def backup_endpoint(handler, path, user, token, query):
    if user['role'] != 'admin':
        return handler.send_json({'error': 'Sem permissão'}, 403)
    if path == '/api/backup/manifest':
        schema = rota.BASE_DIR / 'supabase' / 'baseline.sql'
        return handler.send_json({
            'format_version': 2, 'exported_at': rota.now_iso(), 'tables': BACKUP_TABLES,
            'page_size': 250, 'schema_sql': schema.read_text() if schema.exists() else None,
            'schema_status': 'exported' if schema.exists() else 'authoritative_snapshot_pending',
            'migrations': [p.name for p in sorted((rota.BASE_DIR/'supabase'/'migrations').glob('*.sql'))],
            'scope': 'Dados operacionais e arquivos de evidências. Senhas, sessões e configuração dos provedores não são exportadas.',
        })
    if path.startswith('/api/backup/table/'):
        table = path.rsplit('/', 1)[-1]
        if table not in BACKUP_TABLES:
            return handler.send_json({'error': 'Tabela inválida'}, 400)
        offset = int((query.get('offset') or ['0'])[0])
        if offset < 0:
            raise ValueError('Página inválida')
        # Composite template membership has no guaranteed surrogate id.
        order = 'template_id.asc,pev_id.asc' if table == 'route_template_pevs' else 'id.asc'
        rows = rota.Supa.get(table, token, {'select': '*', 'order': order, 'limit': '250', 'offset': str(offset)})
        return handler.send_json({'items': rows, 'next_offset': offset+len(rows) if len(rows)==250 else None})
    if path.startswith('/api/backup/evidence/'):
        evidence_id = int(path.rsplit('/', 1)[-1])
        evidence = rota.first(rota.Supa.get('route_evidences', token, {'id': f'eq.{evidence_id}', 'select': '*', 'limit': '1'}))
        if not evidence:
            return handler.send_json({'error': 'Evidência não encontrada'}, 404)
        return handler.send_json({'url': evidence_download_link(token, evidence)})
    if path == '/api/backup':
        data = {}
        for table in BACKUP_TABLES:
            order = 'template_id.asc,pev_id.asc' if table=='route_template_pevs' else 'id.asc'
            data[table] = rota.Supa.get(table, token, {'select': '*', 'order': order})
        return handler.send_json({'format_version': 2, 'exported_at': rota.now_iso(), 'data': data,
                                  'files_included': False, 'archive_endpoint': '/api/backup/manifest'})
    return handler.send_json({'error': 'Endpoint não encontrado'}, 404)


def reorder_route(token, user, route_id, data):
    route = rota.get_route_full(token, route_id)
    if not route or (user['role']=='driver' and route['driver_id'] != user['id']):
        raise ValueError('Rota não encontrada ou sem permissão')
    if route['status'] not in ('released', 'in_progress') or (user['role']=='driver' and route['status']!='in_progress'):
        raise ValueError('A ordem só pode ser alterada em rota liberada ou em andamento.')
    pending = [s for s in route['stops'] if s['status']=='pending']
    expected = [int(s['id']) for s in pending]
    order = data.get('stop_ids')
    if not isinstance(order, list) or any(type(x) is not int for x in order) or len(order)!=len(expected) or set(order)!=set(expected):
        raise ValueError('Envie todas as paradas pendentes uma única vez. Atualize a rota e tente novamente.')
    if data.get('expected_ids') != expected:
        raise ValueError('A rota mudou em outro aparelho. Atualize antes de reordenar.')
    origin = route.get('last_location') if user['role']=='driver' else None
    if not origin:
        fixed = [s for s in route['stops'] if s['status']!='pending']
        origin = fixed[-1] if fixed else route['origin']
    if not origin or origin.get('lat') is None or origin.get('lng') is None:
        raise ValueError('Confirme as coordenadas da origem antes de ajustar a sequência.')
    points = [(float(origin['lat']), float(origin['lng']))]
    by_id = {int(s['id']):s for s in pending}
    for stop_id in order:
        stop = by_id[stop_id]
        if stop.get('lat') is None or stop.get('lng') is None:
            raise ValueError(f'Confirme as coordenadas de {stop.get("pev_name")}.')
        points.append((float(stop['lat']), float(stop['lng'])))
    distance, duration, _ = rota.osrm_matrix(points)
    slots = sorted(s['sequence'] for s in pending)
    updates = []
    for i, stop_id in enumerate(order, 1):
        metres = rota.routing.edge(distance, i-1, i)
        seconds = rota.routing.edge(duration, i-1, i)
        if not rota.math.isfinite(metres+seconds):
            raise ValueError('A sequência contém trecho sem trajeto pelas ruas.')
        updates.append({'id':stop_id, 'sequence':slots[i-1], 'planned_distance_m':metres, 'planned_duration_s':seconds})
    rota.Supa.rpc('reorder_pending_stops', token, {'p_route_id':route_id, 'p_expected_ids':expected, 'p_updates':updates})
    result = rota.get_route_full(token, route_id)
    result['schedule_warnings'] = rota.schedule_conflicts(result['stops'])
    return result
