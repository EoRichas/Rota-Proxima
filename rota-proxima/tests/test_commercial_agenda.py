import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dependency_stubs import install_optional_dependency_stubs
install_optional_dependency_stubs()
import server


def stop(id=1, owner='marcelo', date='2026-09-25', route_status='released'):
    return {'id': id, 'sequence': 1, 'status': 'pending', 'service_type': 'collection',
            'exact_time': '09:00:00', 'window_start': None, 'window_end': None,
            'pevs': {'id': id, 'name': 'PEV '+str(owner), 'city': 'Sorocaba', 'state': 'SP', 'commercial_owner_id': owner},
            'routes': {'id': id, 'name': 'Rota '+str(id), 'route_date': date, 'status': route_status},
            'internal_notes': 'não expor'}


class CommercialAgendaTests(unittest.TestCase):
    def handler(self, role='commercial', user_id='marcelo', query=None):
        h=server.AppHandler.__new__(server.AppHandler)
        h.require_user=lambda roles=None: {'id': user_id, 'role': role}
        h.token=lambda: 'user-token'
        h.query=lambda: query if query is not None else {'from':['2026-09-01'],'to':['2026-09-30']}
        h.send_json=lambda data,status=200,extra_headers=None:(status,data)
        return h

    def test_own_portfolio_even_when_another_commercial_is_requested(self):
        q={'from':['2026-09-01'],'to':['2026-09-30'],'commercial':['marcel'],'user_id':['marcel']}
        with patch.object(server.Supa,'get',return_value=[stop(),stop(2,'marcel')]) as get:
            status,data=self.handler(query=q).api_get('/api/agenda')
        self.assertEqual(200,status)
        self.assertEqual(['PEV marcelo'],[x['pev_name'] for x in data['items']])
        self.assertEqual('eq.marcelo',get.call_args.args[2]['pevs.commercial_owner_id'])
        self.assertEqual('user-token',get.call_args.args[1])

    def test_second_account_receives_only_its_pevs(self):
        with patch.object(server.Supa,'get',return_value=[stop(),stop(2,'marcel')]):
            _,data=self.handler(user_id='marcel').api_get('/api/agenda')
        self.assertEqual(['PEV marcel'],[x['pev_name'] for x in data['items']])

    def test_date_comes_from_route_without_depending_on_request_author(self):
        row=stop(date='2026-09-29')
        with patch.object(server.Supa,'get',return_value=[row]) as get:
            _,data=self.handler().api_get('/api/agenda')
        self.assertEqual('2026-09-29',data['items'][0]['route_date'])
        params=get.call_args.args[2]
        self.assertNotIn('requested_by',str(params))
        self.assertNotIn('scheduling_requests',params['select'])
        self.assertEqual('(route_date.gte.2026-09-01,route_date.lte.2026-09-30)',params['routes.and'])
        self.assertIn('routes!inner',params['select'])
        self.assertIn('pevs!inner',params['select'])

    def test_planned_released_active_and_finished_but_not_cancelled(self):
        rows=[stop(i+1,route_status=status) for i,status in enumerate(['draft','released','in_progress','finished','cancelled'])]
        with patch.object(server.Supa,'get',return_value=rows):
            _,data=self.handler().api_get('/api/agenda')
        self.assertEqual(['draft','released','in_progress','finished'],[x['route_status'] for x in data['items']])

    def test_outside_period_or_unowned_pevs_are_never_returned(self):
        rows=[stop(date='2026-10-01'),stop(2,owner=None),stop(3)]
        with patch.object(server.Supa,'get',return_value=rows):
            _,data=self.handler().api_get('/api/agenda')
        self.assertEqual([3],[x['id'] for x in data['items']])
        self.assertNotIn('internal_notes',data['items'][0])
        self.assertNotIn('commercial_owner_id',data['items'][0])

    def test_pagination_and_date_order(self):
        rows=[stop(i+1,date='2026-09-29') for i in range(500)]
        with patch.object(server.Supa,'get',side_effect=[rows,[stop(501,date='2026-09-10')]]) as get:
            _,data=self.handler().api_get('/api/agenda')
        self.assertEqual(501,len(data['items']))
        self.assertEqual(501,data['items'][0]['id'])
        self.assertEqual(['0','500'],[call.args[2]['offset'] for call in get.call_args_list])

    def test_invalid_periods_are_rejected_before_database_access(self):
        queries=[{}, {'from':['2026-09-25'],'to':['2026-09-01']},
                 {'from':['2026-02-30'],'to':['2026-09-30']},
                 {'from':['2025-01-01'],'to':['2026-09-30']},
                 {'from':['2026-9-1'],'to':['2026-09-30']}]
        with patch.object(server.Supa,'get') as get:
            for q in queries:
                with self.subTest(query=q):self.assertEqual(400,self.handler(query=q).api_get('/api/agenda')[0])
        get.assert_not_called()

    def test_other_roles_cannot_read_agenda(self):
        with patch.object(server.Supa,'get') as get:
            for role in ['admin','commercial_manager','quality','driver','production']:
                with self.subTest(role=role):self.assertEqual(403,self.handler(role).api_get('/api/agenda')[0])
        get.assert_not_called()

    def test_empty_portfolio(self):
        with patch.object(server.Supa,'get',return_value=[]):
            self.assertEqual((200,{'items':[]}),self.handler().api_get('/api/agenda'))

if __name__=='__main__':unittest.main()
