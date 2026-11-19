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
