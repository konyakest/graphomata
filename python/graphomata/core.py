"""Python mirror of include/graphomata/gm.hpp.

The two implementations must agree op-for-op: same graph, same RNG, same
frames.  tests/difftest.py checks that by running the same solution in both
languages and comparing traces.

Vocabulary
----------
cursor   h, a..g.  h is immovable and always "home" (-1).
home     a cursor that is not standing on any node.
op       one mutation of the world; reads are free.
frame    a snapshot taken after every op (and once at start).
"""

from __future__ import annotations

import itertools
import json
import os
import sys
from typing import Any

H, A, B, C, D, E, F, G = range(8)
NUM_WORKERS = 8
NAMES = "habcdefg"

MASK64 = (1 << 64) - 1


class GameError(Exception):
    pass


class IllegalOp(GameError):
    pass


class BudgetExceeded(GameError):
    pass


def cursor_name(c: int) -> str:
    return NAMES[c] if 0 <= c < NUM_WORKERS else "?"


class VM:
    """The graph machine.  No sugar, no source attribution — see World."""

    def __init__(self, budget: int, seed: int):
        self.out: list[list[int]] = []  # sorted, unique adjacency
        self.alive: list[bool] = []
        self.workers = [-1] * NUM_WORKERS
        self.budget = budget
        self.seed = seed & MASK64
        self.rng = self.seed
        self.ops = 0
        self.peak = 0
        self.last_test = False
        self.error: str | None = None
        self.frames: list[dict[str, Any]] = []
        self.line_costs: dict[str, int] = {}

    # ---------------------------------------------------------------- setup
    def add_node(self) -> int:
        nid = len(self.out)
        self.out.append([])
        self.alive.append(True)
        return nid

    def add_edge(self, u: int, v: int) -> None:
        out = self.out[u]
        if v not in out:
            out.append(v)
            out.sort()

    def set_worker(self, c: int, node: int) -> None:
        if c == H:
            return
        self.workers[c] = node

    def start(self) -> None:
        self._record("init", [])

    # ---------------------------------------------------------------- rng
    def next_rand(self) -> int:
        self.rng = (self.rng + 0x9E3779B97F4A7C15) & MASK64
        z = self.rng
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
        return (z ^ (z >> 31)) & MASK64

    # ------------------------------------------------------------ primitives
    def op_node(self, w: int, line: str | None = None) -> int:
        if w == H:
            raise IllegalOp("NODE: h is immutable")
        if line:
            self.charge("node", line)
        nid = len(self.out)
        self.workers[w] = nid
        self.out.append([])
        self.alive.append(True)
        self._gc()
        self._record("node", [w])
        return nid

    def op_walk(self, w: int, line: str | None = None) -> None:
        if w == H:
            raise IllegalOp("WALK: h is immutable")
        at = self.workers[w]
        if at < 0:
            raise IllegalOp("WALK: cursor is at home")
        if line:
            self.charge("walk", line)
        nxt = -1
        out = self.out[at]
        if out:
            nxt = out[self.next_rand() % len(out)]
        self.workers[w] = nxt
        self._gc()
        self._record("walk", [w])

    def op_join(self, dst: int, src: int, line: str | None = None) -> None:
        if dst == H:
            raise IllegalOp("JOIN: h is immutable")
        if line:
            self.charge("join", line)
        self.workers[dst] = self.workers[src]
        self._gc()
        self._record("join", [dst, src])

    def op_link(self, a: int, b: int, line: str | None = None) -> None:
        if a == H or b == H:
            raise IllegalOp("LINK: h is immutable")
        u, v = self.workers[a], self.workers[b]
        if u < 0 or v < 0:
            raise IllegalOp("LINK: cursor is at home")
        if u == v:
            raise IllegalOp("LINK: a node cannot link to itself")
        if v in self.out[u]:
            raise IllegalOp("LINK: edge already exists")
        if line:
            self.charge("link", line)
        self.out[u].append(v)
        self.out[u].sort()
        self._gc()
        self._record("link", [a, b])

    def op_unlink(self, a: int, b: int, line: str | None = None) -> None:
        if a == H or b == H:
            raise IllegalOp("UNLINK: h is immutable")
        u, v = self.workers[a], self.workers[b]
        if u < 0 or v < 0:
            raise IllegalOp("UNLINK: cursor is at home")
        if v not in self.out[u]:
            raise IllegalOp("UNLINK: no such edge")
        if line:
            self.charge("unlink", line)
        self.out[u].remove(v)
        self._gc()
        self._record("unlink", [a, b])

    def op_test(self, a: int, b: int) -> bool:
        self.last_test = self.workers[a] == self.workers[b]
        return self.last_test

    # ---------------------------------------------------------------- books
    def charge(self, name: str, line: str) -> None:
        self.ops += 1
        if self.ops > self.budget:
            raise BudgetExceeded(f"budget exceeded: the level allows {self.budget} ops")
        self.line_costs[line] = self.line_costs.get(line, 0) + 1

    # ---------------------------------------------------------------- state
    def live_nodes(self) -> list[int]:
        return [i for i, alive in enumerate(self.alive) if alive]

    def edges(self) -> list[tuple[int, int]]:
        return [(u, v) for u in range(len(self.out)) if self.alive[u] for v in self.out[u]]

    def _gc(self) -> None:
        keep = [False] * len(self.out)
        for c in range(NUM_WORKERS):
            if self.workers[c] >= 0:
                keep[self.workers[c]] = True
        for u in range(len(self.out)):
            if self.out[u]:
                keep[u] = True
            for v in self.out[u]:
                keep[v] = True
        for i in range(len(self.out)):
            if not keep[i]:
                self.alive[i] = False

    def _record(self, op: str, args: list[int]) -> None:
        self.frames.append(
            {
                "op": op,
                "args": list(args),
                "workers": list(self.workers),
                "nodes": self.live_nodes(),
                "edges": [list(e) for e in self.edges()],
            }
        )
        used = sum(1 for c in range(A, G + 1) if self.workers[c] >= 0)
        self.peak = max(self.peak, used)


