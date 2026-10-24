"""Level 03 — reverse a 5-node path.

WALK picks a random out-edge, so the naive in-place reversal breaks as soon as
you add a back-edge: walking out of `nxt` becomes a coin flip between its
successor and the node you came from.  Look one node further ahead *before*
adding the back-edge, and every walk starts from a node with a single exit.
"""

from graphomata import A, World


def solve(w: World) -> None:
    nxt, spare = w.spares(2)
    w.peek(nxt, A)            # nxt := successor of A
    while w.at(nxt):
        w.peek(spare, nxt)    # read the exit of nxt while it is still clean
        w.unlink(A, nxt)      # ...->A->nxt->...  becomes  ...->A<-nxt->...
        w.link(nxt, A)
        w.join(A, nxt)        # A := nxt
        w.join(nxt, spare)    # nxt := nxt.next  (home ends the loop)
