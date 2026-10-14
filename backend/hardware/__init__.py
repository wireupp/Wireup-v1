"""WireUp hardware service.

`from backend.hardware import router, service, local_connection, BOARD_CONFIG` and
every other name previously exported by the single `backend/hardware.py` module is
unchanged by the phase v01 extraction.
"""

from backend.hardware.api import (
    CreateProject,
    HardwareCommand,
    create_router,
    local_connection,
    router,
    service,
)
from backend.hardware.boards import (
    BOARD_ALIASES,
    BOARD_CONFIG,
    BOARDS,
    COMPONENT_PINS,
    DEFAULT_BOARD_SOURCES,
    DEFAULT_SOURCE,
    EXPLICIT_PIN_LAYOUTS,
    PIN_ALIASES,
    PIN_LAYOUTS,
    ROOT,
    TOOLS,
    load_component_pins,
)
from backend.hardware.catalog import ComponentCatalog
from backend.hardware.compiler import ArduinoCompiler
from backend.hardware.projects import HardwareService
from backend.hardware.runtime_bridge import RuntimeBridge
from backend.hardware.util import (
    IDENTIFIER,
    SPICE_SOURCE_SCHEMAS,
    SPICE_VALUE_PATTERN,
    calculator,
    fail,
    identifier,
    now,
    numeric,
    public,
    source_text,
    spice_catalog_entries,
    validate_spice_properties,
)

__all__ = [
    'router', 'service', 'create_router', 'local_connection',
    'HardwareService', 'ComponentCatalog', 'ArduinoCompiler', 'RuntimeBridge',
    'CreateProject', 'HardwareCommand',
    'BOARDS', 'BOARD_CONFIG', 'BOARD_ALIASES', 'PIN_LAYOUTS', 'PIN_ALIASES',
    'COMPONENT_PINS', 'EXPLICIT_PIN_LAYOUTS', 'DEFAULT_BOARD_SOURCES', 'DEFAULT_SOURCE',
    'TOOLS', 'ROOT', 'load_component_pins',
    'IDENTIFIER', 'fail', 'now', 'identifier', 'public', 'numeric', 'source_text',
    'calculator', 'spice_catalog_entries', 'validate_spice_properties',
    'SPICE_SOURCE_SCHEMAS', 'SPICE_VALUE_PATTERN',
]
