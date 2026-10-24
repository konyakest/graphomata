"""Level 04 — copy a chain without touching the original.

A fresh node dies immediately unless a cursor stands on it or an edge points
at it, so the copy is grown one node at a time.  A has to stay on the source
head, so a separate cursor does the walking.
"""

from graphomata import A, World


def solve(w: World) -> None:
    src, dst, fresh, nxt = w.spares(4)
    w.join(src, A)   # src := A, leaving A parked on the source head
    w.node(dst)      # head of the copy
    while True:
        w.peek(nxt, src)
        if not w.at(nxt):
            break
        w.node(fresh)
        w.link(dst, fresh)
        w.join(dst, fresh)
        w.join(src, nxt)
