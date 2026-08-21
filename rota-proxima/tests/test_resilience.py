import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class SupabaseResilienceTests(unittest.TestCase):
    def setUp(self):
        server._REFRESH_RESULT_CACHE.clear()

    def test_refresh_timeout_becomes_safe_503_without_retry(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        error = server.requests.Timeout(
            "HTTPSConnectionPool(host='example.supabase.co'): Read timed out."
        )
        output = io.StringIO()
        with patch.object(server, 'stateless_post', side_effect=error) as post:
            with contextlib.redirect_stdout(output):
                with self.assertRaises(server.SupaHTTPError) as raised:
                    handler.refresh('refresh-token-secreto')
        self.assertEqual(503, raised.exception.status)
        self.assertEqual(server.AUTH_REFRESH_UNAVAILABLE_MESSAGE, raised.exception.public_message)
        self.assertNotIn('supabase.co', raised.exception.public_message)
        self.assertEqual(1, post.call_count)
        self.assertEqual(server.SUPABASE_HTTP_TIMEOUT, post.call_args.kwargs['timeout'])

    def test_data_api_network_error_becomes_safe_503(self):
        error = server.requests.ConnectionError('falha de conexão com host interno')
        with patch.object(server.HTTP, 'request', side_effect=error, create=True):
            with self.assertRaises(server.SupaHTTPError) as raised:
                server.Supa.get('profiles', 'access-token', {'select': 'id'})
        self.assertEqual(503, raised.exception.status)
        self.assertEqual(server.SUPABASE_UNAVAILABLE_MESSAGE, raised.exception.public_message)
        self.assertNotIn('host interno', raised.exception.public_message)

    def test_api_get_preserves_temporary_failure_status(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.current_user = lambda: (_ for _ in ()).throw(
            server.SupaHTTPError(503, 'detalhe interno', server.AUTH_REFRESH_UNAVAILABLE_MESSAGE)
        )
        handler.send_json = lambda body, status=200, extra_headers=None: (status, body)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status, body = handler.api_get('/api/me')
        self.assertEqual(503, status)
        self.assertEqual(server.AUTH_REFRESH_UNAVAILABLE_MESSAGE, body['error'])
        self.assertNotIn('detalhe interno', body['error'])


if __name__ == '__main__':
    unittest.main()
