"""Level loading, spec writing, and the two runtimes (C++ / Python)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PY_DIR = os.path.join(ROOT, "python")
HARNESS = os.path.join(ROOT, "tools", "harness.cpp")
INCLUDE = os.path.join(ROOT, "include")
BUILD = os.path.join(ROOT, ".build")


def load_level(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        lv = json.load(fh)
    lv.setdefault("budget", 100)
    lv.setdefault("seeds", [1])
    lv.setdefault("graph", {})
    g = lv["graph"]
    g.setdefault("nodes", 0)
    g.setdefault("edges", [])
    g.setdefault("workers", {})
    lv["_path"] = path
    return lv


def write_spec(level: dict[str, Any], seed: int, path: str) -> None:
    g = level["graph"]
    lines = [
        f"id {level.get('id', 'level')}",
        f"seed {seed}",
        f"budget {level['budget']}",
        f"nodes {g['nodes']}",
    ]
    for u, v in g["edges"]:
        lines.append(f"edge {u} {v}")
    for name, node in g["workers"].items():
        lines.append(f"worker {name} {node}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _run(cmd: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PYTHONPATH"] = PY_DIR + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)


def run_python(level: dict[str, Any], solution: str, seed: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as td:
        spec = os.path.join(td, "spec.txt")
        trace = os.path.join(td, "trace.json")
        write_spec(level, seed, spec)
        proc = _run([sys.executable, "-m", "graphomata.runner", spec, trace, solution])
        if not os.path.exists(trace):
            raise RuntimeError(f"python runner produced no trace: {proc.stderr.strip()}")
        with open(trace, encoding="utf-8") as fh:
            return json.load(fh)


def compile_cpp(solution: str) -> str:
    os.makedirs(BUILD, exist_ok=True)
    hdr = os.path.join(INCLUDE, "graphomata", "gm.hpp")
    key = "|".join(
        [os.path.abspath(solution), str(os.path.getmtime(solution)),
         str(os.path.getmtime(hdr)), str(os.path.getmtime(HARNESS))]
    )
    digest = hashlib.sha1(key.encode()).hexdigest()[:16]
    exe = os.path.join(BUILD, os.path.basename(solution).replace(".cpp", "") + "-" + digest)
    if os.path.exists(exe):
        return exe
    cmd = [
        os.environ.get("CXX", "g++"), "-std=c++20", "-O2", "-Wall", "-Wextra",
        "-I", INCLUDE, solution, HARNESS, "-o", exe,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError("compile failed:\n" + proc.stderr)
    return exe


def run_cpp(level: dict[str, Any], solution: str, seed: int) -> dict[str, Any]:
    exe = compile_cpp(solution)
    with tempfile.TemporaryDirectory() as td:
        spec = os.path.join(td, "spec.txt")
        trace = os.path.join(td, "trace.json")
        write_spec(level, seed, spec)
        proc = subprocess.run([exe, spec, trace], capture_output=True, text=True, timeout=10.0)
        if not os.path.exists(trace):
            raise RuntimeError(f"cpp runner produced no trace: {proc.stderr.strip()}")
        with open(trace, encoding="utf-8") as fh:
            return json.load(fh)


def run(level: dict[str, Any], solution: str, seed: int) -> tuple[dict[str, Any], float]:
    import time

    t0 = time.perf_counter()
    if solution.endswith(".cpp") or solution.endswith(".cc"):
        trace = run_cpp(level, solution, seed)
    else:
        trace = run_python(level, solution, seed)
    return trace, time.perf_counter() - t0


def final_frame(trace: dict[str, Any]) -> dict[str, Any]:
    return trace["frames"][-1]


def main() -> int:
    """Entry point: python -m graphomata.runner spec.txt trace.json solution.py"""
    spec, trace_path, sol = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(spec, encoding="utf-8") as fh:
        fields = {}
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "edge":
                fields.setdefault("edges", []).append([int(parts[1]), int(parts[2])])
            elif parts[0] == "worker":
                fields.setdefault("workers", {})[parts[1]] = int(parts[2])
            elif parts[0] == "nodes":
                fields["nodes"] = int(parts[1])
            elif parts[0] == "budget":
                fields["budget"] = int(parts[1])
            elif parts[0] == "seed":
                fields["seed"] = int(parts[1])
            elif parts[0] == "id":
                fields["id"] = parts[1]

    from .core import World

    w = World(fields.get("budget", 100), fields.get("seed", 1))
    for _ in range(fields.get("nodes", 0)):
        w.add_node()
    for u, v in fields.get("edges", []):
        w.add_edge(u, v)
    for name, node in fields.get("workers", {}).items():
        w.set_worker("habcdefg".index(name), node)
    w.start()

    spec_mod = importlib.util.spec_from_file_location("gm_solution", sol)
    if spec_mod is None or spec_mod.loader is None:
        raise RuntimeError(f"cannot load {sol}")
    module = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(module)
    try:
        module.solve(w)
    except Exception as exc:  # noqa: BLE001 - surfaced in the trace
        w.vm.error = f"{type(exc).__name__}: {exc}"

    trace = {
        "level": fields.get("id", "level"),
        "seed": fields.get("seed", 1),
        "budget": w.budget,
        "ops": w.ops,
        "peak_registers": w.vm.peak,
        "error": w.vm.error,
        "line_costs": w.vm.line_costs,
        "frames": w.vm.frames,
    }
    with open(trace_path, "w", encoding="utf-8") as fh:
        json.dump(trace, fh, indent=1)
    print(f"ops={w.ops} peak={w.vm.peak}" + (f' error="{w.vm.error}"' if w.vm.error else ""))
    return 0 if not w.vm.error else 1


if __name__ == "__main__":
    raise SystemExit(main())
