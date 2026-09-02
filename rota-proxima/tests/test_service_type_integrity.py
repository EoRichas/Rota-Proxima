import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class ServiceTypeIntegrityTests(unittest.TestCase):
    def make_handler(self, body):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.read_json = lambda: body
        handler.require_user = lambda roles=None: {'id': 'admin-1', 'role': 'admin'}
        handler.token = lambda: 'admin-token'
        handler.send_json = lambda payload, status=200, extra_headers=None: (status, payload)
        return handler

    def test_route_creation_preserves_valid_service_types(self):
        handler = self.make_handler({
            'name': 'Rota mista',
            'route_date': '2026-09-02',
            'driver_id': '00000000-0000-4000-8000-000000000001',
            'stops': [
                {'pev_id': 10, 'service_type': 'collection'},
                {'pev_id': 11, 'service_type': 'delivery'},
            ],
        })

        with (
            patch.object(server, 'settings_origin', return_value={'lat': 0, 'lng': 0}),
            patch.object(server.Supa, 'rpc', return_value={'id': 99}) as rpc,
            patch.object(server, 'get_route_full', return_value={'id': 99, 'stops': []}),
        ):
            status, payload = handler.api_write('POST', '/api/routes')

        self.assertEqual(201, status)
        self.assertEqual(99, payload['id'])
        saved = rpc.call_args.args[2]['p_data']['stops']
        self.assertEqual(['collection', 'delivery'], [stop['service_type'] for stop in saved])

    def test_route_creation_rejects_an_unknown_service_type(self):
        handler = self.make_handler({
            'name': 'Rota inválida',
            'route_date': '2026-09-02',
            'driver_id': '00000000-0000-4000-8000-000000000001',
            'stops': [{'pev_id': 10, 'service_type': 'entrega'}],
        })

        with (
            patch.object(server, 'settings_origin', return_value={'lat': 0, 'lng': 0}),
            patch.object(server.Supa, 'rpc', return_value={'id': 99}) as rpc,
            patch.object(server, 'get_route_full', return_value={'id': 99, 'stops': []}),
        ):
            status, payload = handler.api_write('POST', '/api/routes')

        self.assertEqual(400, status)
        self.assertEqual('Tipo de atendimento inválido', payload['error'])
        rpc.assert_not_called()

    def test_production_requires_an_explicit_collection_type(self):
        route = {
            'stops': [
                {'id': 1, 'status': 'completed', 'service_type': 'collection'},
                {'id': 2, 'status': 'completed', 'service_type': 'delivery'},
                {'id': 3, 'status': 'completed'},
            ],
            'weighings': [],
        }

        self.assertEqual([1], [stop['id'] for stop in server.pending_production_weighings(route)])

    def test_production_queue_defensively_discards_deliveries(self):
        rows = [
            {
                'id': 1,
                'route_id': 10,
                'pev_id': 20,
                'sequence': 1,
                'completed_at': '2026-09-02T10:00:00+00:00',
                'service_type': 'delivery',
                'pevs': {'name': 'Entrega indevida', 'city': 'Sorocaba', 'state': 'SP'},
                'routes': {'id': 10, 'name': 'Rota 10', 'route_date': '2026-09-02', 'status': 'in_progress'},
            },
            {
                'id': 2,
                'route_id': 10,
                'pev_id': 21,
                'sequence': 2,
                'completed_at': '2026-09-02T10:05:00+00:00',
                'service_type': 'collection',
                'pevs': {'name': 'Coleta correta', 'city': 'Sorocaba', 'state': 'SP'},
                'routes': {'id': 10, 'name': 'Rota 10', 'route_date': '2026-09-02', 'status': 'in_progress'},
            },
        ]

        with patch.object(server.Supa, 'get', return_value=rows) as get:
            items = server.production_weighing_items('production-token')

        query = get.call_args.args[2]
        self.assertEqual('eq.collection', query['service_type'])
        self.assertIn('service_type', query['select'])
        self.assertEqual([2], [item['stop_id'] for item in items])
        self.assertEqual(['collection'], [item['service_type'] for item in items])

    def test_delivery_only_route_finishes_without_production(self):
        active = {
            'id': 10,
            'status': 'in_progress',
            'stops': [{'id': 1, 'status': 'completed', 'service_type': 'delivery'}],
            'weighings': [],
        }
        finished = {**active, 'status': 'finished'}

        with (
            patch.object(server, 'get_route_full', side_effect=[active, finished]),
            patch.object(server.Supa, 'update') as update,
            patch.object(server, 'audit'),
        ):
            result = server.try_auto_finish_route('token', {'id': 'driver-1'}, 10)

        self.assertEqual('finished', result['status'])
        update.assert_called_once()

    def test_sharepoint_health_exposes_the_current_render_build(self):
        source = (ROOT / 'server_sharepoint.py').read_text(encoding='utf-8')
        self.assertIn("'build': rota.BUILD_ID", source)
        self.assertNotIn("rota.BUILD_ID = 'SHAREPOINT-FOLDER-CONTEXT", source)


if __name__ == '__main__':
    unittest.main()
