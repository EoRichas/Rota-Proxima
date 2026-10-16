"""Vercel Python function. Rewrites retain the original /api/... path."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server_final


class handler(server_final.rota.AppHandler):
    def route_path(self):
        from urllib.parse import urlparse,parse_qs
        value=(parse_qs(urlparse(self.path).query).get('__rota_path') or [''])[0]
        return value if value.startswith('/api/') else super().route_path()
