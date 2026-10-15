"""Tool contracts: one file per tool, extracted from backend/agent/schemas.py.

Every mutating tool declares REVISION_STALE, because invariant I2 (revision safety) is a
property of the contract, not of the handler that happens to implement it today.
"""

from contracts.common import AGENT_SCHEMAS, Evaluator, build_args_schema

MUTATING = {
    "add_component", "remove_component", "modify_component", "connect_wire", "remove_wire",
    "wire_circuit", "check_connections", "generate_firmware", "edit_firmware",
    "compile_firmware", "undo",
}
NO_REVIEW_TOOLS = {"read_project", "search_components", "read_firmware", "validate_circuit",
                   "calculator", "read_compiler_errors", "read_simulation_results"}

COMMON_ERRORS = [
    {"code": "INVALID_ARGUMENTS", "when": "arguments fail the contract's args schema",
     "retryable": False},
]
REVISION_ERROR = {"code": "REVISION_STALE", "retryable": False,
                  "when": "expected_revision does not match the current project revision"}


def errors_for(name: str) -> list:
    if name == "compile_firmware":
        return [REVISION_ERROR,
                {"code": "COMPILER_BUSY", "when": "the compiler gate is saturated",
                 "retryable": True},
                {"code": "COMPILE_ERROR", "when": "the compiler rejected the source",
                 "retryable": False}] + COMMON_ERRORS
    if name in ("run_simulation", "stop_simulation", "read_simulation_results"):
        return [{"code": "RUNTIME_UNAVAILABLE", "retryable": False,
                 "when": "no runtime is connected, or the board has no configured runtime"},
                {"code": "RUNTIME_NOT_ACKNOWLEDGED", "retryable": True,
                 "when": "the browser runtime did not acknowledge the command in time"}] + COMMON_ERRORS
    if name in MUTATING:
        return [REVISION_ERROR] + COMMON_ERRORS
    if name == "search_components":
        return COMMON_ERRORS
    return COMMON_ERRORS


def build_tool_contracts() -> list:
    ev = Evaluator()
    # The module-level names the tool tables are built from, in source order.
    ev.globals.update({
        "str": str, "int": int, "float": float, "bool": bool, "dict": dict, "list": list,
    })
    # `_optional` is a function, handled directly in on_Call; the rest are module-level
    # assignments the tool tables are built from.
    wanted = {"_revision", "_id", "_position", "_source", "_TOOL_FIELDS", "_DESCRIPTIONS"}
    ns = ev.run(AGENT_SCHEMAS, wanted)

    tool_fields = ns["_TOOL_FIELDS"]
    descriptions = ns["_DESCRIPTIONS"]

    tools = []
    for name, entries in tool_fields.items():
        tools.append({
            "name": name,
            "version": 1,
            "title": name.replace("_", " ").title(),
            "summary": descriptions[name],
            "mutating": name in MUTATING,
            "requires_review": name not in NO_REVIEW_TOOLS and name in MUTATING,
            "args": build_args_schema(entries),
            "result": {
                "type": "object",
                "description": "Legacy response shape, byte-for-byte unchanged. Parity against "
                               "backend/hardware/commands.py is asserted in phase v04.",
            },
            "errors": errors_for(name),
            "see_also": [],
            "legacy_names": [name],
        })

    # Tools declared outside _TOOL_FIELDS but bound to the model.
    extra = [
        ("ask_project_questions", "Ask exactly 10 project-specific multiple-choice requirements "
                                 "questions. Board first when the project has no board selected. "
                                 "Pauses for user selection; performs no mutations.",
         {"questions": {"type": "array"}, "summary": {"type": "string"}}, False, False),
        ("search_example_requirements", "Search analyzed upstream prototypes for board, component, "
                                        "library, wiring and runtime requirements, including known "
                                        "capability gaps. A reference, never proof it runs here.",
         {"query": {"type": "string"}, "limit": {"type": "integer"},
          "board": {"type": ["string", "null"]}}, False, False),
        ("get_example_reference", "Read one analyzed upstream prototype: exact parts, connections, "
                                  "firmware source and dependencies. Then build through the "
                                  "current project's tools; never claim the reference ran here.",
         {"example_id": {"type": "string"}}, False, False),
        ("assess_project_feasibility", "Assess a complete plan - board, behaviour, every part with "
                                       "quantity and purpose, libraries, and the exact tool names "
                                       "required - before ANY placement or mutation.",
         {"plan": {"type": "object"}}, False, True),
    ]
    for name, summary, props, mutating, review in extra:
        tools.append({
            "name": name,
            "version": 1,
            "title": name.replace("_", " ").title(),
            "summary": summary,
            "mutating": mutating,
            "requires_review": review,
            "args": {"type": "object", "properties": props, "additionalProperties": False},
            "result": {"type": "object"},
            "errors": COMMON_ERRORS,
            "see_also": [],
            "legacy_names": [name],
        })

    # Bus-level tools that phase v04 implements. Declared now so an agent can see the whole
    # surface, and marked so nobody mistakes a declaration for an implementation.
    future = [
        ("project.create", "Create a project in a domain and return its initial graph.", True),
        ("project.read", "Read a project graph and its revision.", False),
        ("project.delete", "Delete a project.", True),
        ("project.export", "Export a portable bundle: graph, sources, build list, recordings.", False),
        ("node.add", "Add a catalog node to a project.", True),
        ("node.remove", "Remove a node and its incident edges.", True),
        ("node.modify", "Change a node's position, rotation or properties.", True),
        ("edge.connect", "Connect two typed ports.", True),
        ("edge.remove", "Remove an edge.", True),
        ("capability.read", "What can this platform actually build and simulate? Start here.",
         False),
        ("telemetry.read", "Query recorded telemetry by project, trial, node and channel.", False),
        ("trial.run", "Run a goal against the current project and return a verdict.", False),
        ("trial.sweep", "Sweep a parameter space and return a verdict per run.", False),
        ("trial.read", "Read a trial and its recording metadata.", False),
        ("bom.build", "Build a human-readable parts list with wiring and assembly steps.", False),
        ("room.list", "List the stations available in the room.", False),
        ("session.create", "Create an agent session bound to one project.", False),
    ]
    for name, summary, mutating in future:
        # Every mutating tool declares revision conflict, per invariant I2. The checker
        # enforces this: a mutation whose contract omits it would be a silent-overwrite hole.
        errors = ([REVISION_ERROR] if mutating else []) + COMMON_ERRORS
        tools.append({
            "name": name,
            "version": 1,
            "title": name.replace(".", " ").title(),
            "summary": summary,
            "mutating": mutating,
            "requires_review": False,
            "args": {"type": "object", "properties": {}, "additionalProperties": False},
            "result": {"type": "object"},
            "errors": errors,
            "see_also": [],
            "legacy_names": [],
            "implemented_in_phase": "v04",
        })

    tools.append({
        "name": "capability.explain",
        "version": 1,
        "title": "Capability Explain",
        "summary": "Explain whether one catalog kind is simulated, its solver limits, failing tests, and supporting documentation.",
        "mutating": False,
        "requires_review": False,
        "args": {
            "type": "object",
            "properties": {"kind": {"type": "string", "minLength": 1}},
            "required": ["kind"],
            "additionalProperties": False,
        },
        "result": {"type": "object"},
        "errors": COMMON_ERRORS,
        "see_also": ["capability.read"],
        "legacy_names": [],
        "implemented_in_phase": "v06",
    })

    tools.sort(key=lambda t: t["name"])
    return tools
