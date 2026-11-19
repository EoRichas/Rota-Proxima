import unittest
from unittest.mock import patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class PickupAddressTests(unittest.TestCase):
    def test_only_designated_pev_and_valid_inputs(self):
        fields = dict(pickup_cep='18000-123', pickup_street='Rua Nova', pickup_number='12B')
        with patch.object(server,'viacep_lookup',return_value={'cep':'18000-123','city':'Sorocaba','state':'SP'}):
            self.assertEqual('12B',server.pickup_for_request({'requires_pickup_address':True},fields)['number'])
            for change in [dict(pickup_cep='1800'),dict(pickup_number=' '),dict(pickup_street='')]:
                with self.assertRaises(ValueError):server.pickup_for_request({'requires_pickup_address':True},{**fields,**change})
            with self.assertRaises(ValueError):server.pickup_for_request({},fields)
            self.assertIsNone(server.pickup_for_request({},{}))

    def test_two_requests_one_pev_use_their_own_points(self):
        pev={'id':7,'street':'Sede','lat':1,'lng':2,'location_confirmed':True}
        meta=[{'pev_id':7,'request_id':71},{'pev_id':7,'request_id':72}]
        reqs=[{'id':71,'pev_id':7,'pickup_address':{'street':'Rua A','number':'12'}},
              {'id':72,'pev_id':7,'pickup_address':{'street':'Rua B','number':'15','lat':5,'lng':6}}]
        with (patch.object(server.Supa,'get',side_effect=[[pev],reqs]),
              patch.object(server.Supa,'update',return_value=[{}]) as update,
              patch.object(server,'geocode_address_detailed',return_value={'lat':3,'lng':4}),
              patch.object(server,'geocode_pev_and_persist') as persist):
            _,items,points=server.planning_locations('token',[7,7],meta)
        self.assertEqual(points,[(3,4),(5,6)])
        self.assertEqual([p['street'] for p in items],['Rua A','Rua B'])
        self.assertEqual(update.call_args.args[0],'scheduling_requests')
        persist.assert_not_called()
        self.assertEqual(pev['street'],'Sede')

    def test_driver_stop_uses_snapshot_without_request_access(self):
        def get(table,*args):
            if table=='routes':return [{'id':5}]
            if table=='route_stops':return [{'id':4,'pevs':{'name':'Meta','contact_name':'João','street':'Sede','lat':0,'lng':0},
                'pickup_address':{'street':'Rua Nova','number':'12','lat':3,'lng':4}}]
            return []
        with patch.object(server.Supa,'get',side_effect=get):
            stop=server.get_route_full('driver',5)['stops'][0]
        self.assertEqual(('Rua Nova','12',3,4,'João'),tuple(stop[k] for k in ('street','number','lat','lng','contact_name')))
        self.assertFalse(stop['location_confirmed'])

    def test_no_meta_destination_from_fixed_pev(self):
        pev={'id':88,'requires_pickup_address':True,'street':'Sede','lat':1,'lng':2}
        with patch.object(server.Supa,'get',return_value=[pev]), self.assertRaisesRegex(ValueError,'solicitação'):
            server.planning_locations('token',[88],[])
        masked=server.at_pickup(pev,None)
        self.assertIsNone(masked['street'])
        self.assertIsNone(masked['lat'])

    def test_history_uses_visited_places_in_role_scope_and_not_assumed_addresses(self):
        a={'cep':'01001-000','street':'Praça da Sé','number':'120'}
        rows=[{'arrived_at':'2026-10-20','pickup_address':a},
              {'arrived_at':'2026-11-02','pickup_address':a},
              {'arrived_at':'2026-10-01','arrived_lat':-23.5,'arrived_lng':-47.1},
              {'completed_at':'2026-09-01'}]
        for role,key in [('driver','routes.driver_id'),('commercial','pevs.commercial_owner_id')]:
            with patch.object(server.Supa,'get',return_value=rows) as get:
                result=server.pickup_history('token',{'id':'me','role':role},88)
            self.assertEqual(get.call_args.args[2][key],'eq.me')
            self.assertEqual(get.call_args.args[2]['pevs.requires_pickup_address'],'eq.true')
            self.assertEqual(len(result),2)
            self.assertEqual(result[0]['visited_at'],'2026-11-02')
            self.assertNotIn('street',result[1])
