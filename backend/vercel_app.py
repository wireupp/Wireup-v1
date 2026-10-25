"""Vercel FastAPI service entrypoint for both repository and flattened service roots."""

import sys
import types
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent
if not (SERVICE_ROOT / 'backend').is_dir():
    package = types.ModuleType('backend')
    package.__path__ = [str(SERVICE_ROOT)]
    package.__package__ = 'backend'
    sys.modules.setdefault('backend', package)
else:
    repository_root = SERVICE_ROOT
    if str(repository_root) not in sys.path:
        sys.path.insert(0, str(repository_root))

from backend.app import app

__all__ = ['app']
