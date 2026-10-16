import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
ROOT=Path(__file__).resolve().parents[1]


def load_sharepoint_backend():
    fake=types.ModuleType('server')
    fake.upload_evidence=lambda *_:'rota-8/pev-13/weighing_scale/foto.jpg'
    fake.AppHandler=type('AppHandler',(),{})
    fake.Supa=types.SimpleNamespace(rpc=Mock())
    fake.HTTP=types.SimpleNamespace()
    fake.first=lambda rows:rows[0] if rows else None
    fake.now_iso=lambda:'2026-10-16T12:00:00+00:00'
    prior=sys.modules.get('server');sys.modules['server']=fake
    try:
        spec=importlib.util.spec_from_file_location('sharepoint_test',ROOT/'server_sharepoint.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    finally:
        if prior is None:sys.modules.pop('server',None)
        else:sys.modules['server']=prior


class SharePointDurabilityTests(unittest.TestCase):
    def setUp(self):
        self.backend=load_sharepoint_backend()
        self.context={'route_id':8,'route_name':'Rota correta','pev_id':13,'pev_name':'Nome correto','evidence_type':'weighing_scale','year':'2026','month':10}
        self.evidence={'id':99,'storage_path':'rota-8/pev-13/weighing_scale/foto.jpg','sync_context':self.context}

    def test_context_is_persisted_after_evidence_insert_before_processing(self):
        self.backend.rota.Supa.rpc.side_effect=[None,[self.evidence]]
        with patch.object(self.backend,'AZURE_FUNCTION_UPLOAD_URL','https://example.test'),patch.object(self.backend,'_evidence_context',return_value=self.context),patch.object(self.backend,'_process_claimed') as process:
            self.backend.finalize_evidence_upload('token',self.evidence,'image','rota-8/pev-13/weighing_scale')
        calls=self.backend.rota.Supa.rpc.call_args_list
        self.assertEqual('prepare_evidence_sync',calls[0].args[0])
        self.assertEqual(self.context,calls[0].args[2]['p_context'])
        self.assertEqual('claim_evidence_sync',calls[1].args[0])
        process.assert_called_once_with('token',self.evidence,'image')

    def test_sync_uses_frozen_context_and_keeps_original_by_default(self):
        with patch.object(self.backend,'_evidence_context') as context,patch.object(self.backend,'_upload_to_sharepoint',return_value=(self.context,'hash',{'id':'remote'})) as upload,patch.object(self.backend,'_mark_sync') as mark,patch.object(self.backend,'_delete_supabase_object') as delete,patch.dict(self.backend.os.environ,{'DELETE_SUPABASE_AFTER_SYNC':'false'}):
            result=self.backend._process_claimed('token',self.evidence,'image')
        context.assert_not_called();delete.assert_not_called()
        self.assertEqual(self.context,upload.call_args.kwargs['context'])
        self.assertEqual('synced',result['status']);self.assertEqual('synced',mark.call_args.kwargs['status'])

    def test_failed_transfer_is_persisted_for_retry_and_does_not_delete_photo(self):
        with patch.object(self.backend,'_upload_to_sharepoint',side_effect=RuntimeError('offline')),patch.object(self.backend,'_delete_supabase_object') as delete:
            result=self.backend._process_claimed('token',self.evidence,'image')
        delete.assert_not_called();self.assertEqual('error',result['status'])
        self.assertEqual('fail_evidence_sync',self.backend.rota.Supa.rpc.call_args.args[0])

    def test_no_configuration_keeps_storage_without_starting_sync(self):
        with patch.object(self.backend,'AZURE_FUNCTION_UPLOAD_URL',''):
            self.assertEqual(self.evidence['storage_path'],self.backend.upload_evidence('token','image','path'))
            self.backend.finalize_evidence_upload('token',self.evidence,'image','path')
        self.backend.rota.Supa.rpc.assert_not_called()

    def test_retry_processes_only_reserved_rows(self):
        self.backend.rota.Supa.rpc.return_value=[self.evidence]
        with patch.object(self.backend,'AZURE_FUNCTION_UPLOAD_URL','https://example.test'),patch.object(self.backend,'_process_claimed',return_value={'id':99,'status':'synced'}) as process:
            result=self.backend.retry_pending('admin-token')
        process.assert_called_once_with('admin-token',self.evidence)
        self.assertEqual([{'id':99,'status':'synced'}],result['items'])


if __name__=='__main__':unittest.main()
