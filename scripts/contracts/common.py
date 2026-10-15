"""Shared plumbing for contract generation: paths, the AST evaluator, schema translation
and canonical IO.

Split out of scripts/gen-contracts.py when the god-file guard flagged it at 1,128 lines.
"""

import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
TOOLS_DIR = CONTRACTS / "tools"

AGENT_SCHEMAS = ROOT / "backend" / "agent" / "schemas.py"
BOARDS_PY = ROOT / "backend" / "hardware" / "boards.py"
PINS_JSON = ROOT / "backend" / "catalog" / "component-pins.json"
AVAILABILITY = ROOT / "docs" / "COMPONENT_SIMULATION_AVAILABILITY.md"

GENERATED_BY = "scripts/gen-contracts.py"
GENERATOR_VERSION = 2


class Unsupported(Exception):
    """Raised when the source uses a construct this generator cannot interpret."""


class Evaluator:
    """Interprets the subset of Python used by backend/agent/schemas.py.

    Supported: Constant, Name (builtins + previously assigned names), Dict, Tuple, List,
    BinOp with BitOr (for `str | None`), Call (Field, _optional, and type constructors),
    Subscript (for list[...] / dict[...]), Attribute (for typing.Literal lookups is NOT
    supported and raises).

    Anything else raises Unsupported so a future edit to the source cannot silently
    produce a wrong contract.
    """

    def __init__(self) -> None:
        self.globals: dict = {}

    def run(self, path: Path, wanted: set[str]) -> dict:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        found: dict = {}
        # Evaluate every module-level assignment in source order, because the tool tables are
        # built from each other (`_TOOL_FIELDS` spreads `_position`, which uses `_optional`).
        # Assignments we do not need and cannot interpret are skipped; ones we DO need fail
        # loudly, so a future edit to the source cannot silently produce a wrong contract.
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                # Pydantic models cannot be interpreted, but their NAMES are referenced as
                # argument types. Register them as opaque markers that type_to_json renders
                # as an object with a pointer back to the defining model.
                self.globals[node.name] = ("__class__", node.name)
                if node.name in wanted:
                    found[node.name] = self.globals[node.name]
                continue
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = [t for t in node.targets if isinstance(t, ast.Name)] \
                if isinstance(node, ast.Assign) else \
                ([node.target] if isinstance(node.target, ast.Name) else [])
            if not targets:
                continue
            name = targets[0].id
            try:
                value = self.eval(node.value)
            except Unsupported:
                if name in wanted:
                    raise Unsupported(
                        f"{path.name}:{node.lineno} evaluating {name}: unsupported construct")
                continue
            self.globals[name] = value
            if name in wanted:
                found[name] = value
        missing = wanted - found.keys()
        if missing:
            raise Unsupported(f"{path.name}: did not find {sorted(missing)}")
        return found

    # --------------------------------------------------------------- dispatch
    def eval(self, node: ast.AST):
        method = getattr(self, f"on_{type(node).__name__}", None)
        if method is None:
            raise Unsupported(f"construct {type(node).__name__}")
        return method(node)

    def on_Constant(self, node):
        return node.value

    def on_Name(self, node):
        if node.id in self.globals:
            return self.globals[node.id]
        if node.id in ("str", "int", "float", "bool", "dict", "list", "None"):
            return {"None": None, "str": str, "int": int, "float": float,
                    "bool": bool, "dict": dict, "list": list}[node.id]
        if node.id == "Literal":  # typing.Literal[...] is compared by value, never emitted
            return ("__literal__", node.id)
        raise Unsupported(f"name {node.id!r}")

    def on_Dict(self, node):
        # `**spread` appears as a key of None in the AST; merge it rather than choke on it.
        out: dict = {}
        for key, value in zip(node.keys, node.values):
            if key is None:
                spread = self.eval(value)
                if not isinstance(spread, dict):
                    raise Unsupported("** spread of a non-mapping")
                out.update(spread)
                continue
            out[self.eval(key)] = self.eval(value)
        return out

    def on_Tuple(self, node):
        return tuple(self.eval(e) for e in node.elts)

    def on_List(self, node):
        return [self.eval(e) for e in node.elts]

    def on_BinOp(self, node):
        if not isinstance(node.op, ast.BitOr):
            raise Unsupported("binary operator other than |")
        left, right = self.eval(node.left), self.eval(node.right)
        return ("__union__", left, right)

    def on_Subscript(self, node):
        container = self.eval(node.value)
        if isinstance(container, tuple) and container and container[0] == "__literal__":
            return ("__literal__", tuple(self.eval(e) for e in node.slice.elts)
                    if isinstance(node.slice, ast.Tuple) else (self.eval(node.slice),))
        if container in (list, dict):
            return ("__generic__", container)
        raise Unsupported(f"subscript of {container!r}")

    def on_Call(self, node):
        func = node.func
        args = [self.eval(a) for a in node.args]
        kwargs = {kw.arg: self.eval(kw.value) for kw in node.keywords}

        # Field(min_length=..., max_length=..., ge=..., pattern=..., default=..., ...)
        if isinstance(func, ast.Name) and func.id == "Field":
            return ("__field__", kwargs)

        # _optional(T, default=None, **constraints) -> ("__opt__", T, constraints)
        if isinstance(func, ast.Name) and func.id == "_optional":
            constraints = dict(kwargs)
            if len(args) > 1:
                constraints["default"] = args[1]
            return ("__opt__", args[0], constraints)

        # Type constructors used bare: dict(_revision) copies a field map, list(x) makes a list.
        if isinstance(func, ast.Name):
            if func.id in ("dict", "list", "tuple", "set") and args:
                return args[0]
            raise Unsupported(f"call to {func.id!r}")

        # str | None, int | None as a bare annotation value
        raise Unsupported("complex call")

    def on_Attribute(self, node):
        raise Unsupported(f"attribute access .{node.attr}")

    def on_Set(self, node):
        return {self.eval(e) for e in node.elts}

    def on_JoinedStr(self, node):
        raise Unsupported("f-string")


