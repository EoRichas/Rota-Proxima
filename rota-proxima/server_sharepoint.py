#!/usr/bin/env python3
"""Integração de produção: Supabase como contingência e Azure/SharePoint como destino."""

import base64
import hashlib
import os
import re
import threading
import time

import server as rota


AZURE_FUNCTION_UPLOAD_URL = os.environ.get('AZURE_FUNCTION_UPLOAD_URL', '').strip()
BUCKET = 'rota-evidencias'
_ORIGINAL_UPLOAD = rota.upload_evidence


def _decode_image_data(data_url):
    value = str(data_url or '')
    if ',' not in value:
        raise ValueError('Envie uma foto válida')
    header, payload = value.split(',', 1)
    image_formats = {
        'data:image/jpeg;base64': 'jpg',
        'data:image/png;base64': 'png',
        'data:image/webp;base64': 'webp',
    }
    ext = image_formats.get(header.lower())
    if not ext:
        raise ValueError('Formato de foto inválido')
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise ValueError('Conteúdo da foto inválido') from exc
    if not raw or len(raw) > 8 * 1024 * 1024:
        raise ValueError('A foto deve ter no máximo 8 MB')
    valid_signature = (
        (ext == 'jpg' and raw.startswith(b'\xff\xd8\xff'))
        or (ext == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n'))
        or (ext == 'webp' and len(raw) >= 12 and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP')
    )
    if not valid_signature:
        raise ValueError('Conteúdo da foto inválido')
    return payload, raw, ext


def _evidence_context(token, path_prefix):
    match = re.fullmatch(r'rota-(\d+)/pev-(\d+)/([^/]+)', str(path_prefix or '').strip())
    if not match:
        raise ValueError('Destino da evidência inválido')
    route_id = int(match.group(1))
    pev_id = int(match.group(2))
    evidence_type = match.group(3)
    route = rota.first(rota.Supa.get('routes', token, {
        'id': f'eq.{route_id}',
        'select': 'id,name,route_date',
        'limit': '1',
    })) or {}
    pev = rota.first(rota.Supa.get('pevs', token, {
        'id': f'eq.{pev_id}',
        'select': 'id,name',
        'limit': '1',
    })) or {}
    parts = str(route.get('route_date') or '').split('-')
    year = parts[0] if len(parts) >= 2 and parts[0].isdigit() else None
    month = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else None
    return {
        'route_id': route_id,
        'route_name': route.get('name') or f'Rota {route_id}',
        'pev_id': pev_id,
        'pev_name': pev.get('name') or f'PEV {pev_id}',
        'evidence_type': evidence_type,
        'year': year,
        'month': month,
    }


def _sharepoint_filename(evidence_type, raw, ext):
    prefix = {
        'collection_material': 'material',
        'delivery_drum_location': 'tambor-local',
        'stop_location': 'local',
        'drum': 'tambor',
        'weighing_scale': 'balanca',
    }.get(evidence_type, 'foto')
    digest = hashlib.sha256(raw).hexdigest()
    return f'{prefix}_{digest[:20]}.{ext}', digest


def _upload_to_sharepoint(token, data_url, path_prefix):
    content_base64, raw, ext = _decode_image_data(data_url)
    context = _evidence_context(token, path_prefix)
    filename, digest = _sharepoint_filename(context['evidence_type'], raw, ext)
    body = {
        'route_id': context['route_id'],
        'route_name': context['route_name'],
        'pev_id': context['pev_id'],
        'pev_name': context['pev_name'],
        'evidence_type': context['evidence_type'],
        'filename': filename,
        'content_base64': content_base64,
    }
    if context['year']:
        body['year'] = context['year']
    if context['month']:
        body['month'] = context['month']
    response = rota.HTTP.post(AZURE_FUNCTION_UPLOAD_URL, json=body, timeout=30)
    try:
        data = response.json()
    except Exception:
        data = {}
    if not response.ok or not data.get('ok'):
        detail = str(data.get('error') or response.text or f'HTTP {response.status_code}').strip()
        raise RuntimeError(f'Falha ao salvar foto no SharePoint: {detail[:700]}')
    return context, digest, data


def _find_evidence(token, storage_path):
    for _ in range(20):
        rows = rota.Supa.get('route_evidences', token, {
            'storage_path': f'eq.{storage_path}',
            'select': 'id,storage_path,sharepoint_status',
            'limit': '1',
        }) or []
        if rows:
            return rows[0]
        time.sleep(.25)
    return None


def _mark_sync(token, evidence_id, status=None, data=None, error=None, storage_deleted_at=None):
    data = data or {}
    return rota.Supa.rpc('update_own_evidence_sync', token, {
        'p_evidence_id': evidence_id,
        'p_status': status,
        'p_item_id': data.get('id'),
        'p_url': data.get('webUrl'),
        'p_path': data.get('folder'),
        'p_sha256': data.get('sha256'),
        'p_synced_at': rota.now_iso() if status == 'synced' else None,
        'p_last_error': str(error)[:1000] if error else None,
        'p_storage_deleted_at': storage_deleted_at,
    })


def _delete_supabase_object(token, storage_path):
    response = rota.HTTP.delete(
        f'{rota.SUPABASE_URL}/storage/v1/object/{BUCKET}',
        headers={
            'apikey': rota.SUPABASE_KEY,
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        json={'prefixes': [storage_path]},
        timeout=30,
    )
    if not response.ok:
        try:
            detail = response.json().get('message') or response.json().get('error') or response.text
        except Exception:
            detail = response.text
        raise RuntimeError(detail or f'Falha ao limpar Storage: HTTP {response.status_code}')


def _sync_after_insert(token, storage_path, data_url, path_prefix):
    evidence = _find_evidence(token, storage_path)
    if not evidence:
        print(f'[SHAREPOINT] Evidência ainda pendente; registro não localizado: {storage_path}')
        return
    evidence_id = int(evidence['id'])
    try:
        _mark_sync(token, evidence_id, status='syncing')
        context, digest, sharepoint_data = _upload_to_sharepoint(token, data_url, path_prefix)
        sharepoint_data['sha256'] = digest
        _mark_sync(token, evidence_id, status='synced', data=sharepoint_data)
        print(
            f"[SHAREPOINT] Evidência sincronizada: id={evidence_id} "
            f"rota={context['route_id']} pev={context['pev_id']}"
        )
    except Exception as exc:
        try:
            _mark_sync(token, evidence_id, status='error', error=exc)
        except Exception as mark_exc:
            print(f'[SHAREPOINT] Falha ao registrar erro da evidência {evidence_id}: {mark_exc}')
        print(f'[SHAREPOINT] Evidência {evidence_id} mantida no Supabase: {exc}')
        return

    try:
        _delete_supabase_object(token, storage_path)
        _mark_sync(token, evidence_id, storage_deleted_at=rota.now_iso())
    except Exception as exc:
        # A foto já está confirmada no SharePoint. Mantemos a cópia de contingência
        # para uma limpeza posterior, sem alterar o status de sincronização.
        print(f'[SHAREPOINT] Limpeza pendente para evidência {evidence_id}: {exc}')


def upload_evidence(token, data_url, path_prefix):
    # Somente novos uploads deste ambiente entram no bucket e na fila de produção.
    storage_path = _ORIGINAL_UPLOAD(token, data_url, path_prefix)
    if not AZURE_FUNCTION_UPLOAD_URL:
        return storage_path
    threading.Thread(
        target=_sync_after_insert,
        args=(token, storage_path, data_url, path_prefix),
        daemon=True,
    ).start()
    return storage_path


class SharePointHandler(rota.AppHandler):
    def api_get(self, path):
        if path == '/api/health':
            return self.send_json({
                'ok': True,
                'build': 'SHAREPOINT-PWA-DEVICE-SESSION-2026-08-21',
                'listen': f'{rota.HOST}:{rota.PORT}',
                'render': rota.IS_RENDER,
                'external_url': os.environ.get('RENDER_EXTERNAL_URL', ''),
                'sharepoint_upload_configured': bool(AZURE_FUNCTION_UPLOAD_URL),
                'evidence_storage': 'supabase-contingency-sharepoint-destination',
            })
        return super().api_get(path)


rota.upload_evidence = upload_evidence
rota.AppHandler = SharePointHandler
rota.BUILD_ID = 'SHAREPOINT-PWA-DEVICE-SESSION-2026-08-21'


if __name__ == '__main__':
    print('[SHAREPOINT] Novas evidências serão enviadas ao SharePoint quando a URL estiver configurada')
    print('[SUPABASE] Bucket de produção mantido como fila e contingência')
    rota.main()
