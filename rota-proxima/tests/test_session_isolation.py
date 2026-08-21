import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


def handler_for(body=None):
    handler = server.AppHandler.__new__(server.AppHandler)
    handler.headers = {}
    handler.read_json = lambda: dict(body or {})
    handler.send_json = lambda value, status=200, extra_headers=None: (status, value)
    return handler


class SessionIsolationTests(unittest.TestCase):
    def test_login_binds_auth_cookies_to_the_requesting_device(self):
        handler = handler_for({'username': 'producao', 'password': 'senha-producao'})
        handler.headers = {'X-Rota-Device-ID': 'device-production-0001'}
        response = {
            'access_token': 'access-production',
            'refresh_token': 'refresh-production',
            'user': {'id': 'production-id', 'role': 'production'},
        }

        with patch.object(server, 'edge', return_value=response):
            handler.api_write('POST', '/api/login')

        cookies = '\n'.join(value for name, value in handler.pending_headers if name == 'Set-Cookie')
        self.assertIn('rota_device=device-production-0001', cookies)

    def test_cookie_from_another_device_is_rejected_before_auth_lookup(self):
        handler = handler_for()
        handler.headers = {'X-Rota-Device-ID': 'device-production-0001'}
        handler.cookies = lambda: {
            'rota_access': 'access-driver',
            'rota_refresh': 'refresh-driver',
            'rota_device': 'device-driver-0000001',
        }

        with patch.object(server.Supa, 'rpc') as rpc:
            user = handler.current_user()

        self.assertIsNone(user)
        rpc.assert_not_called()
        cleared = '\n'.join(value for name, value in handler.pending_headers if name == 'Set-Cookie')
        self.assertIn('rota_access=;', cleared)
        self.assertIn('rota_refresh=;', cleared)
        self.assertIn('rota_device=;', cleared)

    def test_pwa_checks_the_expected_user_and_sends_device_id(self):
        source = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        worker = (ROOT / 'static' / 'service-worker.js').read_text(encoding='utf-8')
        self.assertIn("'X-Rota-Device-ID':DEVICE_ID", source)
        self.assertIn('expectedUser !== String(me.user.id)', source)
        self.assertIn('rota-proxima-device-session-20260821-v2', worker)

    def test_two_logins_keep_independent_cookie_pairs(self):
        production = handler_for({'username': 'producao', 'password': 'senha-producao'})
        driver = handler_for({'username': 'motorista', 'password': 'senha-motorista'})
        responses = [
            {
                'access_token': 'access-production',
                'refresh_token': 'refresh-production',
                'user': {'id': 'production-id', 'role': 'production'},
            },
            {
                'access_token': 'access-driver',
                'refresh_token': 'refresh-driver',
                'user': {'id': 'driver-id', 'role': 'driver'},
            },
        ]

        with patch.object(server, 'edge', side_effect=responses):
            production.api_write('POST', '/api/login')
            driver.api_write('POST', '/api/login')

        production_cookies = '\n'.join(value for name, value in production.pending_headers if name == 'Set-Cookie')
        driver_cookies = '\n'.join(value for name, value in driver.pending_headers if name == 'Set-Cookie')
        self.assertIn('access-production', production_cookies)
        self.assertIn('refresh-production', production_cookies)
        self.assertNotIn('driver', production_cookies)
        self.assertIn('access-driver', driver_cookies)
        self.assertIn('refresh-driver', driver_cookies)
        self.assertNotIn('production', driver_cookies)

    def test_logout_revokes_only_the_current_supabase_session(self):
        handler = handler_for()
        handler.auth_tokens = lambda: ('current-access-token', 'current-refresh-token')
        cleared = []
        handler.clear_auth_headers = lambda: cleared.append(True)

        with patch.object(server, 'stateless_post') as post:
            status, body = handler.api_write('POST', '/api/logout')

        self.assertEqual((200, {'ok': True}), (status, body))
        self.assertEqual([True], cleared)
        self.assertEqual(f'{server.AUTH}/logout?scope=local', post.call_args.args[0])
        self.assertEqual('Bearer current-access-token', post.call_args.kwargs['headers']['Authorization'])

    def test_edge_function_uses_a_fresh_auth_client_per_operation(self):
        source = (ROOT / 'supabase' / 'functions' / 'rota-admin' / 'index.ts').read_text(encoding='utf-8')
        self.assertNotIn('const anon = createClient', source)
        self.assertIn('const createAuthClient = () => createClient', source)
        self.assertEqual(2, source.count('createAuthClient().auth.signInWithPassword'))


if __name__ == '__main__':
    unittest.main()
