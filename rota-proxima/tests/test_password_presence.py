import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class UserPresenceTests(unittest.TestCase):
    def setUp(self):
        server._USER_PRESENCE.clear()

    def tearDown(self):
        server._USER_PRESENCE.clear()

    def test_user_turns_offline_when_heartbeat_expires(self):
        server.mark_user_presence('user-1', 'device-1', now=100)

        self.assertTrue(server.user_is_online('user-1', now=189))
        self.assertFalse(server.user_is_online('user-1', now=190))

    def test_logout_removes_only_the_current_device(self):
        server.mark_user_presence('user-1', 'device-1', now=100)
        server.mark_user_presence('user-1', 'device-2', now=100)

        self.assertTrue(server.clear_device_presence('device-1'))
        self.assertTrue(server.user_is_online('user-1', now=101))
        self.assertTrue(server.clear_device_presence('device-2'))
        self.assertFalse(server.user_is_online('user-1', now=101))

    def test_presence_endpoint_marks_the_authenticated_device(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.headers = {'X-Rota-Device-ID': 'production-device-0001'}
        handler.current_user = lambda: {'id': 'production-1', 'role': 'production'}
        handler.send_json = lambda body, status=200, extra_headers=None: (status, body)

        status, body = handler.api_get('/api/presence')

        self.assertEqual(200, status)
        self.assertTrue(body['online'])
        self.assertTrue(server.user_is_online('production-1'))

    def test_admin_user_list_distinguishes_online_from_account_activation(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.require_user = lambda roles=None: {'id': 'admin-1', 'role': 'admin'}
        handler.token = lambda: 'admin-token'
        handler.query = lambda: {}
        handler.send_json = lambda body, status=200, extra_headers=None: (status, body)
        profiles = [
            {'id': 'online-1', 'active': True},
            {'id': 'offline-1', 'active': True},
            {'id': 'disabled-1', 'active': False},
        ]
        server.mark_user_presence('online-1', 'device-online-1')
        server.mark_user_presence('disabled-1', 'device-disabled-1')

        with patch.object(server.Supa, 'get', return_value=profiles):
            status, body = handler.api_get('/api/users')

        self.assertEqual(200, status)
        self.assertEqual([True, False, False], [item['online'] for item in body['items']])


class PasswordChangeTests(unittest.TestCase):
    def test_password_change_invalidates_the_cached_profile(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.read_json = lambda: {'current_password': 'temporaria-1', 'new_password': 'definitiva-2'}
        handler.require_user = lambda roles=None: {'id': 'user-1', 'role': 'commercial'}
        handler.token = lambda: 'access-token-1'
        handler.send_json = lambda body, status=200, extra_headers=None: (status, body)
        server._AUTH_CACHE['access-token-1'] = (999999999, {'must_change_password': True})

        try:
            with patch.object(server, 'edge', return_value={'ok': True}) as edge:
                status, body = handler.api_write('POST', '/api/change-password')
                cache_was_cleared = 'access-token-1' not in server._AUTH_CACHE
        finally:
            server._AUTH_CACHE.pop('access-token-1', None)

        self.assertEqual((200, {'ok': True}), (status, body))
        edge.assert_called_once_with(
            'change-own-password',
            {'current_password': 'temporaria-1', 'new_password': 'definitiva-2'},
            'access-token-1',
        )
        self.assertTrue(cache_was_cleared)

    def test_interface_defines_and_requires_the_password_modal(self):
        source = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')

        self.assertIn('function openPasswordModal(required=false)', source)
        self.assertIn("dlg.addEventListener('cancel',preventCancel)", source)
        self.assertIn("api('/api/change-password'", source)
        self.assertIn('values.new_password!==values.confirm_password', source)

    def test_interface_refreshes_presence_and_renders_discord_style_dots(self):
        source = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        styles = (ROOT / 'static' / 'styles.css').read_text(encoding='utf-8')

        self.assertIn("api('/api/presence'", source)
        self.assertIn("presence-dot ${u.online?'online':'offline'}", source)
        self.assertIn('background: #23a55a', styles)
        self.assertIn('background: #80848e', styles)


if __name__ == '__main__':
    unittest.main()
