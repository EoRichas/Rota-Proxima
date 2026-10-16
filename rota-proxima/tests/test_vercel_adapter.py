import http.client
import importlib.util
import sys
import threading
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


class VercelAdapterTests(unittest.TestCase):
    def test_rewrite_routes_to_original_api_path(self):
        # The adapter loads the same handler chain used by Render/local entry points.
        import server
        original_handler=server.AppHandler
        original_finalize=server.finalize_evidence_upload
        original_upload=server.upload_evidence
        original_audit=server.audit
        original_report=server.collection_report_items
        original_build=server.BUILD_ID
        try:
            spec=importlib.util.spec_from_file_location('vercel_test',ROOT/'api'/'index.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            httpd=server.RotaHTTPServer(('127.0.0.1',0),module.handler)
            threading.Thread(target=httpd.serve_forever,daemon=True).start()
            connection=http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=5)
            try:
                connection.request('GET','/api/index?__rota_path=/api/health')
                response=connection.getresponse();raw=response.read()
                self.assertEqual(200,response.status)
                self.assertIn(b'"ok": true',raw)
            finally:
                connection.close();httpd.shutdown();httpd.server_close()
        finally:
            server.AppHandler=original_handler;server.finalize_evidence_upload=original_finalize
            server.upload_evidence=original_upload;server.audit=original_audit
            server.collection_report_items=original_report;server.BUILD_ID=original_build


if __name__=='__main__':unittest.main()
