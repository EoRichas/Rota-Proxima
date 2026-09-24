#!/usr/bin/env python3
"""Camada de produção para integridade de rota, localização legível e segurança HTTP."""

import re
import threading
import time
import urllib.parse

import server_sharepoint as production


rota = production.rota
rota.BUILD_ID = 'STATUS-LOCATION-SECURITY-2026-09-15'

_REVERSE_CACHE = {}
_REVERSE_CACHE_LOCK = threading.Lock()
_REVERSE_CACHE_TTL = 7 * 24 * 60 * 60
_ORIGINAL_AUDIT = rota.audit
_BASE_HANDLER = rota.AppHandler


def _reverse_geocode(lat, lng):
    """Converte a última coordenada em endereço aproximado, com cache e rate limit."""
    latitude = float(lat)
    longitude = float(lng)
    key = f'{latitude:.5f},{longitude:.5f}'
    now = time.monotonic()

    with _REVERSE_CACHE_LOCK:
        cached = _REVERSE_CACHE.get(key)
        if cached and cached[0] > now:
            return dict(cached[1])

    # Compartilha o limitador já utilizado pelo geocodificador do Rota Próxima.
    # O Nominatim público exige no máximo 1 requisição/s e cache local.
    with rota._NOMINATIM_LOCK:
        wait = 1.05 - (time.monotonic() - rota._NOMINATIM_LAST)
        if wait > 0:
            time.sleep(wait)
        try:
            query = urllib.parse.urlencode({
                'lat': f'{latitude:.7f}',
                'lon': f'{longitude:.7f}',
                'format': 'jsonv2',
                'zoom': 18,
                'addressdetails': 1,
                'layer': 'address',
                'accept-language': 'pt-BR',
            })
            data = rota.fetch_json(
                f'https://nominatim.openstreetmap.org/reverse?{query}',
                timeout=8,
                headers={'Accept-Language': 'pt-BR,pt;q=0.9'},
            )
        finally:
            rota._NOMINATIM_LAST = time.monotonic()

    address = (data or {}).get('address') or {}
    road = (
        address.get('road')
        or address.get('pedestrian')
        or address.get('residential')
        or address.get('path')
        or address.get('footway')
        or ''
    )
    house_number = str(address.get('house_number') or '').strip()
    street = road.strip()
    if street and house_number:
        street = f'{street}, {house_number}'

    district = (
        address.get('neighbourhood')
        or address.get('suburb')
        or address.get('city_district')
        or address.get('quarter')
        or ''
    ).strip()
    city = (
        address.get('city')
        or address.get('town')
        or address.get('municipality')
        or address.get('village')
        or ''
    ).strip()

    iso_code = ''
    for name, value in address.items():
        if str(name).startswith('ISO3166-2-') and str(value).upper().startswith('BR-'):
            iso_code = str(value).upper()
            break
    uf = iso_code.rsplit('-', 1)[-1] if '-' in iso_code else ''
    locality = f'{city}/{uf}' if city and uf else city or str(address.get('state') or '').strip()

    parts = [part for part in (street, district, locality) if part]
    label = ', '.join(parts)
    if not label:
        label = str((data or {}).get('display_name') or '').strip()
    if not label:
        raise ValueError('Endereço não identificado para esta coordenada')

    result = {
        'label': label,
        'approximate': True,
        'provider': 'OpenStreetMap Nominatim',
        'attribution': '© OpenStreetMap contributors',
    }
    with _REVERSE_CACHE_LOCK:
        _REVERSE_CACHE[key] = (now + _REVERSE_CACHE_TTL, dict(result))
        if len(_REVERSE_CACHE) > 2000:
            expired = [cache_key for cache_key, value in _REVERSE_CACHE.items() if value[0] <= now]
            for cache_key in expired:
                _REVERSE_CACHE.pop(cache_key, None)
    return result