class World:
    """The API the player writes against.  Sugar is priced at its expansion."""

    def __init__(self, budget: int, seed: int):
        self.vm = VM(budget, seed)

    # ---------------------------------------------------------------- setup
    def add_node(self) -> int:
        return self.vm.add_node()

    def add_edge(self, u: int, v: int) -> None:
        self.vm.add_edge(u, v)

    def set_worker(self, c: int, node: int) -> None:
        self.vm.set_worker(c, node)

    def start(self) -> None:
        self.vm.start()

    # ------------------------------------------------------------ primitives
    def _line(self) -> str:
        frame = sys._getframe(2)
        return f"{os.path.basename(frame.f_code.co_filename)}:{frame.f_lineno}"

    def node(self, w: int) -> int:
        """NODE: new node, w stands on it.  Returns w (use w.pos(w) for the id)."""
        self.vm.op_node(w, self._line())
        return w

    def walk(self, w: int) -> int:
        self.vm.op_walk(w, self._line())
        return w

    def join(self, dst: int, src: int) -> int:
        self.vm.op_join(dst, src, self._line())
        return dst

    def link(self, a: int, b: int) -> int:
        self.vm.op_link(a, b, self._line())
        return a

    def unlink(self, a: int, b: int) -> int:
        self.vm.op_unlink(a, b, self._line())
        return a

    # -------------------------------------------------------------- reading
    def test(self, a: int, b: int) -> bool:
        return self.vm.op_test(a, b)

    def at(self, c: int) -> bool:
        return self.vm.workers[c] >= 0

    def at_home(self, c: int) -> bool:
        return self.vm.workers[c] < 0

    def pos(self, c: int) -> int:
        return self.vm.workers[c]

    # ---------------------------------------------------------------- sugar
    def peek(self, dst: int, src: int) -> int:
        line = self._line()
        self.vm.op_join(dst, src, line)
        self.vm.op_walk(dst, line)
        return dst

    def park(self, w: int) -> int:
        self.vm.op_join(w, H, self._line())
        return w

    def spare(self) -> int:
        for c in range(A, G + 1):
            if self.vm.workers[c] < 0:
                return c
        raise IllegalOp("no free register: park a cursor before allocating another")

    def spares(self, k: int) -> tuple[int, ...]:
        out = [c for c in range(A, G + 1) if self.vm.workers[c] < 0][:k]
        if len(out) < k:
            raise IllegalOp("not enough free registers: park a cursor first")
        return tuple(out)

    # ---------------------------------------------------------------- books
    @property
    def ops(self) -> int:
        return self.vm.ops

    @property
    def budget(self) -> int:
        return self.vm.budget


# ------------------------------------------------------------------ goals


def _workers_by_letter() -> dict[str, int]:
    return {NAMES[i]: i for i in range(NUM_WORKERS)}


def check_goal(goal: dict[str, Any], frame: dict[str, Any]) -> tuple[bool, str]:
    """Evaluate a goal against the final frame of a trace."""
    live = frame["nodes"]
    edges = {tuple(e) for e in frame["edges"]}
    workers = frame["workers"]
    letters = _workers_by_letter()

    if "iso" in goal:
        tgt = goal["iso"]
        tn = int(tgt["nodes"])
        tedges = {tuple(e) for e in tgt.get("edges", [])}
        cons = {letters[k.lower()]: v for k, v in goal.get("workers", {}).items()}
        if len(live) != tn:
            return False, f"expected {tn} live nodes, found {len(live)}"
        for perm in itertools.permutations(live):
            if {(perm[u], perm[v]) for u, v in tedges} != edges:
                continue
            if all(workers[c] == perm[t] for c, t in cons.items()):
                return True, "ok"
        return False, "graph does not match the target shape"

    if "edges" in goal:
        want = {tuple(e) for e in goal["edges"]}
        if want != edges:
            missing = sorted(want - edges)
            extra = sorted(edges - want)
            return False, f"edge set mismatch (missing={missing}, extra={extra})"
        if "nodes" in goal and len(live) != int(goal["nodes"]):
            return False, f"expected {goal['nodes']} live nodes, found {len(live)}"
        for k, v in goal.get("worker_at", {}).items():
            if workers[letters[k.lower()]] != int(v):
                return False, f"cursor {k} is not on node {v}"
        return True, "ok"

    if "same" in goal:
        a, b = (letters[k.lower()] for k in goal["same"])
        if workers[a] >= 0 and workers[a] == workers[b]:
            return True, "ok"
        return False, "cursors are not on the same node"

    return False, "level has no goal"
