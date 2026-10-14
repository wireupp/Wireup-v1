#!/usr/bin/env python3
"""Static structure verification for the backend package.

Runs with no third-party dependencies. It answers the question pytest would answer
first after a module extraction or move:

    "does every module parse, does every name resolve, is the import graph acyclic,
     and does every externally imported symbol still exist?"

That is not a substitute for pytest. It is the check that catches a broken package
layout before a single test is collected.

Usage:
    python scripts/verify-backend-structure.py [--quiet]
"""

from __future__ import annotations

import argparse
import ast
import builtins
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
PACKAGES = {"backend.hardware": BACKEND / "hardware", "backend.agent": BACKEND / "agent"}
SKIP_DIRS = {"node_modules", "vendor", ".git", "__pycache__", ".venv", "public", "dist"}

failures: list[str] = []


def note(quiet: bool, *args: object) -> None:
    if not quiet:
        print(*args)


def python_files() -> list[Path]:
    return [f for f in BACKEND.rglob("*.py") if not any(p in SKIP_DIRS for p in f.parts)]


def parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- 1. everything parses
def check_parses(quiet: bool) -> dict[Path, ast.Module]:
    trees: dict[Path, ast.Module] = {}
    for f in python_files():
        try:
            trees[f] = parse(f)
        except SyntaxError as e:
            failures.append(f"syntax error {f.relative_to(ROOT)}:{e.lineno}: {e.msg}")
    note(quiet, f"1. parsed {len(trees)}/{len(python_files())} backend modules")
    return trees


# ------------------------------------------------- 2. every referenced name resolves
def check_names(trees: dict[Path, ast.Module], quiet: bool) -> None:
    """A module's own imports, definitions, parameters and assignments must cover
    every name it reads."""
    for f, tree in trees.items():
        defined = set(dir(builtins)) | {"annotations", "__file__", "__name__", "__doc__"}
        for n in ast.walk(tree):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    defined.add((a.asname or a.name).split(".")[0])
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                defined.add(n.name)
            elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                defined.add(n.id)
            elif isinstance(n, ast.arg):
                defined.add(n.arg)
            elif isinstance(n, ast.ExceptHandler) and n.name:
                defined.add(n.name)
            elif isinstance(n, (ast.Global, ast.Nonlocal)):
                defined.update(n.names)

        missing = sorted(
            {
                n.id
                for n in ast.walk(tree)
                if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in defined
            }
        )
        if missing:
            failures.append(f"{f.relative_to(ROOT)}: unresolved name(s) {missing}")
    note(quiet, "2. checked name resolution in every module")


# ------------------------------------------------------ 3. the import graph is acyclic
def check_no_cycles(trees: dict[Path, ast.Module], quiet: bool) -> None:
    graph: dict[str, set[str]] = {}
    for pkg in PACKAGES.values():
        for f in pkg.glob("*.py"):
            deps = set()
            for n in ast.walk(parse(f)):
                if isinstance(n, ast.ImportFrom) and n.module:
                    target = BACKEND / Path(n.module.replace(".", "/"))
                    if target.parent == pkg:
                        deps.add(target.name + ".py")
            graph[f.name] = deps

    order: list[str] = []
    state: dict[str, int] = {}

    def visit(node: str, stack: list[str]) -> None:
        if state.get(node) == 1:
            failures.append(f"import cycle: {' -> '.join(stack + [node])}")
            return
        if state.get(node) == 2:
            return
        state[node] = 1
        for dep in sorted(graph.get(node, ())):
            visit(dep, stack + [node])
        state[node] = 2
        order.append(node)

    for node in sorted(graph):
        visit(node, [])
    note(quiet, f"3. import order (acyclic): {' -> '.join(order)}")


# --------------------------------------- 4. externally imported names still exist
def exported_names(pkg: Path) -> set[str]:
    names: set[str] = set()
    for f in pkg.glob("*.py"):
        for node in parse(f).body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.Assign):
                names.update(t.id for t in node.targets if isinstance(t, ast.Name))
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                names.add(node.target.id)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                names.update((a.asname or a.name).split(".")[0] for a in node.names)
    return names


