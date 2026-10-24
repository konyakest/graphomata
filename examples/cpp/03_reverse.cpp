// Level 03 — reverse a 5-node path.  The tag node 4 -> 0 pins the direction,
// so "do nothing" does not satisfy the goal.
//
// WALK picks a *random* out-edge, so rewiring behind your back is not enough:
// the moment you add the edge nxt -> A, walking out of nxt becomes a coin
// flip.  The fix is to look one node further ahead *before* adding the
// back-edge, so every walk starts from a node that still has a single exit.
#include <graphomata/gm.hpp>

void gm_solve(gm::World& w) {
  using namespace gm;
  auto [nxt, spare] = w.spares<2>();
  w.peek(nxt, A);           // nxt := successor of A
  while (w.at(nxt)) {
    w.peek(spare, nxt);     // read the exit of nxt while it is still clean
    w.unlink(A, nxt);       // ...->A->nxt->...  becomes  ...->A<-nxt->...
    w.link(nxt, A);
    w.join(A, nxt);         // A := nxt
    w.join(nxt, spare);     // nxt := nxt.next  (home ends the loop)
  }
}
