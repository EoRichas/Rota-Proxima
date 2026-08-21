import ast
import gzip
import http.client
import sys
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class RenderPerformanceTests(unittest.TestCase):
    def test_unused_leaflet_is_not_on_the_critical_path(self):
        html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        app = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertNotIn('unpkg.com/leaflet', html)
        self.assertNotIn('map: null', app)

    def test_reportlab_is_lazy_loaded(self):
        tree = ast.parse((ROOT / 'server.py').read_text(encoding='utf-8'))
        top_level_imports = [
            alias.name
            for node in tree.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names
        ]
        self.assertFalse(any(name.startswith('reportlab') for name in top_level_imports))
        self.assertFalse(any(name.startswith('xlsxwriter') for name in top_level_imports))

    def test_repeat_visits_use_cached_application_shell(self):
        worker = (ROOT / 'static' / 'service-worker.js').read_text(encoding='utf-8')
        self.assertIn("caches.match(e.request,{ignoreSearch:true})", worker)
        self.assertIn("e.request.mode==='navigate'", worker)
        self.assertIn("caches.match('/index.html')", worker)

    def test_refresh_token_is_not_requested_twice_in_sequence(self):
        backend = (ROOT / 'server.py').read_text(encoding='utf-8')
        block = backend[backend.index('if not access and refresh:'):backend.index('if not access:return None')]
        self.assertEqual(block.count('self.refresh(refresh)'), 1)

    def test_versioned_assets_are_compressed_and_revalidated(self):
        httpd = server.RotaHTTPServer(('127.0.0.1', 0), server.AppHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=5)
        try:
            connection.request('GET', '/app.js?v=performance', headers={'Accept-Encoding': 'gzip'})
            response = connection.getresponse()
            body = response.read()
            etag = response.getheader('ETag')
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader('Content-Encoding'), 'gzip')
            self.assertEqual(response.getheader('Cache-Control'), 'public, max-age=31536000, immutable')
            self.assertIn(b'const state', gzip.decompress(body))
            self.assertTrue(etag)

            connection.request('GET', '/app.js?v=performance', headers={'If-None-Match': etag})
            cached = connection.getresponse()
            cached.read()
            self.assertEqual(cached.status, 304)
        finally:
            connection.close()
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