def field_to_json(spec) -> dict:
    """('__field__', {constraint: value}) -> a JSON Schema fragment."""
    constraints = spec[1] if isinstance(spec, tuple) else {}
    out: dict = {}
    if "min_length" in constraints:
        out["minLength"] = constraints["min_length"]
    if "max_length" in constraints:
        out["maxLength"] = constraints["max_length"]
    if "ge" in constraints:
        out["minimum"] = constraints["ge"]
    if "le" in constraints:
        out["maximum"] = constraints["le"]
    if "pattern" in constraints:
        out["pattern"] = constraints["pattern"]
    return out


SCALARS = {
    str: {"type": "string"},
    int: {"type": "integer"},
    float: {"type": "number"},
    bool: {"type": "boolean"},
    dict: {"type": "object"},
    list: {"type": "array"},
}


def type_to_json(kind) -> dict:
    if isinstance(kind, tuple):
        tag = kind[0]
        if tag == "__union__":
            parts = []
            for member in kind[1:]:
                parts.extend(type_to_json(member).get("anyOf", [type_to_json(member)]))
            return {"anyOf": parts}
        if tag == "__generic__":
            return {"type": "array" if kind[1] is list else "object"}
        if tag == "__class__":
            return {"type": "object",
                    "description": f"Defined by backend/agent/schemas.py::{kind[1]}. Nested field "
                                   f"constraints are not duplicated here; the pydantic model is "
                                   f"the authority until the contract loader is in place."}
        if tag == "__opt__":
            # Optional[T]: emit T with its constraints. Nullability is conveyed by the field
            # being optional (it always has a default), not by a Union.
            out = type_to_json(kind[1])
            out.update(field_to_json(("__field__", kind[2])))
            return out
        if tag == "__field__":
            return field_to_json(kind)
        # An untagged (type, Field(...)) pair, e.g. `(str, Field(max_length=...))`.
        if len(kind) == 2 and isinstance(kind[1], tuple) and kind[1] and kind[1][0] == "__field__":
            out = type_to_json(kind[0])
            out.update(field_to_json(kind[1]))
            return out
    try:
        return SCALARS.get(kind, {"type": "string"})
    except TypeError:
        # Unhashable: a nested structure we cannot describe. Say so rather than guess.
        return {"type": "object", "description": "Composite argument; see the defining model."}


def build_args_schema(entries: dict) -> dict:
    """entries: {name: type_spec} -> JSON Schema object."""
    properties, required = {}, []
    for name, spec in entries.items():
        merged = type_to_json(spec)
        # An Optional with an explicit default (None unless overridden) is never required.
        has_default = (isinstance(spec, tuple) and spec and spec[0] == "__opt__"
                       and "default" in spec[2])
        if has_default:
            merged["default"] = spec[2]["default"]
        else:
            required.append(name)
        properties[name] = merged
    schema: dict = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = sorted(required)
    return schema


def read_literal_list(path: Path, name: str):
    """Read a module-level literal list without importing the module."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in node.targets):
            ev = Evaluator()
            ev.globals.update({"str": str, "int": int, "float": float, "bool": bool})
            return ev.eval(node.value)
    raise Unsupported(f"{path.name}: {name} not found")


# ================================================== manifest
MANIFEST_FILES = ["graph.schema.json", "port-types.json", "kinds.json", "telemetry.schema.json",
                  "derivations.json", "trial.schema.json", "capability.schema.json",
                  "capability.json", "telemetry.channels.json", "tools/index.json"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest() -> dict:
    files = []
    for rel in MANIFEST_FILES:
        p = CONTRACTS / rel
        if p.exists():
            files.append({"id": rel, "version": 1, "sha256": sha256(p), "bytes": p.stat().st_size})
    if TOOLS_DIR.exists():
        for p in sorted(TOOLS_DIR.glob("*.tool.json")):
            files.append({"id": f"tools/{p.name}", "version": 1, "sha256": sha256(p),
                          "bytes": p.stat().st_size})
    files.sort(key=lambda f: f["id"])
    return {
        "version": 1, "generated_by": GENERATED_BY, "generator_version": GENERATOR_VERSION,
        "description": "Every contract file with the sha256 of its contents. A consumer that "
                       "cannot reproduce these hashes has stale contracts.",
        "files": files,
    }


def dump(value) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