def check_exports(quiet: bool) -> None:
    exports = {pkg: exported_names(d) for pkg, d in PACKAGES.items()}
    pkg_dirs = set(PACKAGES.values())
    checked = 0

    for f in ROOT.rglob("*.py"):
        if any(p in SKIP_DIRS for p in f.parts) or f.parent in pkg_dirs:
            continue
        try:
            tree = parse(f)
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if node.module not in PACKAGES:
                continue
            for alias in node.names:
                if alias.name == "*":
                    continue
                checked += 1
                if alias.name not in exports[node.module]:
                    failures.append(
                        f"{f.relative_to(ROOT)}:{node.lineno}: "
                        f"`from {node.module} import {alias.name}` — not exported"
                    )
    note(quiet, f"4. checked {checked} external imports against the package re-export surface")


# ------------------------------------------------------------------ 5. re-export truth
def check_reexports(quiet: bool) -> None:
    """Every name in __all__ must actually be bound in the package __init__."""
    for pkg, d in PACKAGES.items():
        init = d / "__init__.py"
        if not init.exists():
            failures.append(f"{pkg} has no __init__.py")
            continue
        tree = parse(init)
        bound = set()
        declared: list[str] = []
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                bound.update((a.asname or a.name).split(".")[0] for a in node.names)
            elif isinstance(node, ast.Assign):
                bound.update(t.id for t in node.targets if isinstance(t, ast.Name))
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                bound.add(node.target.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(node.name)
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == "__all__":
                        declared = [e.value for e in node.value.elts]
        bad = sorted(set(declared) - bound)
        if bad:
            failures.append(f"{pkg}.__all__ lists undeclared name(s): {bad}")
    note(quiet, "5. checked every __all__ entry is bound")


def check_executes(quiet: bool) -> None:
    """Modules that must EXECUTE and produce non-empty data.

    Static analysis cannot catch the worst class of split bug: a module that imports
    cleanly but resolves a path to nothing, so a lookup silently returns {}. The v01 split
    did exactly that - boards.py kept parents[1] after moving one level deeper, so every
    ROOT-relative path became backend/backend/... and it loaded 0 component pins instead of
    raising. Only executing the module catches it.
    """
    import importlib.util

    checks_by_file = {
        "backend/hardware/boards.py": {
            "BOARDS": lambda m: len(m.BOARDS) >= 6,
            "PIN_LAYOUTS": lambda m: len(m.PIN_LAYOUTS) >= 40,
            "COMPONENT_PINS": lambda m: len(m.COMPONENT_PINS) >= 100,
            "ROOT resolves to the repo root": lambda m: (m.ROOT / "backend").is_dir(),
            "esp32 pin layout present": lambda m: "esp32-devkit-v1" in m.PIN_LAYOUTS,
        },
    }
    executed = 0
    for rel, checks in checks_by_file.items():
        path = ROOT / rel
        if not path.exists():
            failures.append(f"{rel} does not exist")
            continue
        spec = importlib.util.spec_from_file_location(f"_verify_{path.stem}", path)
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception as error:  # noqa: BLE001 - the message is the point
            failures.append(f"{rel}: failed to execute — {type(error).__name__}: {error}")
            continue
        executed += 1
        for label, predicate in checks.items():
            try:
                ok = predicate(module)
            except Exception as error:  # noqa: BLE001
                failures.append(f"{rel}: check '{label}' raised {type(error).__name__}: {error}")
                continue
            if not ok:
                failures.append(
                    f"{rel}: '{label}' is empty or wrong — the module executed but resolved "
                    f"a path or literal to nothing")
    note(quiet, f"6. executed {executed} data module(s) and asserted their contents")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    trees = check_parses(args.quiet)
    check_names(trees, args.quiet)
    check_no_cycles(trees, args.quiet)
    check_exports(args.quiet)
    check_reexports(args.quiet)
    check_executes(args.quiet)

    if failures:
        print(f"\nFAIL: {len(failures)} structural problem(s)", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1

    print("\nPASS: backend package structure is sound")
    return 0


if __name__ == "__main__":
    sys.exit(main())