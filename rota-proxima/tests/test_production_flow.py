import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dependency_stubs import install_optional_dependency_stubs

install_optional_dependency_stubs()

import server


class ProductionQueueRulesTests(unittest.TestCase):
    def test_evidence_upload_rejects_non_image_content(self):
        with self.assertRaisesRegex(ValueError, 'Conteúdo da foto inválido'):
            server.upload_evidence('token', 'data:image/jpeg;base64,QUJD', 'rota-1/pev-1/drum')

    def test_pending_weighings_include_only_unweighed_completed_collections(self):
        route = {
            'status': 'in_progress',
            'stops': [
                {'id': 1, 'status': 'completed', 'service_type': 'collection'},
                {'id': 2, 'status': 'completed', 'service_type': 'collection'},
                {'id': 3, 'status': 'completed', 'service_type': 'delivery'},
                {'id': 4, 'status': 'failed', 'service_type': 'collection'},
            ],
            'weighings': [{'stop_id': 2, 'weight_kg': 10}],
        }
        self.assertEqual([1], [item['id'] for item in server.pending_production_weighings(route)])

    def test_route_is_released_only_after_every_driver_stop_is_terminal(self):
        ready = {
            'status': 'in_progress',
            'stops': [{'id': 1, 'status': 'completed', 'service_type': 'collection'}],
            'weighings': [],
        }
        blocked = {
            **ready,
            'stops': ready['stops'] + [{'id': 2, 'status': 'pending', 'service_type': 'delivery'}],
        }
        self.assertTrue(server.route_waiting_for_production(ready))
        self.assertFalse(server.route_waiting_for_production(blocked))

    def test_driver_cannot_call_weighing_endpoint(self):
        handler = server.AppHandler.__new__(server.AppHandler)
        handler.read_json = lambda: {'stop_id': 1, 'weight_kg': '10', 'image_data': 'data:image/jpeg;base64,AA=='}
        handler.require_user = lambda: {'id': 'driver-id', 'role': 'driver'}
        handler.token = lambda: 'driver-token'
        handler.send_json = lambda body, status=200, extra_headers=None: (status, body)
        status, body = handler.api_write('POST', '/api/routes/1/weighings')
        self.assertEqual(403, status)
        self.assertEqual('Sem permissão', body['error'])


class RequestedInterfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frontend = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        cls.backend = (ROOT / 'server.py').read_text(encoding='utf-8')
        cls.styles = (ROOT / 'static' / 'styles.css').read_text(encoding='utf-8')
        cls.edge_function = (ROOT / 'supabase' / 'functions' / 'rota-admin' / 'index.ts').read_text(encoding='utf-8')
        cls.migrations = '\n'.join(
            path.read_text(encoding='utf-8')
            for path in sorted((ROOT / 'supabase' / 'migrations').glob('*.sql'))
        )

    def test_pev_form_has_no_period_or_observation_fields(self):
        start = self.frontend.index('async function openPevModal')
        end = self.frontend.index('function openRequestModal', start)
        form = self.frontend[start:end]
        for field in ('name="service_start"', 'name="service_end"', 'name="notes"', 'name="internal_notes"'):
            self.assertNotIn(field, form)
        self.assertIn('before update on public.pevs', self.migrations)

    def test_request_form_keeps_period_and_observations_and_resets(self):
        start = self.frontend.index('function openRequestModal')
        end = self.frontend.index('async function renderPlanner', start)
        form = self.frontend[start:end]
        for field in ('name="window_start"', 'name="window_end"', 'name="notes"', 'name="internal_notes"'):
            self.assertIn(field, form)
        self.assertIn('form.reset()', form)

    def test_driver_requires_location_and_drum_photos(self):
        self.assertIn("evidenceBox('stop_location','Foto do local'", self.frontend)
        self.assertIn("evidenceBox('drum','Foto do tambor'", self.frontend)
        self.assertIn('<button id="failStop" class="btn danger" ${hasRequiredEvidence?\'\':\'disabled\'}>', self.frontend)
        self.assertIn("if action in ('complete','fail')", self.backend)
        self.assertIn("'stop_location' not in present", self.backend)
        self.assertIn("'drum' not in present", self.backend)
        self.assertIn('route_stops_require_driver_photos', self.migrations)
        self.assertIn("new.status in ('completed','failed')", self.migrations)
        self.assertIn("and evidence_type in ('stop_location','drum')", self.migrations)
        self.assertIn('and created_by = auth.uid()', self.migrations)

    def test_production_owns_final_weighing_ui_and_policy(self):
        self.assertIn("user.role === 'production' ? 'production'", self.frontend)
        self.assertIn('Aguardando pesagem da Produção', self.frontend)
        self.assertNotIn('bindWeighingForms', self.frontend)
        self.assertIn("if role!='production'", self.backend)
        self.assertIn('private.production_can_insert_weighing', self.migrations)
        self.assertIn("'production'", self.edge_function)
        self.assertIn("npm:@supabase/supabase-js@2.112.3", self.edge_function)

    def test_return_to_base_is_not_sent_or_honored(self):
        self.assertNotIn('return_origin:false', self.frontend)
        optimize_start = self.backend.index("if path=='/api/optimize'")
        optimize_end = self.backend.index("if path=='/api/routes' and method=='POST'", optimize_start)
        self.assertNotIn("data.get('return_origin')", self.backend[optimize_start:optimize_end])

    def test_dashboard_uses_equal_responsive_columns(self):
        self.assertIn('.dashboard-summary-grid, .dashboard-pending-grid { grid-template-columns: repeat(4,minmax(0,1fr)); }', self.styles)
        self.assertIn('.dashboard-summary-grid, .dashboard-pending-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }', self.styles)
        self.assertIn('.dashboard-summary-grid, .dashboard-pending-grid { grid-template-columns: 1fr; }', self.styles)

    def test_pdf_keeps_existing_route_filter(self):
        self.assertIn("'route':(q.get('route') or ['all'])[0]", self.backend)
        self.assertIn("filters['route']", self.backend)
        self.assertIn("<b>Rota</b>", self.backend)

    def test_release_contains_only_production_configuration(self):
        html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        worker = (ROOT / 'static' / 'service-worker.js').read_text(encoding='utf-8')
        combined = '\n'.join((self.backend, self.frontend, html, worker, self.styles, self.edge_function, self.migrations))
        self.assertIn('https://uufkwqdsixvuhiyoyyyy.supabase.co', self.backend)
        self.assertIn('rota-evidencias', self.backend)
        self.assertIn("bucket_id = 'rota-evidencias'", self.migrations)
        for marker in ('wzonboudahxbyzoxnehx', 'rota-evidencias-teste', 'AMBIENTE DE TESTE', 'ambiente-teste-badge'):
            self.assertNotIn(marker, combined)

    def test_deferred_local_sync_metadata_is_not_published(self):
        combined = '\n'.join((self.backend, self.frontend, self.styles))
        for marker in ('showDirectoryPicker', 'evidence-sync', 'SHAREPOINT_ONLY', 'Rota - PEV', 'OneDrive -'):
            self.assertNotIn(marker, combined)


if __name__ == '__main__':
    unittest.main()
