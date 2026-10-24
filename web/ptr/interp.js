/* Pointer mode — tree-walking interpreter.
 *
 * Values are node ids or null.  Every mutating operation is one step; the
 * interpreter yields after each step so the UI can pause between them.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PTR = Object.assign(root.PTR || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RETURN = Symbol("return");
  const BREAK = Symbol("break");
  const CONTINUE = Symbol("continue");

  class RuntimeError extends Error {
    constructor(message, line) { super(message); this.line = line; }
  }

  const NONE = { node: null, temp: null };
const ABSENT = Symbol("absent");
  const BOOL = (v) => ({ node: null, temp: null, bool: v });

  function truthy(v) {
    if (v.bool !== undefined) return v.bool;
    return v.node !== null;
  }

  class Interp {
    constructor(program, world) {
      this.program = program;
      this.world = world;
      this.vars = new Map();
      this.temps = [];
      this.peak = 0;
      this.result = undefined;
      this.line = 1;
      this.tempSeq = 0;
      this.scopes = [];
    }

    // ------------------------------------------------------------ refs
    refs() {
      const out = [];
      for (const [name, node] of this.vars) {
        if (node !== null && node !== undefined) {
          out.push({ key: "v:" + name, label: name, node, temp: false });
        }
      }
      for (const t of this.temps) {
        if (t.node !== null) out.push({ key: "t:" + t.id, label: t.label, node: t.node, temp: true });
      }
      if (this.result !== null && this.result !== undefined) {
        out.push({ key: "ret", label: "return", node: this.result, temp: false });
      }
      return out;
    }

    roots(refs) {
      const set = new Set();
      for (const r of refs) set.add(r.node);
      // the returned start node is a root even if nothing else points at it
      if (this.result !== null && this.result !== undefined) set.add(this.result);
      return set;
    }

    activeCount() { return this.refs().length; }

    consume(temp) {
      if (!temp) return;
      const i = this.temps.indexOf(temp);
      if (i >= 0) this.temps.splice(i, 1);
      temp.node = null;
    }

    clearTemps(mark = 0) {
      while (this.temps.length > mark) this.temps.pop();
    }

    step(op) {
      this.world.steps += 1;
      const refs = this.refs();
      this.peak = Math.max(this.peak, refs.length);
      this.world.peak = this.peak;
      this.world.gc(this.roots(refs));
      this.world.record(op, refs, this.line);
    }

    // ---------------------------------------------------------- ops
    *opNode(tail) {
      const id = this.world.createNode();
      const temp = { id: ++this.tempSeq, node: id, label: "Node()" };
      this.temps.push(temp);
      if (tail) {
        this.world.steps += 1;
        this.peak = Math.max(this.peak, this.activeCount());
        this.world.peak = this.peak;
        return { node: id, temp, op: "node" };
      }
      this.step("node");
      yield { kind: "step" };
      return { node: id, temp };
    }

    *opNext(recv, baseLabel, tail) {
      if (recv.node === null) throw new RuntimeError("None 没有 next()", this.line);
      const child = this.world.next(recv.node);
      let temp;
      if (recv.temp) {
        recv.temp.node = child;
        recv.temp.label = baseLabel + ".next()";
        temp = recv.temp;
      } else {
        temp = { id: ++this.tempSeq, node: child, label: baseLabel + ".next()" };
        this.temps.push(temp);
      }
      if (tail) {
        this.world.steps += 1;
        this.peak = Math.max(this.peak, this.activeCount());
        this.world.peak = this.peak;
        return { node: child, temp, op: "next" };
      }
      this.step("next");
      yield { kind: "step" };
      return { node: child, temp };
    }

    *opLink(a, b, tail) {
      if (a.node === null || b.node === null) throw new RuntimeError("link 需要两个节点", this.line);
      this.world.link(a.node, b.node);
      this.consume(a.temp);
      this.consume(b.temp);
      if (tail) {
        this.world.steps += 1;
        this.peak = Math.max(this.peak, this.activeCount());
        this.world.peak = this.peak;
        return { node: null, op: "link" };
      }
      this.step("link");
      yield { kind: "step" };
      return NONE;
    }

    *opUnlink(a, b, tail) {
      if (a.node === null || b.node === null) throw new RuntimeError("unlink 需要两个节点", this.line);
      this.world.unlink(a.node, b.node);
      this.consume(a.temp);
      this.consume(b.temp);
      if (tail) {
        this.world.steps += 1;
        this.peak = Math.max(this.peak, this.activeCount());
        this.world.peak = this.peak;
        return { node: null, op: "unlink" };
      }
      this.step("unlink");
      yield { kind: "step" };
      return NONE;
    }

    // --------------------------------------------------------- eval
    labelOf(expr, val) {
      if (val.temp) return val.temp.label;
      if (expr.t === "name") return expr.name;
      return "expr";
    }

    *eval(e, tail = false) {
      switch (e.t) {
        case "name":
          if (!this.vars.has(e.name)) throw new RuntimeError(`变量 ${e.name} 还没定义`, e.line);
          return { node: this.vars.get(e.name), temp: null };
        case "none":
          return NONE;
        case "node":
          return yield* this.opNode(tail);
        case "call": {
          const recv = yield* this.eval(e.recv, false);
          if (e.name === "next") {
            return yield* this.opNext(recv, this.labelOf(e.recv, recv), tail);
          }
          const arg = yield* this.eval(e.args[0], false);
          if (e.name === "link") return yield* this.opLink(recv, arg, tail);
          return yield* this.opUnlink(recv, arg, tail);
        }
        case "is": {
          const a = yield* this.eval(e.left, false);
          const b = yield* this.eval(e.right, false);
          const same = a.node === b.node;
          this.consume(a.temp);
          this.consume(b.temp);
          return BOOL(e.neg ? !same : same);
        }
        case "and": {
          const a = yield* this.eval(e.left, false);
          if (!truthy(a)) return a;
          return yield* this.eval(e.right, false);
        }
        case "or": {
          const a = yield* this.eval(e.left, false);
          if (truthy(a)) return a;
          return yield* this.eval(e.right, false);
        }
        case "not": {
          const a = yield* this.eval(e.value, false);
          return BOOL(!truthy(a));
        }
        default:
          throw new RuntimeError(`不支持的表达式 ${e.t}`, e.line);
      }
    }

    // ------------------------------------------------------ statements
    *execBlock(body) {
      for (const s of body) yield* this.execStmt(s);
    }

    enterScope() {
      this.scopes.push(new Map());
    }

    exitScope() {
      const saved = this.scopes.pop();
      if (!saved) return;
      for (const [name, old] of saved) {
        if (old === ABSENT) this.vars.delete(name);
        else this.vars.set(name, old);
      }
    }

    declare(name) {
      const scope = this.scopes[this.scopes.length - 1];
      if (!scope || scope.has(name)) return;
      scope.set(name, this.vars.has(name) ? this.vars.get(name) : ABSENT);
    }

    *runSuite(body) {
      if (!body) return;
      if (Array.isArray(body)) yield* this.execBlock(body);
      else yield* this.execStmt(body);
    }

    *execStmt(s) {
      this.line = s.line;
      const stepsBefore = this.world.steps;
      const tempsBefore = this.temps.length;
      try {
        switch (s.t) {
          case "pass":
            return;
          case "expr":
            yield* this.eval(s.value);
            return;
          case "assign": {
            if (s.decl) this.declare(s.name);
            if (s.noinit) {
              this.vars.set(s.name, null);
              return;
            }
            const before = this.world.steps;
            // tail: if the outermost expression is a call, it merges with
            // the assignment instead of recording its own frame
            const value = yield* this.eval(s.value, true);
            if (value.temp) this.consume(value.temp);
            this.vars.set(s.name, value.node);

            if (value.op) {
              const refs = this.refs();
              this.peak = Math.max(this.peak, refs.length);
              this.world.peak = this.peak;
              this.world.gc(this.roots(refs));
              this.world.record(value.op, refs, this.line);
              yield { kind: "step" };
            } else if (this.world.steps > before) {
              // steps happened deeper in the expression (e.g. a comparison
              // around a call): show the binding as a merge frame
              const refs = this.refs();
              this.peak = Math.max(this.peak, refs.length);
              this.world.peak = this.peak;
              this.world.gc(this.roots(refs));
              this.world.record("move", refs, this.line);
              yield { kind: "step" };
            } else {
              this.step("move");
              yield { kind: "step" };
            }
            return;
          }
          case "if": {
            for (const br of s.branches) {
              const mark = this.temps.length;
              const cond = yield* this.eval(br.cond);
              this.clearTemps(mark);
              if (truthy(cond)) { yield* this.runSuite(br.body); return; }
            }
            yield* this.runSuite(s.orelse);
            return;
          }
          case "for": {
            for (let k = 0; k < s.count; k++) {
              try {
                yield* this.runSuite(s.body);
              } catch (e) {
                if (e === BREAK) break;
                if (e === CONTINUE) continue;
                throw e;
              }
            }
            return;
          }
          case "block": {
            this.enterScope();
            try {
              yield* this.execBlock(s.body);
            } finally {
              this.exitScope();
            }
            return;
          }
          case "cfor": {
            this.enterScope();
            try {
              if (s.init) yield* this.execStmt(s.init);
              for (;;) {
                if (s.cond) {
                  const mark = this.temps.length;
                  const cond = yield* this.eval(s.cond);
                  this.clearTemps(mark);
                  if (!truthy(cond)) break;
                }
                let brk = false;
                try {
                  yield* this.runSuite(s.body);
                } catch (e) {
                  if (e === BREAK) brk = true;
                  else if (e !== CONTINUE) throw e;
                }
                if (brk) break;
                if (s.update) yield* this.execStmt(s.update);
              }
            } finally {
              this.exitScope();
            }
            return;
          }
          case "while": {
            for (;;) {
              const mark = this.temps.length;
              const cond = yield* this.eval(s.cond);
              this.clearTemps(mark);
              if (!truthy(cond)) break;
              try {
                yield* this.runSuite(s.body);
              } catch (e) {
                if (e === BREAK) break;
                if (e === CONTINUE) continue;
                throw e;
              }
            }
            return;
          }
          case "return": {
            const value = yield* this.eval(s.value);
            this.result = value.node;
            this.consume(value.temp);
            this.temps = [];
            throw RETURN;
          }
          case "break":
            throw BREAK;
          case "continue":
            throw CONTINUE;
          default:
            throw new RuntimeError(`不支持的语句 ${s.t}`, s.line);
        }
      } finally {
        this.clearTemps(tempsBefore);
      }
    }

    begin() {
      this.vars.set(this.program.param, this.world.start);
      this.peak = Math.max(this.peak, this.activeCount());
      this.world.peak = this.peak;
      this.world.gc(this.roots(this.refs()));
      this.world.record("init", this.refs(), 0);
    }

    *run() {
      try {
        yield* this.execBlock(this.program.body);
      } catch (e) {
        if (e !== RETURN) throw e;
      }
      // function scope ends: locals (including the parameter) are released;
      // the returned node is kept as a root by refs()/roots()
      this.vars.clear();
      // final frame reflects the end state (no temps left)
      this.clearTemps();
      this.world.gc(this.roots(this.refs()));
      this.world.record("done", this.refs(), 0);
    }
  }

  return { Interp, RuntimeError };
});
