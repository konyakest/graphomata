// Level 05 — WALK picks a random out-edge.  You cannot see where you are, only
// whether two cursors share a node, so "random search until A meets B" is the
// whole program.  The judge runs many seeds; a solution that only works for a
// lucky walk is not a solution.
#include <graphomata/gm.hpp>

void gm_solve(gm::World& w) {
  using namespace gm;
  while (!w.test(A, B)) w.walk(A);
}
