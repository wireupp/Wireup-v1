#!/usr/bin/env python3
"""Generate contracts/ from the sources of truth already in this repository.

Phase v02 of prompts/. Everything is derived, never invented:

    backend/agent/schemas.py            -> contracts/tools/*.tool.json
    backend/hardware/boards.py          -> contracts/kinds.json  (boards)
    backend/catalog/component-pins.json -> contracts/kinds.json  (parts, pins)
    tests/*.spec.ts                     -> contracts/kinds.json  (simulation evidence)

DEPENDENCY-FREE. backend/agent/schemas.py builds pydantic models, and pydantic is not
installed in every checkout, so the tool tables are read through a small AST evaluator
(scripts/contracts/common.py) instead of by importing. If the source ever uses a construct
the evaluator does not understand, generation FAILS LOUDLY rather than emitting a wrong
contract.

Usage:
    python scripts/gen-contracts.py           # write contracts/
    python scripts/gen-contracts.py --check   # fail if contracts/ is stale
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from contracts.common import (  # noqa: E402
    CONTRACTS, GENERATOR_VERSION, TOOLS_DIR, dump, manifest, write,
)
from contracts.kinds import build_kinds  # noqa: E402
from contracts.schemas import (  # noqa: E402
    capability_schema, capability_stub, derivations, graph_schema, port_types,
    telemetry_schema, trial_schema,
)
from contracts.tools import build_tool_contracts  # noqa: E402


def generate() -> dict:
    CONTRACTS.mkdir(parents=True, exist_ok=True)
    write(CONTRACTS / "graph.schema.json", dump(graph_schema()))
    write(CONTRACTS / "telemetry.schema.json", dump(telemetry_schema()))
    write(CONTRACTS / "trial.schema.json", dump(trial_schema()))
    write(CONTRACTS / "capability.schema.json", dump(capability_schema()))
    write(CONTRACTS / "derivations.json", dump(derivations()))
    write(CONTRACTS / "port-types.json", dump(port_types()))

    kinds = build_kinds()
    write(CONTRACTS / "kinds.json", dump(kinds))
    write(CONTRACTS / "capability.json", dump(capability_stub(kinds["kinds"])))

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    for old in TOOLS_DIR.glob("*.tool.json"):
        old.unlink()
    tools = build_tool_contracts()
    for t in tools:
        write(TOOLS_DIR / f"{t['name']}.tool.json", dump(t))

    write(CONTRACTS / "manifest.json", dump(manifest()))
    return {
        "kinds": len(kinds["kinds"]),
        "tools": len(tools),
        "simulated": sum(1 for k in kinds["kinds"] if k["simulated"]),
        "unresolved": kinds["unresolved_count"],
        "manifest_files": len(manifest()["files"]),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        before = {str(p.relative_to(CONTRACTS)): p.read_text(encoding="utf-8")
                  for p in sorted(CONTRACTS.rglob("*.json"))}
        stats = generate()
        drifted = []
        for p in sorted(CONTRACTS.rglob("*.json")):
            rel = str(p.relative_to(CONTRACTS))
            if rel not in before:
                drifted.append(f"new: {rel}")
            elif before[rel] != p.read_text(encoding="utf-8"):
                drifted.append(f"changed: {rel}")
        if drifted:
            print("contracts: OUT OF DATE", file=sys.stderr)
            for d in drifted:
                print(f"  {d}", file=sys.stderr)
            return 1
        print(f"contracts: current ({stats['kinds']} kinds, {stats['tools']} tools)")
        return 0

    stats = generate()
    print(f"gen-contracts: {stats['kinds']} kinds ({stats['simulated']} simulated, "
          f"{stats['unresolved']} unresolved), {stats['tools']} tools, "
          f"{stats['manifest_files']} manifest entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
