"""Unit tests for the Python VM.  The C++ side is covered by tools/gmj diff."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from graphomata.core import A, B, C, H, BudgetExceeded, IllegalOp, World, check_goal  # noqa: E402


class TestMachine(unittest.TestCase):
    def test_node_and_cursor(self):
        w = World(10, 1)
        w.node(A)
        self.assertTrue(w.at(A))
        self.assertEqual(w.pos(A), 0)

    def test_gc_reclaims_isolated_nodes(self):
        w = World(10, 1)
        w.node(A)          # node 0, A on it
        w.node(A)          # node 1, A on it — node 0 is now isolated and dies
        self.assertEqual(w.vm.live_nodes(), [1])

    def test_link_keeps_nodes_alive(self):
        w = World(10, 1)
        w.node(A)
        w.node(B)
        w.link(A, B)       # 1 -> 0
        w.join(A, H)       # A goes home, node 0 is still attached
        self.assertEqual(w.vm.live_nodes(), [0, 1])
        self.assertEqual(w.vm.edges(), [(0, 1)])

    def test_illegal_ops(self):
        w = World(10, 1)
        with self.assertRaises(IllegalOp):
            w.walk(A)                 # at home
        with self.assertRaises(IllegalOp):
            w.link(A, B)              # both at home
        w.node(A)
        w.node(B)
        with self.assertRaises(IllegalOp):
            w.link(A, A)              # self link
        w.link(A, B)
        with self.assertRaises(IllegalOp):
            w.link(A, B)              # duplicate
        with self.assertRaises(IllegalOp):
            w.unlink(B, A)            # wrong direction

    def test_test_is_position_equality(self):
        w = World(10, 1)
        w.node(A)
        w.node(B)
        self.assertFalse(w.test(A, B))
        w.join(B, A)
        self.assertTrue(w.test(A, B))
        w.park(B)
        self.assertFalse(w.test(A, B))
        w.park(A)
        self.assertTrue(w.test(A, H))  # both at home

    def test_spares_are_distinct(self):
        w = World(10, 1)
        a, b, c = w.spares(3)
        self.assertEqual(len({a, b, c}), 3)
        self.assertTrue(all(1 <= x <= 7 for x in (a, b, c)))

    def test_spare_is_a_query(self):
        w = World(10, 1)
        self.assertEqual(w.spare(), w.spare())

    def test_walk_is_seeded(self):
        def run(seed):
            w = World(200, seed)
            for i in range(3):
                w.node(i + 1)  # a, b, c on nodes 0..2
            for u in range(1, 4):
                for v in range(1, 4):
                    if u != v:
                        w.link(u, v)  # a complete digraph: two exits per node
            out = []
            for _ in range(12):
                w.walk(A)
                out.append(w.pos(A))
            return out

        self.assertEqual(run(7), run(7))
        self.assertNotEqual(run(7), run(8))

    def test_budget(self):
        w = World(2, 1)
        w.node(A)
        w.node(A)
        with self.assertRaises(BudgetExceeded):
            w.node(A)

    def test_goal_iso(self):
        frame = {"nodes": [0, 1], "edges": [[0, 1]], "workers": [-1, 0, -1, -1, -1, -1, -1, -1]}
        self.assertTrue(check_goal({"iso": {"nodes": 2, "edges": [[0, 1]]}, "workers": {"a": 0}}, frame)[0])
        self.assertFalse(check_goal({"iso": {"nodes": 2, "edges": [[0, 1]]}, "workers": {"a": 1}}, frame)[0])
        self.assertTrue(check_goal({"same": ["a", "b"]}, {**frame, "workers": [-1, 0, 0, -1, -1, -1, -1, -1]})[0])


if __name__ == "__main__":
    unittest.main()
