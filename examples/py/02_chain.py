"""Level 02 — extend a single node into a chain of four."""

from graphomata import A, World


def solve(w: World) -> None:
    t = w.spare()
    for _ in range(3):
        w.node(t)
        w.link(A, t)
        w.join(A, t)
