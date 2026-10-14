"""WireUp hardware agent.

`from backend.agent import stream_agent` is the public entry point and is unchanged by the
phase v01 extraction from the former single `agent.py` module.
"""

from backend.agent.limits import (
    MAX_MODEL_CALLS, MAX_SECONDS, MAX_TOOL_CALLS, RECURSION_LIMIT, SYSTEM_PROMPT,
)
from backend.agent.schemas import (
    HARDWARE_TOOL_NAMES, TOOL_NAMES, _ASSESSMENT_TOOLS, _CONFIRM_FIRST,
    _DESCRIPTIONS, _FIRMWARE_TOOLS, _MUTATIONS, _READ_FIRST, _SCHEMAS, _TOOL_FIELDS,
)
from backend.agent.helpers import _build_intent, _provider_error
from backend.agent.graph import stream_agent

__all__ = [
    'stream_agent',
    'TOOL_NAMES', 'HARDWARE_TOOL_NAMES', '_TOOL_FIELDS', '_SCHEMAS', '_DESCRIPTIONS',
    '_ASSESSMENT_TOOLS', '_FIRMWARE_TOOLS', '_READ_FIRST', '_MUTATIONS', '_CONFIRM_FIRST',
    '_build_intent', '_provider_error',
    'MAX_TOOL_CALLS', 'MAX_MODEL_CALLS', 'MAX_SECONDS', 'RECURSION_LIMIT', 'SYSTEM_PROMPT',
]
