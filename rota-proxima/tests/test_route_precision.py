import itertools
import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import routing
import server
import operations


class RoutingTests(unittest.TestCase):
    def test_directed_open_tour_matches_exhaustive_best(self):
        duration=[[0,10,12,20,30],[50,0,40,8,25],[20,4,0,30,9],[20,40,3,0,6],[10,8,15,7,0]]
        distance=[[x*12 for x in row] for row in duration]
        order,_=routing.optimize(distance,duration)
        best=min(itertools.permutations(range(1,5)),key=lambda path:routing.score(path,distance,duration,480,{}, {},10,{}))
        self.assertEqual(routing.score(best,distance,duration,480,{}, {},10,{}),routing.score(order,distance,duration,480,{}, {},10,{}))

    def test_missing_road_cannot_become_free(self):
        self.assertTrue(math.isinf(server.route_cost([1],[[0,None],[None,0]],{})))
        with self.assertRaisesRegex(ValueError,'sem trajeto'):
            routing.optimize([[0,None],[None,0]],[[0,None],[None,0]])

    def test_road_service_failure_has_no_straight_line_fallback(self):
        with patch.object(server,'fetch_json',side_effect=server.requests.ConnectionError('offline')):
            with self.assertRaises(server.SupaHTTPError):server.osrm_matrix([(-23,-47),(-23.1,-47.1)])

    def test_service_time_is_included_in_appointment_arrival(self):
        duration=[[0,60,60],[60,0,60],[60,60,0]]
        order,warnings=routing.optimize(duration,duration,exact_times={2:'08:05'},start_minute=480,service_minutes=10)
        self.assertEqual(2,order[0]);self.assertEqual([],warnings)

    def test_far_road_snap_requires_coordinate_review(self):
        result={'code':'Ok','distances':[[0,1],[1,0]],'durations':[[0,1],[1,0]],'sources':[{'distance':600},{'distance':0}]}
        with patch.object(server,'fetch_json',return_value=result):
            with self.assertRaisesRegex(ValueError,'300 m'):server.osrm_matrix([(-23,-47),(-23.1,-47.1)])


class PaginationTests(unittest.TestCase):
    def test_all_pages_are_returned_beyond_the_api_limit(self):
        pages=[[{'id':x} for x in range(500)],[{'id':x} for x in range(500,1000)],[{'id':1000}]]
        with patch.object(server.Supa,'req',side_effect=pages) as req:
            rows=server.Supa.get('route_stops','token',{'select':'id'})
        self.assertEqual(1001,len(rows))
        self.assertEqual(['0','500','1000'],[call.kwargs['params']['offset'] for call in req.call_args_list])

    def test_explicit_single_row_limit_does_not_expand_query(self):
        with patch.object(server.Supa,'req',return_value=[{'id':1}]) as req:
            server.Supa.get('routes','token',{'limit':'1'})
        req.assert_called_once()

    def test_report_batches_large_route_id_lists(self):
        routes=[{'id':x,'route_date':'2026-10-16'} for x in range(205)]
        calls=[]
        def get(table,token,params):
            calls.append((table,params));return routes if table=='routes' else []
        with patch.object(server.Supa,'get',side_effect=get):server.collection_report_items('token','2026-10-01','2026-10-16')
        self.assertEqual(3,len([table for table,_ in calls if table=='route_stops']))


class ReorderTests(unittest.TestCase):
    def test_admin_and_assigned_driver_use_named_reorder_contract(self):
        route={'driver_id':'driver','status':'in_progress','origin':{'lat':-23,'lng':-47},
               'stops':[{'id':2,'status':'pending','sequence':1,'lat':-23.1,'lng':-47.1},
                        {'id':3,'status':'pending','sequence':2,'lat':-23.2,'lng':-47.2}]}
        matrix=[[0,10,20],[10,0,30],[20,30,0]]
        for user in ({'id':'admin','role':'admin'},{'id':'driver','role':'driver'}):
            with self.subTest(role=user['role']),patch.object(server,'get_route_full',return_value=route),patch.object(server,'osrm_matrix',return_value=(matrix,matrix,'osrm')),patch.object(server.Supa,'rpc') as rpc:
                operations.reorder_route('token',user,1,{'stop_ids':[3,2],'expected_ids':[2,3]})
                name,token,payload=rpc.call_args.args
                self.assertEqual('reorder_pending_stops',name)
                self.assertEqual({'p_route_id','p_expected_ids','p_updates'},set(payload))
                self.assertEqual([3,2],[stop['id'] for stop in payload['p_updates']])

    def test_driver_cannot_reorder_another_drivers_route(self):
        with patch.object(server,'get_route_full',return_value={'driver_id':'other'}),patch.object(server.Supa,'rpc') as rpc:
            with self.assertRaisesRegex(ValueError,'sem permissão'):operations.reorder_route('token',{'id':'me','role':'driver'},1,{})
        rpc.assert_not_called()

    def test_completed_stop_is_rejected_and_never_sent_to_rpc(self):
        route={'driver_id':'me','status':'in_progress','stops':[{'id':1,'status':'completed'},{'id':2,'status':'pending'}]}
        with patch.object(server,'get_route_full',return_value=route),patch.object(server.Supa,'rpc') as rpc:
            with self.assertRaises(ValueError):operations.reorder_route('token',{'id':'me','role':'driver'},1,{'stop_ids':[1,2],'expected_ids':[2]})
        rpc.assert_not_called()

    def test_stale_order_is_rejected_before_calculating(self):
        route={'driver_id':'me','status':'in_progress','stops':[{'id':2,'status':'pending'},{'id':3,'status':'pending'}]}
        with patch.object(server,'get_route_full',return_value=route),patch.object(server,'osrm_matrix') as matrix:
            with self.assertRaisesRegex(ValueError,'outro aparelho'):operations.reorder_route('token',{'id':'me','role':'driver'},1,{'stop_ids':[3,2],'expected_ids':[3,2]})
        matrix.assert_not_called()


class BackupTests(unittest.TestCase):
    def test_backup_includes_weighing_evidence_and_location_tables(self):
        self.assertTrue({'route_weighings','route_evidences','driver_location_updates'}.issubset(operations.BACKUP_TABLES))

    def test_non_admin_cannot_download_evidence_link(self):
        handler=type('H',(),{'send_json':lambda self,body,status=200:(status,body)})()
        with patch.object(server.Supa,'get') as get:
            self.assertEqual(403,operations.backup_endpoint(handler,'/api/backup/evidence/1',{'role':'driver'},'token',{})[0])
        get.assert_not_called()


class DriverContactTests(unittest.TestCase):
    def test_route_api_preserves_contact_fields_from_pev(self):
        def get(table,token,params):
            if table=='routes':return [{'id':1,'driver_id':'driver','profiles':{'name':'Motorista'}}]
            if table=='route_stops':return [{'id':2,'sequence':1,'status':'pending','pevs':{
                'name':'Bella','contact_name':'Ana','contact_role':'Síndica','phone':'(15) 99999-8888','whatsapp':True}}]
            return []
        with patch.object(server.Supa,'get',side_effect=get):
            stop=server.get_route_full('driver-token',1)['stops'][0]
        self.assertEqual(('Ana','Síndica','(15) 99999-8888',True),
                         tuple(stop[key] for key in ('contact_name','contact_role','phone','whatsapp')))


if __name__=='__main__':unittest.main()
