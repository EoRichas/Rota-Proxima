import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def install_azure_stubs():
    azure = types.ModuleType('azure')
    functions = types.ModuleType('azure.functions')
    identity = types.ModuleType('azure.identity')

    class FunctionApp:
        def __init__(self, *args, **kwargs):
            pass

        def route(self, *args, **kwargs):
            return lambda fn: fn

    functions.FunctionApp = FunctionApp
    functions.AuthLevel = types.SimpleNamespace(FUNCTION='FUNCTION')
    functions.HttpRequest = object
    functions.HttpResponse = lambda *args, **kwargs: (args, kwargs)
    identity.ManagedIdentityCredential = object
    azure.functions = functions
    azure.identity = identity
    sys.modules['azure'] = azure
    sys.modules['azure.functions'] = functions
    sys.modules['azure.identity'] = identity


install_azure_stubs()
function_app = importlib.import_module('function_app')


class SharePointFolderRoutingTests(unittest.TestCase):
    def setUp(self):
        self.route_folders = [
            {
                'id': 'route-correct',
                'name': 'Rota 00008 - Rota 21-08-2026',
                'folder': {'childCount': 4},
                'createdDateTime': '2026-08-21T12:13:00Z',
            },
            {
                'id': 'route-fallback',
                'name': 'Rota 00008 - Rota 8',
                'folder': {'childCount': 1},
                'createdDateTime': '2026-08-21T12:23:00Z',
            },
        ]
        self.pev_folders = [
            {
                'id': 'pev-correct',
                'name': 'PEV 0013 - EMEIEF Izabel Fernandes Pedroso',
                'folder': {'childCount': 2},
                'createdDateTime': '2026-08-21T12:16:00Z',
            },
            {
                'id': 'pev-fallback',
                'name': 'PEV 0013 - PEV 13',
                'folder': {'childCount': 1},
                'createdDateTime': '2026-08-21T12:21:00Z',
            },
        ]

    def test_route_fallback_reuses_the_established_descriptive_folder(self):
        selected = function_app._select_keyed_folder(
            self.route_folders,
            'Rota 00008 -',
            'Rota 00008 - Rota 8',
            'Rota 00008 - Rota 8',
        )
        self.assertEqual('route-correct', selected['id'])

    def test_scale_photo_reuses_the_existing_pev_folder(self):
        selected = function_app._select_keyed_folder(
            self.pev_folders,
            'PEV 0013 -',
            'PEV 0013 - PEV 13',
            'PEV 0013 - PEV 13',
        )
        self.assertEqual('pev-correct', selected['id'])

    def test_exact_name_is_used_as_tiebreaker_for_established_folders(self):
        tied = [
            dict(self.pev_folders[0], folder={'childCount': 2}),
            dict(self.pev_folders[1], name='PEV 0013 - Outro nome', folder={'childCount': 2}),
        ]
        selected = function_app._select_keyed_folder(
            tied,
            'PEV 0013 -',
            'PEV 0013 - EMEIEF Izabel Fernandes Pedroso',
            'PEV 0013 - PEV 13',
        )
        self.assertEqual('pev-correct', selected['id'])

    def test_renaming_does_not_abandon_the_folder_that_already_has_the_photos(self):
        folders = [
            dict(self.pev_folders[0], name='PEV 0013 - Nome anterior', folder={'childCount': 2}),
            dict(self.pev_folders[1], name='PEV 0013 - Nome atualizado', folder={'childCount': 0}),
        ]
        selected = function_app._select_keyed_folder(
            folders,
            'PEV 0013 -',
            'PEV 0013 - Nome atualizado',
            'PEV 0013 - PEV 13',
        )
        self.assertEqual('pev-correct', selected['id'])

    def test_ensure_returns_the_real_reused_folder_name(self):
        with patch.object(function_app, '_folder_children', return_value=self.pev_folders):
            folder_id, folder_name = function_app._ensure_keyed_folder(
                'drive',
                'route-parent',
                'PEV 0013 -',
                'PEV 0013 - PEV 13',
                'PEV 0013 - PEV 13',
                'token',
            )
        self.assertEqual('pev-correct', folder_id)
        self.assertEqual('PEV 0013 - EMEIEF Izabel Fernandes Pedroso', folder_name)


if __name__ == '__main__':
    unittest.main()
