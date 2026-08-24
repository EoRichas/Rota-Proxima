import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class CommercialManagerPevTests(unittest.TestCase):
    def make_handler(self, role='commercial_manager', body=None):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.read_json = lambda: body or {
            'name': 'PEV cadastrado pelo gerente',
            'street': 'Rua das Flores',
            'number': '100',
            'city': 'Sorocaba',
            'state': 'SP',
            'commercial_owner_id': '00000000-0000-4000-8000-000000000123',
            'notes': 'não deve permanecer na PEV',
        }
        handler.require_user = lambda roles=None: {'id': 'manager-1', 'role': role}
        handler.token = lambda: 'manager-token'
        handler.send_json = lambda payload, status=200, extra_headers=None: (status, payload)
        return handler

    def test_manager_creates_pev_and_preserves_automatic_geocoding(self):
        handler = self.make_handler()
        coordinates = {
            'lat': -23.501,
            'lng': -47.455,
            'confirmed': False,
            'source': 'brasilapi_cep',
        }

        with (
            patch.object(server, 'geocode_address_detailed', return_value=coordinates),
            patch.object(server.Supa, 'rpc', return_value={'id': 42}) as rpc,
            patch.object(server.Supa, 'update') as update,
        ):
            status, body = handler.api_write('POST', '/api/pevs')

        self.assertEqual(201, status)
        self.assertEqual(42, body['id'])
        self.assertFalse(body['geocode']['confirmed'])
        payload = rpc.call_args.args[2]
        self.assertEqual('save_pev', rpc.call_args.args[0])
        self.assertEqual('manager-token', rpc.call_args.args[1])
        self.assertEqual('00000000-0000-4000-8000-000000000123', payload['p_data']['commercial_owner_id'])
        self.assertEqual(-23.501, payload['p_data']['lat'])
        self.assertEqual(-47.455, payload['p_data']['lng'])
        self.assertFalse(payload['p_data']['location_confirmed'])
        self.assertNotIn('notes', payload['p_data'])
        update.assert_not_called()

    def test_manager_creation_still_works_when_geocoder_is_unavailable(self):
        handler = self.make_handler()

        with (
            patch.object(server, 'geocode_address_detailed', side_effect=ValueError('CEP indisponível')),
            patch.object(server.Supa, 'rpc', return_value={'id': 43}),
            patch.object(server.Supa, 'update') as update,
        ):
            status, body = handler.api_write('POST', '/api/pevs')

        self.assertEqual((201, {'id': 43, 'geocode': None}), (status, body))
        update.assert_not_called()

    def test_driver_cannot_create_pevs(self):
        handler = self.make_handler(role='driver')

        with patch.object(server.Supa, 'rpc') as rpc:
            status, body = handler.api_write('POST', '/api/pevs')

        self.assertEqual(403, status)
        self.assertEqual('Sem permissão', body['error'])
        rpc.assert_not_called()

    def test_manager_cannot_edit_existing_pevs(self):
        handler = self.make_handler()

        with patch.object(server.Supa, 'rpc') as rpc:
            status, body = handler.api_write('PUT', '/api/pevs/42')

        self.assertEqual(403, status)
        self.assertEqual('Sem permissão', body['error'])
        rpc.assert_not_called()

    def test_interface_offers_creation_and_commercial_assignment_to_manager(self):
        source = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        list_start = source.index('async function renderPevs()')
        list_end = source.index('function drawPevList()', list_start)
        modal_start = source.index('async function openPevModal(pev=null)')
        modal_end = source.index('async function renderRequests()', modal_start)

        self.assertIn("['admin','commercial','commercial_manager'].includes(state.user.role)", source[list_start:list_end])
        self.assertIn("['admin','commercial_manager'].includes(state.user.role)", source[modal_start:modal_end])
        self.assertIn("api('/api/commercials')", source[modal_start:modal_end])
        self.assertIn('name="commercial_owner_id"', source[modal_start:modal_end])

    def test_database_migration_limits_manager_to_creating_owned_records(self):
        migrations = sorted((ROOT / 'supabase' / 'migrations').glob('*_commercial_manager_pev_access.sql'))
        self.assertTrue(migrations, 'A alteração de permissão precisa estar versionada como migração.')
        source = migrations[-1].read_text(encoding='utf-8')

        self.assertIn("v_role not in ('admin','commercial','commercial_manager')", source)
        self.assertIn("if v_role='commercial_manager' then raise exception", source)
        self.assertIn('alter policy pevs_insert', source.lower())
        self.assertIn('created_by = (select auth.uid())', source)
        self.assertIn("commercial_owner.role = 'commercial'", source)
        self.assertIn('commercial_owner.active = true', source)
        self.assertNotIn('security definer', source.lower())
        self.assertNotIn('alter policy pevs_update', source.lower())


if __name__ == '__main__':
    unittest.main()
