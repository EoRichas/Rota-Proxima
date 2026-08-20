import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DriverLocationSchemaTests(unittest.TestCase):
    def test_structure_is_versioned_without_test_data(self):
        backend = (ROOT / 'server.py').read_text(encoding='utf-8')
        migrations = '\n'.join(
            path.read_text(encoding='utf-8')
            for path in sorted((ROOT / 'supabase' / 'migrations').glob('*.sql'))
        )

        self.assertIn("Supa.get('driver_location_updates'", backend)
        self.assertIn("Supa.insert('driver_location_updates'", backend)
        self.assertIn('create table if not exists public.driver_location_updates', migrations)
        self.assertIn('driver_location_route_time_idx', migrations)
        self.assertIn('driver_location_driver_idx', migrations)
        self.assertIn('alter table public.driver_location_updates enable row level security', migrations)
        self.assertIn('revoke all on table public.driver_location_updates from anon', migrations)
        self.assertNotIn('insert into public.driver_location_updates', migrations)


if __name__ == '__main__':
    unittest.main()
