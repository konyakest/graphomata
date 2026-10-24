// Level 04 — copy a chain without touching the original.
//
// A fresh node dies immediately unless a cursor stands on it or an edge points
// at it, so the copy is grown one node at a time: allocate, link, advance.
// A must stay on the source head, so a separate cursor does the walking.
#include <graphomata/gm.hpp>

void gm_solve(gm::World& w) {
  using namespace gm;
  auto [src, dst, fresh, nxt] = w.spares<4>();
  w.join(src, A);  // src := A, leaving A parked on the source head
  w.node(dst);     // head of the copy
  while (true) {
    w.peek(nxt, src);
    if (!w.at(nxt)) break;
    w.node(fresh);
    w.link(dst, fresh);
    w.join(dst, fresh);
    w.join(src, nxt);
  }
}
