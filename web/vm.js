/* graphomata web demo — the machine.
 *
 * Same semantics as python/graphomata/core.py and include/graphomata/gm.hpp:
 * five mutating primitives, seven movable cursors, random WALK, GC after every
 * op, ops budgeted.  The browser is a third front end, not a third ruleset.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.GM = Object.assign(root.GM || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const H = 0, A = 1, B = 2, C = 3, D = 4, E = 5, F = 6, G = 7;
  const NAMES = "habcdefg";
  const MASK64 = (1n << 64n) - 1n;

  class GameError extends Error {}
  class IllegalOp extends GameError {}
  class BudgetExceeded extends GameError {}

  class VM {
    constructor(level, seed) {
      this.out = [];
      this.alive = [];
      this.workers = new Array(8).fill(-1);
      this.budget = level.budget;
      this.seed = BigInt(seed);
      this.rng = BigInt(seed);
      this.ops = 0;
      this.peak = 0;
      this.lastTest = false;
      this.frames = [];
      this.line = 0;
      this.error = null;

      const g = level.graph || {};
      for (let i = 0; i < (g.nodes || 0); i++) this.addNode();
      for (const [u, v] of g.edges || []) this.addEdge(u, v);
      for (const [name, node] of Object.entries(g.workers || {})) {
        const c = NAMES.indexOf(name);
        if (c > 0) this.workers[c] = node;
      }
      this.record("init", []);
    }

    // ------------------------------------------------------------- setup
    addNode() {
      const id = this.out.length;
      this.out.push([]);
      this.alive.push(true);
      return id;
    }

    addEdge(u, v) {
      if (u === v) throw new IllegalOp("setup: self edge");
      if (this.out[u].includes(v)) return;
      this.out[u].push(v);
      this.out[u].sort((a, b) => a - b);
    }

    // --------------------------------------------------------------- ops
    charge() {
      this.ops += 1;
      if (this.ops > this.budget) {
        throw new BudgetExceeded(`预算用完了：本关只允许 ${this.budget} 次操作`);
      }
    }

    nextRand() {
      this.rng = (this.rng + 0x9e3779b97f4a7c15n) & MASK64;
      let z = this.rng;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
      return z ^ (z >> 31n);
    }

    opNode(w) {
      if (w === H) throw new IllegalOp("NODE：h 不可移动");
      this.charge();
      const id = this.out.length;
      this.out.push([]);
      this.alive.push(true);
      this.workers[w] = id;
      this.gc();
      this.record("node", [w]);
      return id;
    }

    opWalk(w) {
      if (w === H) throw new IllegalOp("WALK：h 不可移动");
      const at = this.workers[w];
      if (at < 0) throw new IllegalOp("WALK：这个 worker 在 home，不能走");
      this.charge();
      const out = this.out[at];
      let to = -1;
      if (out.length) to = out[Number(this.nextRand() % BigInt(out.length))];
      this.workers[w] = to;
      this.gc();
      this.record("walk", [w]);
    }

    opJoin(dst, src) {
      if (dst === H) throw new IllegalOp("JOIN：h 不可移动");
      this.charge();
      this.workers[dst] = this.workers[src];
      this.gc();
      this.record("join", [dst, src]);
    }

    // JOIN without charging: used for automatic cursor release (API subsidy).
    opJoinFree(dst, src) {
      if (dst === H) return;
      this.workers[dst] = this.workers[src];
      this.gc();
      this.record("release", [dst]);
    }

    opLink(a, b) {
      if (a === H || b === H) throw new IllegalOp("LINK：h 不可移动");
      const u = this.workers[a], v = this.workers[b];
      if (u < 0 || v < 0) throw new IllegalOp("LINK：worker 在 home，没有节点可连");
      if (u === v) throw new IllegalOp("LINK：不能把节点连到自己");
      if (this.out[u].includes(v)) throw new IllegalOp("LINK：这条边已经存在");
      this.charge();
      this.out[u].push(v);
      this.out[u].sort((x, y) => x - y);
      this.gc();
      this.record("link", [a, b]);
    }

    opUnlink(a, b) {
      if (a === H || b === H) throw new IllegalOp("UNLINK：h 不可移动");
      const u = this.workers[a], v = this.workers[b];
      if (u < 0 || v < 0) throw new IllegalOp("UNLINK：worker 在 home");
      const i = this.out[u].indexOf(v);
      if (i < 0) throw new IllegalOp("UNLINK：这条边不存在");
      this.charge();
      this.out[u].splice(i, 1);
      this.gc();
      this.record("unlink", [a, b]);
    }

    // ------------------------------------------------------------- reads
    opTest(a, b) {
      this.lastTest = this.workers[a] === this.workers[b];
      return this.lastTest;
    }

    // -------------------------------------------------------------- book
    gc() {
      const keep = new Array(this.out.length).fill(false);
      for (let c = 0; c < 8; c++) if (this.workers[c] >= 0) keep[this.workers[c]] = true;
      for (let u = 0; u < this.out.length; u++) {
        if (this.out[u].length) keep[u] = true;
        for (const v of this.out[u]) keep[v] = true;
      }
      for (let i = 0; i < this.out.length; i++) if (!keep[i]) this.alive[i] = false;
    }

    record(op, args) {
      const nodes = [];
      for (let i = 0; i < this.out.length; i++) if (this.alive[i]) nodes.push(i);
      const edges = [];
      for (const u of nodes) for (const v of this.out[u]) edges.push([u, v]);
      this.frames.push({ op, args, workers: this.workers.slice(), nodes, edges, ops: this.ops });
      let used = 0;
      for (let c = A; c <= G; c++) if (this.workers[c] >= 0) used++;
      this.peak = Math.max(this.peak, used);
    }

    liveNodes() {
      const out = [];
      for (let i = 0; i < this.out.length; i++) if (this.alive[i]) out.push(i);
      return out;
    }

    edges() {
      return this.frames[this.frames.length - 1].edges;
    }

    lastFrame() {
      return this.frames[this.frames.length - 1];
    }
  }

  // ------------------------------------------------------------- goals
  function* permutations(items) {
    if (items.length <= 1) {
      yield items.slice();
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const rest = items.slice(0, i).concat(items.slice(i + 1));
      for (const p of permutations(rest)) yield [items[i], ...p];
    }
  }

  function checkGoal(goal, frame) {
    const live = frame.nodes;
    const edges = new Set(frame.edges.map(([u, v]) => `${u},${v}`));
    const workers = frame.workers;

    if (goal.iso) {
      const tgt = goal.iso;
      const tedges = (tgt.edges || []).map(([u, v]) => [u, v]);
      const cons = Object.entries(goal.workers || {}).map(([k, v]) => [NAMES.indexOf(k.toLowerCase()), v]);
      if (live.length !== tgt.nodes) {
        return [false, `目标有 ${tgt.nodes} 个节点，现在有 ${live.length} 个`];
      }
      for (const perm of permutations(live)) {
        let ok = true;
        for (const [wu, wt] of cons) {
          if (workers[wu] !== perm[wt]) { ok = false; break; }
        }
        if (!ok) continue;
        let matched = 0;
        for (const [u, v] of tedges) {
          if (!edges.has(`${perm[u]},${perm[v]}`)) { ok = false; break; }
          matched++;
        }
        if (ok && matched === edges.size) return [true, "目标达成"];
      }
      return [false, "图的形状还不对"];
    }

    if (goal.edges) {
      const want = new Set(goal.edges.map(([u, v]) => `${u},${v}`));
      if (want.size !== edges.size) return [false, "边集合不匹配"];
      for (const e of want) if (!edges.has(e)) return [false, "边集合不匹配"];
      if (goal.nodes != null && live.length !== goal.nodes) return [false, "节点数不对"];
      for (const [k, v] of Object.entries(goal.worker_at || {})) {
        if (workers[NAMES.indexOf(k.toLowerCase())] !== v) return [false, `worker ${k} 不在节点 ${v}`];
      }
      return [true, "目标达成"];
    }

    if (goal.same) {
      const [a, b] = goal.same.map((k) => NAMES.indexOf(k.toLowerCase()));
      if (workers[a] >= 0 && workers[a] === workers[b]) return [true, "目标达成"];
      return [false, "两个 worker 还不在同一个节点"];
    }

    return [false, "这个关卡没有目标"];
  }

  return { VM, checkGoal, NAMES, H, A, B, C, D, E, F, G, GameError, IllegalOp, BudgetExceeded };
});
