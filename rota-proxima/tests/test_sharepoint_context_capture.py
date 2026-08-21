import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]


def load_sharepoint_backend():
    fake_server = types.ModuleType('server')
    fake_server.upload_evidence = lambda *_args, **_kwargs: 'storage/original.jpg'
    fake_server.AppHandler = type('AppHandler', (), {})
    fake_server.BUILD_ID = 'test'
    fake_server.HTTP = types.SimpleNamespace()
    fake_server.Supa = types.SimpleNamespace()
    fake_server.first = lambda rows: rows[0] if rows else None
    fake_server.now_iso = lambda: '2026-08-21T12:00:00+00:00'
    fake_server.main = lambda: None

    module_name = 'server_sharepoint_context_test'
    previous_server = sys.modules.get('server')
    sys.modules['server'] = fake_server
    try:
        spec = importlib.util.spec_from_file_location(module_name, ROOT / 'server_sharepoint.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous_server is None:
            sys.modules.pop('server', None)
        else:
            sys.modules['server'] = previous_server
        sys.modules.pop(module_name, None)


class SharePointContextCaptureTests(unittest.TestCase):
    def setUp(self):
        self.backend = load_sharepoint_backend()
        self.context = {
            'route_id': 8,
            'route_name': 'Rota 21/08/2026',
            'pev_id': 13,
            'pev_name': 'EMEIEF Izabel Fernandes Pedroso',
            'evidence_type': 'weighing_scale',
            'year': '2026',
            'month': 8,
        }

    def test_context_is_frozen_before_upload_evidence_returns(self):
        events = []
        captured = {}

        def original_upload(*_args):
            events.append('storage')
            return 'rota-8/pev-13/weighing_scale/foto.jpg'

        def resolve_context(*_args):
            events.append('context')
            return self.context

        class FakeThread:
            def __init__(self, *, target, args, daemon):
                events.append('thread')
                captured.update(target=target, args=args, daemon=daemon)

            def start(self):
                events.append('start')

        self.backend.AZURE_FUNCTION_UPLOAD_URL = 'https://function.example/upload'
        self.backend._ORIGINAL_UPLOAD = original_upload
        with (
            patch.object(self.backend, '_evidence_context', side_effect=resolve_context),
            patch.object(self.backend.threading, 'Thread', FakeThread),
        ):
            storage_path = self.backend.upload_evidence(
                'production-token',
                'data:image/jpeg;base64,AA==',
                'rota-8/pev-13/weighing_scale',
            )

        self.assertEqual('rota-8/pev-13/weighing_scale/foto.jpg', storage_path)
        self.assertEqual(['storage', 'context', 'thread', 'start'], events)
        self.assertIs(self.backend._sync_after_insert, captured['target'])
        self.assertEqual(self.context, captured['args'][4])
        self.assertIsNot(self.context, captured['args'][4])
        self.assertTrue(captured['daemon'])

    def test_sharepoint_payload_uses_frozen_names_without_querying_again(self):
        sent = {}

        class Response:
            ok = True
            status_code = 200
            text = ''

            @staticmethod
            def json():
                return {'ok': True, 'folder': 'pasta-correta'}

        def post(url, json, timeout):
            sent.update(url=url, json=json, timeout=timeout)
            return Response()

        self.backend.AZURE_FUNCTION_UPLOAD_URL = 'https://function.example/upload'
        self.backend.rota.HTTP = types.SimpleNamespace(post=post)
        with (
            patch.object(self.backend, '_decode_image_data', return_value=('QUJD', b'abc', 'jpg')),
            patch.object(self.backend, '_sharepoint_filename', return_value=('balanca_hash.jpg', 'hash')),
            patch.object(
                self.backend,
                '_evidence_context',
                side_effect=AssertionError('não deve consultar após a pesagem'),
            ),
        ):
            context, digest, result = self.backend._upload_to_sharepoint(
                'production-token',
                'data:image/jpeg;base64,QUJD',
                'rota-8/pev-13/weighing_scale',
                context=self.context,
            )

        self.assertEqual(self.context, context)
        self.assertEqual('hash', digest)
        self.assertTrue(result['ok'])
        self.assertEqual('Rota 21/08/2026', sent['json']['route_name'])
        self.assertEqual('EMEIEF Izabel Fernandes Pedroso', sent['json']['pev_name'])
        self.assertEqual('balanca_hash.jpg', sent['json']['filename'])
        self.assertEqual('2026', sent['json']['year'])
        self.assertEqual(8, sent['json']['month'])

    def test_background_sync_forwards_the_frozen_context(self):
        upload = Mock(return_value=(self.context, 'hash', {'ok': True}))
        with (
            patch.object(self.backend, '_find_evidence', return_value={'id': 99}),
            patch.object(self.backend, '_mark_sync'),
            patch.object(self.backend, '_upload_to_sharepoint', upload),
            patch.object(self.backend, '_delete_supabase_object'),
        ):
            self.backend._sync_after_insert(
                'production-token',
                'storage/path.jpg',
                'data:image/jpeg;base64,QUJD',
                'rota-8/pev-13/weighing_scale',
                self.context,
            )

        upload.assert_called_once_with(
            'production-token',
            'data:image/jpeg;base64,QUJD',
            'rota-8/pev-13/weighing_scale',
            context=self.context,
        )

    def test_no_sharepoint_configuration_keeps_the_fast_fallback(self):
        self.backend.AZURE_FUNCTION_UPLOAD_URL = ''
        self.backend._ORIGINAL_UPLOAD = Mock(return_value='storage/path.jpg')
        with (
            patch.object(
                self.backend,
                '_evidence_context',
                side_effect=AssertionError('não deve consultar sem SharePoint'),
            ),
            patch.object(self.backend.threading, 'Thread') as thread,
        ):
            result = self.backend.upload_evidence(
                'token',
                'data:image/jpeg;base64,AA==',
                'rota-8/pev-13/weighing_scale',
            )

        self.assertEqual('storage/path.jpg', result)
        thread.assert_not_called()


if __name__ == '__main__':
    unittest.main()
