/* Pointer mode — graph, references, GC.
 *
 * No workers. Variables hold node ids (or null). A step mutates the graph;
 * every step is followed by a GC that marks weakly connected components from
 * the live references and sweeps everything else.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PTR = Object.assign(root.PTR || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MASK64 = (1n << 64n) - 1n;

  class GameError extends Error {}

  class World {
    constructor(level, seed) {
      this.nodes = []; // node id == index
      this.steps = 0;
      this.peak = 0;
      this.frames = [];
      this.seed = BigInt(seed >>> 0);
      this.rng = this.seed;

      const g = level.graph || {};
      for (let i = 0; i < (g.nodes || 0); i++) this.createNode();
      for (const [u, v] of g.edges || []) this.link(u, v);
      this.start = typeof level.start === "number" ? level.start : 0;
    }

    // ------------------------------------------------------------- graph
    createNode() {
      const id = this.nodes.length;
      this.nodes.push({ id, out: new Set(), alive: true });
      return id;
    }

    alive(id) {
      return typeof id === "number" && id >= 0 && id < this.nodes.length && this.nodes[id].alive;
    }

    link(a, b) {
      if (!this.alive(a) || !this.alive(b)) throw new GameError("link: 节点已经被回收");
      if (a === b) throw new GameError("link: 不能连自己");
      if (this.nodes[a].out.has(b)) throw new GameError("link: 这条边已经存在");
      this.nodes[a].out.add(b);
    }

    unlink(a, b) {
      if (!this.alive(a) || !this.alive(b)) throw new GameError("unlink: 节点已经被回收");
      if (!this.nodes[a].out.has(b)) throw new GameError("unlink: 这条边不存在");
      this.nodes[a].out.delete(b);
    }

    children(id) {
      return this.alive(id) ? [...this.nodes[id].out].filter((v) => this.alive(v)) : [];
    }

    next(id) {
      const kids = this.children(id);
      if (!kids.length) return null;
      return kids[Number(this.nextRand() % BigInt(kids.length))];
    }

    nextRand() {
      this.rng = (this.rng + 0x9e3779b97f4a7c15n) & MASK64;
      let z = this.rng;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
      return z ^ (z >> 31n);
    }

    // ---------------------------------------------------------------- GC
    // Directed reachability: roots are references; follow out-edges only.
    // Moving a reference forward therefore lets its old node be collected,
    // unless another reference still reaches it.
    gc(roots) {
      const marked = new Set();
      const stack = [];
      for (const r of roots) if (this.alive(r) && !marked.has(r)) { marked.add(r); stack.push(r); }
      while (stack.length) {
        const u = stack.pop();
        for (const v of this.nodes[u].out) {
          if (this.alive(v) && !marked.has(v)) { marked.add(v); stack.push(v); }
        }
      }
      let swept = 0;
      for (const n of this.nodes) {
        if (n.alive && !marked.has(n.id)) { n.alive = false; n.out.clear(); swept++; }
      }
      for (const n of this.nodes) {
        if (!n.alive) continue;
        for (const v of [...n.out]) if (!this.alive(v)) n.out.delete(v);
      }
      return swept;
    }

    // ------------------------------------------------------------ frames
    liveNodes() {
      const out = [];
      for (const n of this.nodes) if (n.alive) out.push(n.id);
      return out;
    }

    edges() {
      const out = [];
      for (const n of this.nodes) {
        if (!n.alive) continue;
        for (const v of [...n.out].sort((a, b) => a - b)) if (this.alive(v)) out.push([n.id, v]);
      }
      return out;
    }

    record(op, refs, line) {
      this.frames.push({
        step: this.steps,
        op,
        line: line || 0,
        refs: refs.map((r) => ({ key: r.key, label: r.label, node: r.node, temp: !!r.temp })),
        nodes: this.liveNodes(),
        edges: this.edges(),
        peak: this.peak,
      });
    }

    patchLast(refs) {
      const f = this.frames[this.frames.length - 1];
      if (!f) return;
      f.refs = refs.map((r) => ({ key: r.key, label: r.label, node: r.node, temp: !!r.temp }));
      f.nodes = this.liveNodes();
      f.edges = this.edges();
      f.peak = this.peak;
    }
  }

  // ------------------------------------------------------------- goals
  function degreeMaps(nodes, edges) {
    const inD = new Map(), outD = new Map();
    for (const id of nodes) { inD.set(id, 0); outD.set(id, 0); }
    for (const [u, v] of edges) {
      outD.set(u, (outD.get(u) || 0) + 1);
      inD.set(v, (inD.get(v) || 0) + 1);
    }
    return { inD, outD };
  }

  function adjacency(nodes, edges) {
    const out = new Map(), inn = new Map();
    for (const id of nodes) { out.set(id, new Set()); inn.set(id, new Set()); }
    for (const [u, v] of edges) {
      out.get(u).add(v);
      inn.get(v).add(u);
    }
    return { out, inn };
  }

  // 1-WL colour refinement on the disjoint union of both graphs, so the
  // integer colours are comparable across the two sides.
  function refineBoth(aNodes, aEdges, bNodes, bEdges) {
    const ka = (id) => "a:" + id;
    const kb = (id) => "b:" + id;
    const nodes = [...aNodes.map(ka), ...bNodes.map(kb)];
    const edges = [
      ...aEdges.map(([u, v]) => [ka(u), ka(v)]),
      ...bEdges.map(([u, v]) => [kb(u), kb(v)]),
    ];
    const { inD, outD } = degreeMaps(nodes, edges);
    const { out, inn } = adjacency(nodes, edges);
    let color = new Map();
    let nextId = 1;
    const init = new Map();
    for (const id of nodes) {
      const sig = `${inD.get(id)},${outD.get(id)}`;
      if (!init.has(sig)) init.set(sig, nextId++);
      color.set(id, init.get(sig));
    }
    for (;;) {
      const sigs = new Map();
      const next = new Map();
      let next2 = 1;
      for (const id of nodes) {
        const os = [...out.get(id)].map((v) => color.get(v)).sort((a, b) => a - b).join(",");
        const is = [...inn.get(id)].map((v) => color.get(v)).sort((a, b) => a - b).join(",");
        const sig = `${color.get(id)}|${os}|${is}`;
        if (!sigs.has(sig)) sigs.set(sig, next2++);
        next.set(id, sigs.get(sig));
      }
      const before = new Set(color.values()).size;
      const after = new Set(next.values()).size;
      color = next;
      if (after === before) break;
    }
    return [
      new Map(aNodes.map((id) => [id, color.get(ka(id))])),
      new Map(bNodes.map((id) => [id, color.get(kb(id))])),
    ];
  }

  function histogram(color) {
    const m = new Map();
    for (const c of color.values()) m.set(c, (m.get(c) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("|");
  }

  // General digraph isomorphism: colour refinement + VF2-style backtracking.
  function isomorphic(aNodes, aEdges, bNodes, bEdges) {
    if (aNodes.length !== bNodes.length || aEdges.length !== bEdges.length) return false;
    if (!aNodes.length) return true;
    const [ca, cb] = refineBoth(aNodes, aEdges, bNodes, bEdges);
    if (histogram(ca) !== histogram(cb)) return false;

    const A = adjacency(aNodes, aEdges);
    const B = adjacency(bNodes, bEdges);
    const map = new Map(); // a -> b
    const used = new Set();
    let budget = 200000;

    function consistent(u, v) {
      for (const [x, y] of map) {
        if (A.out.get(u).has(x) !== B.out.get(v).has(y)) return false;
        if (A.inn.get(u).has(x) !== B.inn.get(v).has(y)) return false;
        if (A.out.get(x).has(u) !== B.out.get(y).has(v)) return false;
        if (A.inn.get(x).has(u) !== B.inn.get(y).has(v)) return false;
      }
      return true;
    }

    function pick() {
      let best = null, bestC = null;
      for (const u of aNodes) {
        if (map.has(u)) continue;
        const cands = [];
        for (const v of bNodes) {
          if (!used.has(v) && cb.get(v) === ca.get(u) && consistent(u, v)) cands.push(v);
        }
        if (!bestC || cands.length < bestC.length) { best = u; bestC = cands; }
        if (!bestC.length) break;
      }
      return [best, bestC];
    }

    function bt() {
      if (--budget < 0) return false;
      if (map.size === aNodes.length) return true;
      const [u, cands] = pick();
      if (u === null) return false;
      for (const v of cands) {
        map.set(u, v);
        used.add(v);
        if (bt()) return true;
        map.delete(u);
        used.delete(v);
      }
      return false;
    }

    return bt();
  }

  function checkGoal(goal, frame, opts = {}) {
    if (!goal || !goal.iso) return [false, "关卡没有目标"];
    const tgt = goal.iso;
    const live = frame.nodes;
    if (live.length !== tgt.nodes) {
      return [false, `目标 ${tgt.nodes} 个节点，现在 ${live.length} 个`];
    }
    if (frame.edges.length !== (tgt.edges || []).length) {
      return [false, `目标 ${(tgt.edges || []).length} 条边，现在 ${frame.edges.length} 条`];
    }
    const goalNodes = Array.from({ length: tgt.nodes }, (_, i) => i);
    if (!isomorphic(live, frame.edges, goalNodes, tgt.edges || [])) {
      return [false, "图的形状不对"];
    }
    if (goal.return_new) {
      const result = opts.result;
      const initial = opts.initialNodes || 0;
      if (typeof result !== "number" || result < initial) {
        return [false, "需要返回一个新节点"];
      }
    }
    return [true, "目标达成"];
  }

  return { World, GameError, checkGoal, isomorphic };
});
