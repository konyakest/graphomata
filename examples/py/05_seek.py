"""Level 05 — random search: WALK is not deterministic, the judge runs many seeds."""

from graphomata import A, B, World


def solve(w: World) -> None:
    while not w.test(A, B):
        w.walk(A)
