// Level 02 — extend a single node into a chain of four.
//
// NODE moves the cursor off its current node, so "the node I just left" is
// only safe because we link it before moving on.  Isolated nodes are garbage
// collected — the graph is the only memory.
#include <graphomata/gm.hpp>

void gm_solve(gm::World& w) {
  using namespace gm;
  Cursor t = w.spare();
  for (int i = 0; i < 3; ++i) {
    w.node(t);
    w.link(A, t);
    w.join(A, t);
  }
}
