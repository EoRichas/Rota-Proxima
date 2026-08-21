import io
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


def report_item(owner_id, owner_name, pev_name):
    return {
        'id': pev_name,
        'route_date': '2026-08-21',
        'service_type': 'collection',
        'pev_id': pev_name,
        'pev_name': pev_name,
        'city': 'Sorocaba',
        'state': 'SP',
        'route_name': 'Rota 00008',
        'status': 'completed',
        'collected_weight_kg': 12.5,
        'commercial_owner_id': owner_id,
        'commercial_owner_name': owner_name,
    }


def report_handler(role='commercial', user_id='commercial-1'):
    handler = server.AppHandler.__new__(server.AppHandler)
    handler.require_user = lambda roles=None: {'id': user_id, 'name': 'Comercial Um', 'role': role}
    handler.token = lambda: 'access-token'
    handler.query = lambda: {
        'from': ['2026-08-01'],
        'to': ['2026-08-21'],
        'commercial': ['commercial-2'],
        'status': ['all'],
        'service_type': ['all'],
        'pev': ['all'],
        'route': ['all'],
    }
    handler.send_json = lambda body, status=200, extra_headers=None: (status, body)
    handler.send_bytes = lambda raw, content_type='application/octet-stream', status=200, filename=None: (status, content_type, filename, raw)
    return handler


class ReportExportTests(unittest.TestCase):
    def setUp(self):
        self.items = [
            report_item('commercial-1', 'Comercial Um', 'PEV autorizado'),
            report_item('commercial-2', 'Comercial Dois', 'PEV de outro comercial'),
        ]

    def test_commercial_json_receives_only_its_portfolio(self):
        handler = report_handler()
        with patch.object(server, 'collection_report_items', return_value=self.items):
            status, body = handler.api_get('/api/reports/collections')
        self.assertEqual(200, status)
        self.assertEqual(['PEV autorizado'], [item['pev_name'] for item in body['items']])

    def test_commercial_cannot_override_xlsx_scope_in_query(self):
        handler = report_handler()
        captured = {}

        def build(items, _date_from, _date_to, filters):
            captured['items'] = items
            captured['filters'] = filters
            return b'xlsx-bytes'

        with patch.object(server, 'collection_report_items', return_value=self.items), patch.object(server, 'build_collections_xlsx', side_effect=build):
            status, content_type, filename, raw = handler.api_get('/api/reports/collections/xlsx')
        self.assertEqual(200, status)
        self.assertEqual('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_type)
        self.assertTrue(filename.endswith('.xlsx'))
        self.assertEqual(b'xlsx-bytes', raw)
        self.assertEqual('commercial-1', captured['filters']['commercial'])
        self.assertEqual(['PEV autorizado'], [item['pev_name'] for item in captured['items']])

    def test_xlsx_is_a_valid_office_archive_with_current_columns(self):
        filters = {
            'commercial': 'all',
            'commercial_name': 'Todos',
            'pev': 'all',
            'route': 'all',
            'service_type': 'all',
            'status': 'all',
            'show_comparison': True,
            'portfolio': {},
        }
        raw = server.build_collections_xlsx(self.items, '2026-08-01', '2026-08-21', filters)
        self.assertTrue(raw.startswith(b'PK'))
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            self.assertIn('xl/workbook.xml', archive.namelist())
            self.assertIn('xl/worksheets/sheet1.xml', archive.namelist())
            strings = archive.read('xl/sharedStrings.xml').decode('utf-8')
        self.assertIn('Peso coletado (kg)', strings)
        self.assertIn('Comercial responsável', strings)
        self.assertIn('PEV autorizado', strings)

    def test_interface_has_xlsx_and_no_csv_export(self):
        source = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertIn('Exportar Excel (.xlsx)', source)
        self.assertIn("downloadAuthenticated(`/api/reports/collections/${format}?", source)
        self.assertIn("headers:{'X-Rota-Device-ID':DEVICE_ID}", source)
        self.assertNotIn("window.open(`/api/reports/collections/", source)
        self.assertNotIn('Exportar CSV', source)
        self.assertNotIn('.csv`', source)


if __name__ == '__main__':
    unittest.main()
