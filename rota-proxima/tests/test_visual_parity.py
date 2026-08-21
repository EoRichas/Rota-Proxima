import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class VisualParityTests(unittest.TestCase):
    def test_planner_stacks_before_controls_are_compressed(self):
        styles = (ROOT / 'static' / 'styles.css').read_text(encoding='utf-8')
        self.assertIn('@media (min-width:901px) and (max-width:1500px)', styles)
        self.assertIn('.route-builder { grid-template-columns: minmax(0,1fr); }', styles)
        self.assertIn('.pev-check input[type="time"] { min-width: 0; }', styles)

    def test_visual_assets_force_a_fresh_browser_version(self):
        html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        worker = (ROOT / 'static' / 'service-worker.js').read_text(encoding='utf-8')
        self.assertIn('styles.css?v=render-performance-20260820-1', html)
        self.assertIn('app.js?v=render-performance-20260820-1', html)
        self.assertIn("rota-proxima-device-session-20260821-v3", worker)

    def test_all_current_test_ui_layers_are_loaded_in_production(self):
        html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
        worker = (ROOT / 'static' / 'service-worker.js').read_text(encoding='utf-8')
        assets = (
            'workflow-patch.css', 'dashboard-center.css', 'ui-cleanup.css',
            'mobile-access.css', 'workflow-patch.js', 'dashboard-center.js',
            'ui-cleanup.js', 'mobile-access.js',
        )
        for asset in assets:
            self.assertTrue((ROOT / 'static' / asset).exists(), asset)
            self.assertIn(f'/{asset}?v=render-performance-20260820-1', html)
            self.assertIn(f"'/{asset}'", worker)

    def test_dashboard_uses_the_markup_expected_by_the_promoted_css(self):
        app = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertIn('<div class="grid stats">', app)
        self.assertIn('dashboard-centered', (ROOT / 'static' / 'dashboard-center.js').read_text(encoding='utf-8'))
        self.assertNotIn('<div class="dashboard-layout">', app)

    def test_test_environment_identifiers_are_not_promoted(self):
        text = '\n'.join(
            path.read_text(encoding='utf-8')
            for path in [
                ROOT / 'static' / 'index.html',
                ROOT / 'static' / 'app.js',
                ROOT / 'server.py',
                ROOT / 'server_sharepoint.py',
            ]
        ).lower()
        self.assertNotIn('ambiente de teste', text)
        self.assertNotIn('rota-proxima-teste', text)
        self.assertNotIn('wzonboudahxbyzoxnehx', text)

    def test_driver_location_is_not_sent_to_an_external_geocoder(self):
        cleanup = (ROOT / 'static' / 'ui-cleanup.js').read_text(encoding='utf-8').lower()
        self.assertNotIn('nominatim.openstreetmap.org', cleanup)
        self.assertNotIn('reverse?format=json', cleanup)

    def test_azure_function_source_is_kept_separate_from_render_dependencies(self):
        self.assertTrue((ROOT / 'function_app.py').exists())
        self.assertTrue((ROOT / 'host.json').exists())
        azure_requirements = (ROOT / 'requirements-azure.txt').read_text(encoding='utf-8')
        render_requirements = (ROOT / 'requirements.txt').read_text(encoding='utf-8')
        self.assertIn('azure-functions', azure_requirements)
        self.assertNotIn('azure-functions', render_requirements)

    def test_sharepoint_upload_uses_reduced_folder_structure(self):
        function_source = (ROOT / 'function_app.py').read_text(encoding='utf-8')
        backend = (ROOT / 'server_sharepoint.py').read_text(encoding='utf-8')
        self.assertIn('for segment in [year, month]', function_source)
        self.assertIn('_ensure_keyed_folder(', function_source)
        self.assertNotIn('category_folder', function_source)
        self.assertIn("'pev_id': context['pev_id']", backend)


if __name__ == '__main__':
    unittest.main()
