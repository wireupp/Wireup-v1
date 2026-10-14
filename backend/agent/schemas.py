"""Tool argument schemas, tool name tables, tool scoping sets and tool descriptions.

Split out of the former backend/agent.py during phase v01. This module is the single
definition of the tool surface: both the LangGraph binding and the hardware dispatcher
read these tables, so a tool cannot be described one way and dispatched another.

Phase v02 replaces these hand-written tables with contracts/tools/*.tool.json, which the
MCP server and the frontend will also consume.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model


class _Args(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class _Option(_Args):
    id: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    label: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    component_type: str | None = Field(default=None, max_length=128)


class _Question(_Args):
    id: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    question: str = Field(min_length=1, max_length=300)
    options: list[_Option] = Field(min_length=2, max_length=6)


class _Questions(_Args):
    questions: list[_Question] = Field(min_length=1, max_length=10)
    summary: str = Field(min_length=1, max_length=1000)


class _PlanPart(_Args):
    type: str = Field(min_length=1, max_length=128)
    quantity: int = Field(ge=1, le=30)
    purpose: str = Field(min_length=1, max_length=500)


_Operation = Literal[
    'read_project', 'search_components', 'add_component', 'remove_component',
    'modify_component', 'connect_wire', 'remove_wire', 'wire_circuit',
    'validate_circuit', 'check_connections', 'generate_firmware', 'read_firmware', 'edit_firmware',
    'compile_firmware', 'run_simulation', 'stop_simulation',
    'read_simulation_results', 'read_compiler_errors', 'calculator',
]


class _Plan(_Args):
    board: str = Field(min_length=1, max_length=128)
    behavior: str = Field(min_length=1, max_length=4000)
    parts: list[_PlanPart] = Field(max_length=40)
    libraries: list[str] = Field(max_length=100)
    operations: list[_Operation] = Field(min_length=1, max_length=30)


class _Assessment(_Args):
    plan: _Plan


class _Waypoint(_Args):
    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)


class _BatchWire(_Args):
    id: str | None = Field(default=None, max_length=80)
    start: dict[str, str] = Field(alias='from')
    to: dict[str, str]
    color: str | None = Field(default=None, max_length=64)
    waypoints: list[_Waypoint] | None = Field(default=None, max_length=100)


class _Endpoint(_Args):
    component: str = Field(min_length=1, max_length=128)
    pin: str = Field(min_length=1, max_length=128)


def _optional(kind, default=None, **constraints):
    return (kind | None, Field(default=default, **constraints))


_revision = {'expected_revision': _optional(int, ge=0)}
_id = {'id': (str, Field(min_length=1, max_length=128))}
_position = {
    'x': _optional(float), 'y': _optional(float), 'rotation': _optional(float),
    'properties': _optional(dict[str, Any]),
}
_source = (str, Field(min_length=1, max_length=200000))
_TOOL_FIELDS = {
    'read_project': {},
    'search_components': {'query': _optional(str, max_length=200), 'limit': _optional(int, ge=1, le=20)},
    'add_component': {'type': (str, Field(min_length=1, max_length=128)), 'id': _optional(str, min_length=1, max_length=128), **_position, **_revision},
    'remove_component': {**_id, **_revision},
    'modify_component': {**_id, **_position, **_revision},
    'connect_wire': {'from': (_Endpoint, ...), 'to': (_Endpoint, ...), 'color': _optional(str, max_length=64), 'id': _optional(str, min_length=1, max_length=128), **_revision},
    'remove_wire': {**_id, **_revision},
    'wire_circuit': {'batch': (list[_BatchWire], Field(min_length=1, max_length=200)), **_revision},
    'validate_circuit': {},
    'check_connections': {'repair': (bool, Field(default=False)), **_revision},
    'generate_firmware': {'source': _source, **_revision},
    'read_firmware': {},
    'edit_firmware': {'source': _optional(str, min_length=1, max_length=200000), 'old': _optional(str, min_length=1, max_length=200000), 'new': _optional(str, min_length=1, max_length=200000), **_revision},
    'compile_firmware': dict(_revision),
    'run_simulation': {'artifact_id': _optional(str, min_length=1, max_length=128)},
    'stop_simulation': {},
    'read_simulation_results': {},
    'read_compiler_errors': {},
    'calculator': {'expression': (str, Field(min_length=1, max_length=1000))},
}
HARDWARE_TOOL_NAMES = tuple(_TOOL_FIELDS)
TOOL_NAMES = (*HARDWARE_TOOL_NAMES, 'ask_project_questions', 'search_example_requirements', 'get_example_reference', 'assess_project_feasibility')
_ASSESSMENT_TOOLS = frozenset({'read_project', 'search_components', 'search_example_requirements', 'get_example_reference', 'assess_project_feasibility'})
_READ_FIRST = frozenset({
    'add_component', 'remove_component', 'modify_component', 'connect_wire',
    'remove_wire', 'wire_circuit', 'generate_firmware', 'edit_firmware', 'compile_firmware',
})
_MUTATIONS = _READ_FIRST - {'compile_firmware'}
_CONFIRM_FIRST = _READ_FIRST | {'run_simulation'}
_FIRMWARE_TOOLS = frozenset({
    'read_project', 'read_firmware', 'generate_firmware', 'edit_firmware',
    'compile_firmware', 'read_compiler_errors', 'validate_circuit', 'check_connections', 'calculator',
})
_DESCRIPTIONS = {
    'assess_project_feasibility': 'Assess the complete intended board, behavior, parts with quantities and purposes, libraries and exact executable tool names before ANY placement or mutation. The server resolves documented limitations automatically; incompatible plans authorize no changes.',
    'get_example_reference': 'Read an actual Velxio example circuit, exact parts and connections, firmware source, dependencies and canonical adaptations. Use it as a reference, then build through existing project tools; never claim this reference ran here.',
    'search_example_requirements': 'Search analyzed Velxio prototypes for board, component, library, language, wiring and runtime requirements. Results include unsupported capability gaps; never assume an upstream example runs here.',
    'ask_project_questions': 'Ask exactly 10 project-specific multiple-choice requirements questions, board first when unselected; three concrete options plus fourth option ai_choose / Let AI choose. Pause for user selections without mutations.',
    'read_project': 'Read the current project, components, wires, firmware, and revision. Required before mutations.',
    'search_components': 'Search the component catalog for exact types and supported pins.',
    'add_component': 'Add a catalog component to the current project.',
    'remove_component': 'Remove a component and its incident wires from the current project.',
    'modify_component': 'Change a component position, rotation, or properties.',
    'connect_wire': 'Connect two known component pins in the current project.',
    'remove_wire': 'Remove a wire from the current project.',
    'wire_circuit': 'Add a whole batch of exact pin connections atomically, with revision check and known rail-short validation. One invalid connection rejects all changes. Returns project, added wires, warnings and validation scope.',
    'validate_circuit': 'Inspect actual current wires and known rail/LED topology; return evidence and limited-validation warnings. Does not certify general electrical safety.',
    'check_connections': 'Check current structural connections and existing rail/LED diagnostics. Read-only by default. With repair=true and expected_revision, canonicalize recognized aliases and remove redundant self/duplicate wires only if a full recheck passes. Never guesses missing connections or fixes electrical intent; returns remaining findings and scope.',
    'generate_firmware': 'Write complete model-generated Arduino source to the current project.',
    'read_firmware': 'Read the current project firmware source and revision.',
    'edit_firmware': 'Replace firmware with source, or make one exact old/new replacement.',
    'compile_firmware': 'Compile current firmware and return actual diagnostics and an artifact; does not start simulation.',
    'run_simulation': 'Start the current artifact in the connected browser, requiring acknowledgement.',
    'stop_simulation': 'Stop simulation in the connected browser, requiring acknowledgement.',
    'read_simulation_results': 'Read actual browser runtime results, requiring acknowledgement.',
    'read_compiler_errors': 'Read the latest compiler diagnostics; never compile implicitly.',
    'calculator': 'Evaluate a bounded numeric expression, without requiring a project. No code or shell execution.',
}
_SCHEMAS = {
    name: create_model(f'{name.title().replace("_", "")}Args', __base__=_Args, **fields)
    for name, fields in _TOOL_FIELDS.items()
}
_SCHEMAS['ask_project_questions'] = _Questions
_SCHEMAS['assess_project_feasibility'] = _Assessment
_SCHEMAS['search_example_requirements'] = create_model('SearchExampleRequirementsArgs', __base__=_Args, query=(str, Field(min_length=1, max_length=200)), limit=(int, Field(default=3, ge=1, le=8)), board=_optional(str, max_length=128))
_SCHEMAS['get_example_reference'] = create_model('GetExampleReferenceArgs', __base__=_Args, example_id=(str, Field(min_length=1, max_length=128)))