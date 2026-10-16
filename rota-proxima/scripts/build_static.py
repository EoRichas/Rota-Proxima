"""Copy only public assets; backend/config/schema can never become static files."""
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / 'public'
if output.exists():
    shutil.rmtree(output)
shutil.copytree(root / 'static', output)
print('Assets públicos preparados.')
