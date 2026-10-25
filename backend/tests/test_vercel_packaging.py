import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


def test_vercel_backend_preserves_flattened_service_layout(tmp_path):
    config = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
    backend = config['services']['backend']
    assert backend['root'] == 'backend'
    assert backend['entrypoint'] == 'vercel_app.py'
    assert backend['installCommand'] == 'pip install -r requirements-vercel.txt'
    function = backend['functions']['vercel_app.py']
    assert 'catalog/**' in function['includeFiles']
    assert 'templates/**' in function['includeFiles']
    assert 'tests/**' in function['excludeFiles']

    bundle = tmp_path / 'function'
    bundle.mkdir()
    for source in (ROOT / 'backend').glob('*.py'):
        shutil.copy2(source, bundle / source.name)
    for directory in ('catalog', 'templates'):
        shutil.copytree(ROOT / 'backend' / directory, bundle / directory)
    script = '''
from fastapi.testclient import TestClient
from vercel_app import app
with TestClient(app) as client:
    for path in ('/api/health', '/api/hardware/projects', '/api/hardware/catalog?limit=1'):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code, response.text)
    response = client.post('/api/hardware/projects', json={'name': 'Bundle smoke', 'board': 'arduino-uno'})
    assert response.status_code == 200, response.text
'''
    env = {**os.environ, 'VERCEL': '1', 'WIREUP_DATA_DIR': str(tmp_path / 'projects')}
    env.pop('PYTHONPATH', None)
    result = subprocess.run(
        [sys.executable, '-c', script], cwd=bundle, env=env,
        capture_output=True, text=True, timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