def _audit_with_auto_finish(token, user, action, entity_type, entity_id, summary,
                            before=None, after=None, metadata=None):
    """Após a pesagem, finaliza de fato a rota se não houver mais pendências."""
    result = _ORIGINAL_AUDIT(
        token,
        user,
        action,
        entity_type,
        entity_id,
        summary,
        before,
        after,
        metadata,
    )
    if action == 'weighing' and entity_type == 'route' and entity_id is not None:
        try:
            route = rota.try_auto_finish_route(token, user, int(entity_id))
            if route and route.get('auto_finished'):
                print(f'[ROUTE INTEGRITY] Rota {entity_id} finalizada após a última pesagem')
        except Exception as exc:
            print(f'[ROUTE INTEGRITY WARNING] Rota {entity_id}: {type(exc).__name__}: {exc}')
    return result


rota.audit = _audit_with_auto_finish


class HardenedProductionHandler(_BASE_HANDLER):
    def common_security_headers(self):
        super().common_security_headers()
        self.send_header('X-Permitted-Cross-Domain-Policies', 'none')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')

    def api_get(self, path):
        if path == '/api/client-reset':
            body = b'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"><title>Rota Proxima - Reset</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f3f8f5;color:#163d2e;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:560px;padding:32px;text-align:center;background:#fff;border-radius:20px;box-shadow:0 18px 60px rgba(20,70,50,.12)}h1{margin:0 0 10px;font-size:24px}p{color:#5f756b;line-height:1.5}</style></head><body><div class="box"><h1>Atualizando o Rota Proxima...</h1><p>O cache antigo e o PWA estao sendo removidos. Voce sera redirecionado automaticamente.</p></div><script>try{localStorage.clear();sessionStorage.clear()}catch(e){};setTimeout(()=>location.replace('/?fresh=client-reset-20260916-1'),1200)</script></body></html>'''
            self.send_response(200)
            self.common_security_headers()
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Clear-Site-Data', '"cache", "storage"')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        match = re.fullmatch(r'/api/routes/(\d+)/last-location-address', path)
        if match:
            user = self.require_user(('admin', 'commercial_manager', 'quality'))
            if not user:
                return
            token = self.token()
            route_id = int(match.group(1))
            route = rota.first(rota.Supa.get('routes', token, {
                'id': f'eq.{route_id}',
                'select': 'id,status',
                'limit': '1',
            }))
            if not route:
                return self.send_json({'error': 'Rota não encontrada'}, 404)

            if user['role'] == 'quality' and route.get('status') != 'finished':
                return self.send_json({'error': 'Rota finalizada não encontrada'}, 404)

            rows = rota.Supa.get('driver_location_updates', token, {
                'route_id': f'eq.{route_id}',
                'select': 'accuracy_m,recorded_at,lat,lng',
                'order': 'recorded_at.desc',
                'limit': '1',
            }) or []
            if not rows:
                return self.send_json({
                    'route_status': route.get('status'),
                    'last_location': None,
                })

            location = rows[0]
            address = None
            try:
                address = _reverse_geocode(location.get('lat'), location.get('lng'))
            except Exception as exc:
                print(
                    f'[REVERSE GEOCODE WARNING] rota={route_id}: '
                    f'{type(exc).__name__}: {exc}'
                )

            return self.send_json({
                'route_status': route.get('status'),
                'last_location': {
                    'recorded_at': location.get('recorded_at'),
                    'accuracy_m': location.get('accuracy_m'),
                    'address': address,
                },
            })
        return super().api_get(path)

    def api_write(self, method, path):
        if method in ('POST', 'PUT', 'DELETE'):
            fetch_site = (self.headers.get('Sec-Fetch-Site') or '').strip().lower()
            if fetch_site == 'cross-site':
                return self.send_json({'error': 'Requisição entre sites bloqueada'}, 403)
        return super().api_write(method, path)


rota.AppHandler = HardenedProductionHandler


if __name__ == '__main__':
    print('[INTEGRIDADE] Encerramento após pesagem e endereço da última localização ativos')
    print('[SEGURANÇA] Proteções HTTP adicionais ativas')
    rota.main()
