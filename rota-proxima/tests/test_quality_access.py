import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dependency_stubs import install_optional_dependency_stubs
install_optional_dependency_stubs()
import server


class QualityAccessTests(unittest.TestCase):
    def handler(self, role='quality', body=None):
        h = server.AppHandler.__new__(server.AppHandler)
        h.require_user = lambda roles=None: {'id': 'quality-1', 'name': 'Qualidade', 'role': role}
        h.token = lambda: 'quality-token'
        h.query = lambda: {'from': ['2026-09-01'], 'to': ['2026-09-24']}
        h.read_json = lambda: body or {}
        h.send_json = lambda data, status=200, extra_headers=None: (status, data)
        h.send_bytes = lambda raw, content_type, filename=None: (200, raw)
        return h

    def test_history_query_only_returns_finished_routes_of_all_drivers(self):
        with patch.object(server.Supa, 'get', return_value=[]) as get:
            self.assertEqual((200, {'items': []}), self.handler().api_get('/api/routes'))
        params = get.call_args.args[2]
        self.assertEqual('eq.finished', params['status'])
        self.assertNotIn('driver_id', params)

    def test_quality_cannot_open_unfinished_route(self):
        with patch.object(server.Supa, 'get', return_value=[]), patch.object(server, 'get_route_full') as full:
            self.assertEqual(404, self.handler().api_get('/api/routes/1')[0])
        full.assert_not_called()

    def test_quality_can_open_finished_route(self):
        route = {'id': 1, 'status': 'finished'}
        with patch.object(server.Supa, 'get', return_value=[{'id': 1}]), patch.object(server, 'get_route_full', return_value=route):
            self.assertEqual((200, route), self.handler().api_get('/api/routes/1'))

    def test_other_modules_are_denied_without_fetching_data(self):
        with patch.object(server.Supa, 'get') as get, patch.object(server.Supa, 'rpc') as rpc:
            for path in ['/api/users', '/api/settings', '/api/backup', '/api/pevs', '/api/requests', '/api/drivers', '/api/commercials', '/api/dashboard', '/api/dashboard-pending', '/api/production-weighings']:
                with self.subTest(path=path):
                    self.assertEqual(403, self.handler().api_get(path)[0])
        get.assert_not_called()
        rpc.assert_not_called()

    def test_operational_writes_are_denied_before_any_mutation(self):
        with patch.object(server.Supa, 'req') as req, patch.object(server, 'edge') as edge:
            for method, path in [('POST', '/api/users'), ('PUT', '/api/users/quality-1'), ('DELETE', '/api/users/other'), ('POST', '/api/pevs'), ('PUT', '/api/pevs/1'), ('DELETE', '/api/pevs/1'), ('POST', '/api/routes'), ('DELETE', '/api/routes/1'), ('POST', '/api/routes/1/start'), ('POST', '/api/routes/1/recalculate'), ('POST', '/api/routes/1/location'), ('POST', '/api/routes/1/weighings'), ('POST', '/api/stops/1/arrive'), ('POST', '/api/stops/1/complete'), ('POST', '/api/stops/1/evidence'), ('POST', '/api/requests'), ('PUT', '/api/requests/1'), ('DELETE', '/api/requests/1'), ('PUT', '/api/settings'), ('POST', '/api/future-action')]:
                with self.subTest(method=method, path=path):
                    self.assertEqual(403, self.handler().api_write(method, path)[0])
        req.assert_not_called()
        edge.assert_not_called()

    def test_quality_can_change_own_password(self):
        with patch.object(server, 'edge', return_value={'ok': True}) as edge:
            self.assertEqual(200, self.handler().api_write('POST', '/api/change-password')[0])
        self.assertEqual('change-own-password', edge.call_args.args[0])

    def test_report_sees_all_portfolios_but_no_drafts(self):
        items = [
            {'id': 1, 'commercial_owner_id': 'a', 'route_status': 'finished'},
            {'id': 2, 'commercial_owner_id': 'b', 'route_status': 'in_progress'},
            {'id': 3, 'commercial_owner_id': 'a', 'route_status': 'draft'},
        ]
        with patch.object(server, 'collection_report_items', return_value=items):
            status, body = self.handler().api_get('/api/reports/collections')
        self.assertEqual(200, status)
        self.assertEqual([1, 2], [x['id'] for x in body['items']])

    def test_pdf_and_xlsx_keep_commercial_filter(self):
        for fmt in ['pdf', 'xlsx']:
            h = self.handler()
            h.query = lambda: {'from': ['2026-09-01'], 'to': ['2026-09-24'], 'commercial': ['b']}
            items = [{'commercial_owner_id': 'a', 'route_status': 'finished'}, {'commercial_owner_id': 'b', 'route_status': 'finished'}]
            with patch.object(server, 'collection_report_items', return_value=items), patch.object(server, 'commercial_portfolio_summary', return_value={}), patch.object(server, 'build_collections_' + fmt, return_value=b'export') as build:
                self.assertEqual((200, b'export'), h.api_get('/api/reports/collections/' + fmt))
            self.assertEqual([items[1]], build.call_args.args[0])
            self.assertTrue(build.call_args.args[3]['show_comparison'])

    def test_report_context_fetches_only_required_columns(self):
        with patch.object(server.Supa, 'get', side_effect=[[{'id': 'a', 'name': 'A'}], [{'id': 1, 'commercial_owner_id': 'a'}]]) as get:
            status, body = self.handler().api_get('/api/reports/collections/context')
        self.assertEqual(200, status)
        self.assertEqual({'commercials', 'pevs'}, set(body))
        self.assertEqual(['id,name', 'id,commercial_owner_id'], [call.args[2]['select'] for call in get.call_args_list])

    def test_admin_can_create_quality_account(self):
        with patch.object(server, 'edge', return_value={'id': 'new'}) as edge:
            self.assertEqual(201, self.handler('admin', {'role': 'quality'}).api_write('POST', '/api/users')[0])
        self.assertEqual('quality', edge.call_args.args[1]['role'])

    def test_driver_history_still_scoped_to_driver(self):
        with patch.object(server.Supa, 'get', return_value=[]) as get:
            self.handler('driver').api_get('/api/routes')
        self.assertEqual('eq.quality-1', get.call_args.args[2]['driver_id'])
        self.assertNotIn('status', get.call_args.args[2])


if __name__ == '__main__':
    unittest.main()
