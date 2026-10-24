/* graphomata web demo — a Python subset, interpreted with generators.
 *
 * The interpreter yields after every mutating VM call, which is what makes
 * "step" mean "one primitive op" instead of "one syntax tree node".
 * Supported: def / if / elif / else / while / for / break / continue / return /
 * assignment (incl. tuple unpacking) / calls / attributes / arithmetic /
 * comparisons / and / or / not / print / range / len.
 */
(function (root, factory) {
  const mod = { Py: factory() };
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.GM = Object.assign(root.GM || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class PyError extends Error {
    constructor(message, line) {
      super(message);
      this.line = line;
      this.py = true;
    }
  }

  // ------------------------------------------------------------------ lexer
  const KEYWORDS = new Set([
    "def", "if", "elif", "else", "while", "for", "in", "return", "break",
    "continue", "pass", "and", "or", "not", "True", "False", "None",
  ]);

  function tokenize(src) {
    const tokens = [];
    const indents = [0];
    let i = 0, line = 1, depth = 0, atLineStart = true;

    const push = (type, value, ln) => tokens.push({ type, value, line: ln });

    while (i < src.length) {
      if (atLineStart) {
        let j = i, col = 0;
        while (j < src.length && (src[j] === " " || src[j] === "\t")) {
          col += src[j] === "\t" ? 4 : 1;
          j++;
        }
        let k = j;
        while (k < src.length && src[k] !== "\n") k++;
        const rest = src.slice(j, k).trim();
        if (rest === "" || rest.startsWith("#")) {
          i = k < src.length ? k + 1 : k;
          if (k < src.length) line++;
          continue;
        }
        const top = indents[indents.length - 1];
        if (col > top) {
          indents.push(col);
          push("indent", col, line);
        } else if (col < top) {
          while (indents.length > 1 && col < indents[indents.length - 1]) {
            indents.pop();
            push("dedent", col, line);
          }
          if (col !== indents[indents.length - 1]) {
            throw new PyError("缩进不一致", line);
          }
        }
        atLineStart = false;
        i = j;
        continue;
      }

      const ch = src[i];
      if (ch === "\n") {
        if (depth === 0) {
          const last = tokens[tokens.length - 1];
          if (!last || last.type !== "newline") push("newline", "\n", line);
          atLineStart = true;
        }
        line++;
        i++;
        continue;
      }
      if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
      if (ch === "#") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1, out = "";
        while (j < src.length && src[j] !== ch) {
          if (src[j] === "\\") {
            const e = src[j + 1];
            out += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e;
            j += 2;
            continue;
          }
          if (src[j] === "\n") throw new PyError("字符串不能跨行", line);
          out += src[j++];
        }
        if (j >= src.length) throw new PyError("字符串没有闭合", line);
        push("string", out, line);
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) {
          j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
        push("number", src.slice(i, j), line);
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        push("name", src.slice(i, j), line);
        i = j;
        continue;
      }
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      if (["//=", "**="].includes(three)) { push("op", three, line); i += 3; continue; }
      if (["**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%="].includes(two)) {
        push("op", two, line);
        i += 2;
        continue;
      }
      if ("+-*/%=<>()[],:.".includes(ch)) {
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
        push("op", ch, line);
        i++;
        continue;
      }
      throw new PyError(`无法识别的字符 ${JSON.stringify(ch)}`, line);
    }

    const last = tokens[tokens.length - 1];
    if (last && last.type !== "newline") push("newline", "\n", line);
    while (indents.length > 1) { indents.pop(); push("dedent", 0, line); }
    push("eof", "", line);
    return tokens;
  }

  // ----------------------------------------------------------------- parser
  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
    }
    peek(k = 0) { return this.tokens[this.pos + k]; }
    at(type, value) {
      const t = this.peek();
      return t.type === type && (value === undefined || t.value === value);
    }
    atName(value) { return this.at("name", value); }
    next() { return this.tokens[this.pos++]; }
    expect(type, value) {
      const t = this.peek();
      if (t.type !== type || (value !== undefined && t.value !== value)) {
        throw new PyError(`期望 ${value || type}，实际是 ${t.value || t.type}`, t.line);
      }
      return this.next();
    }
    skipNewlines() { while (this.at("newline")) this.next(); }

    parseProgram() {
      const body = [];
      this.skipNewlines();
      while (!this.at("eof")) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      return body;
    }

    parseStatement() {
      const t = this.peek();
      if (t.type === "name") {
        switch (t.value) {
          case "def": return this.parseDef();
          case "if": return this.parseIf();
          case "while": return this.parseWhile();
          case "for": return this.parseFor();
          case "return": return this.parseReturn();
          case "break": { this.next(); this.endLine(); return { t: "break", line: t.line }; }
          case "continue": { this.next(); this.endLine(); return { t: "continue", line: t.line }; }
          case "pass": { this.next(); this.endLine(); return { t: "pass", line: t.line }; }
          default: break;
        }
      }
      return this.parseSimple();
    }

    endLine() { if (this.at("newline")) this.next(); }

    parseSuite() {
      this.expect("op", ":");
      if (this.at("newline")) this.next();
      if (!this.at("indent")) throw new PyError("这里需要缩进的代码块", this.peek().line);
      this.next();
      const body = [];
      while (!this.at("dedent") && !this.at("eof")) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      if (this.at("dedent")) this.next();
      if (body.length === 0) throw new PyError("代码块不能为空", this.peek().line);
      return body;
    }

    parseDef() {
      const line = this.next().line;
      const name = this.expect("name").value;
      this.expect("op", "(");
      const params = [];
      while (!this.at("op", ")")) {
        params.push(this.expect("name").value);
        if (this.at("op", ",")) this.next();
        else break;
      }
      this.expect("op", ")");
      return { t: "def", name, params, body: this.parseSuite(), line };
    }

    parseIf() {
      const line = this.next().line;
      const branches = [];
      let cond = this.parseExpr();
      let body = this.parseSuite();
      branches.push({ cond, body });
      while (this.atName("elif")) {
        this.next();
        cond = this.parseExpr();
        body = this.parseSuite();
        branches.push({ cond, body });
      }
      let orelse = null;
      if (this.atName("else")) {
        this.next();
        orelse = this.parseSuite();
      }
      return { t: "if", branches, orelse, line };
    }

    parseWhile() {
      const line = this.next().line;
      const cond = this.parseExpr();
      const body = this.parseSuite();
      return { t: "while", cond, body, line };
    }

    parseFor() {
      const line = this.next().line;
      const name = this.expect("name").value;
      this.expect("name", "in");
      const iter = this.parseExpr();
      const body = this.parseSuite();
      return { t: "for", name, iter, body, line };
    }

    parseReturn() {
      const line = this.next().line;
      if (this.at("newline")) { this.next(); return { t: "return", value: null, line }; }
      const value = this.parseExprList();
      this.endLine();
      return { t: "return", value, line };
    }

    parseSimple() {
      const line = this.peek().line;
      const targets = this.parseExprList();
      const t = this.peek();
      if (t.type === "op" && (t.value === "=" || t.value.endsWith("=") && ["+=", "-=", "*=", "/=", "%="].includes(t.value))) {
        this.next();
        const value = this.parseExprList();
        this.endLine();
        const list = targets.t === "tuple" ? targets.items : [targets];
        return { t: "assign", op: t.value, targets: list, value, line };
      }
      this.endLine();
      if (targets.t === "tuple" && targets.items.length === 1) return { t: "expr", value: targets.items[0], line };
      return { t: "expr", value: targets, line };
    }

    parseExprList() {
      const items = [this.parseExpr()];
      while (this.at("op", ",")) {
        this.next();
        if (this.at("newline") || this.at("op", "=") || this.at("op", ")")) break;
        items.push(this.parseExpr());
      }
      return items.length === 1 ? items[0] : { t: "tuple", items, line: items[0].line };
    }

    parseExpr() { return this.parseOr(); }

    parseOr() {
      let left = this.parseAnd();
      while (this.atName("or")) {
        const line = this.next().line;
        left = { t: "bool", op: "or", left, right: this.parseAnd(), line };
      }
      return left;
    }

    parseAnd() {
      let left = this.parseNot();
      while (this.atName("and")) {
        const line = this.next().line;
        left = { t: "bool", op: "and", left, right: this.parseNot(), line };
      }
      return left;
    }

    parseNot() {
      if (this.atName("not")) {
        const line = this.next().line;
        return { t: "unary", op: "not", value: this.parseNot(), line };
      }
      return this.parseComparison();
    }

    parseComparison() {
      let left = this.parseArith();
      const ops = [], items = [left];
      while (this.at("op") && ["==", "!=", "<", ">", "<=", ">="].includes(this.peek().value)) {
        const op = this.next();
        ops.push(op.value);
        items.push(this.parseArith());
        left = null;
      }
      if (!ops.length) return items[0];
      return { t: "compare", ops, items, line: items[0].line };
    }

    parseArith() {
      let left = this.parseTerm();
      while (this.at("op") && ["+", "-"].includes(this.peek().value)) {
        const op = this.next();
        left = { t: "bin", op: op.value, left, right: this.parseTerm(), line: op.line };
      }
      return left;
    }

    parseTerm() {
      let left = this.parseUnary();
      while (this.at("op") && ["*", "/", "//", "%"].includes(this.peek().value)) {
        const op = this.next();
        left = { t: "bin", op: op.value, left, right: this.parseUnary(), line: op.line };
      }
      return left;
    }

    parseUnary() {
      if (this.at("op") && ["-", "+"].includes(this.peek().value)) {
        const op = this.next();
        return { t: "unary", op: op.value, value: this.parseUnary(), line: op.line };
      }
      return this.parsePower();
    }

    parsePower() {
      const base = this.parsePostfix();
      if (this.at("op", "**")) {
        const op = this.next();
        return { t: "bin", op: "**", left: base, right: this.parseUnary(), line: op.line };
      }
      return base;
    }

    parsePostfix() {
      let node = this.parseAtom();
      for (;;) {
        if (this.at("op", ".")) {
          const line = this.next().line;
          const name = this.expect("name").value;
          node = { t: "attr", obj: node, name, line };
        } else if (this.at("op", "(")) {
          const line = this.next().line;
          const args = [];
          while (!this.at("op", ")")) {
            args.push(this.parseExpr());
            if (this.at("op", ",")) this.next();
            else break;
          }
          this.expect("op", ")");
          node = { t: "call", fn: node, args, line };
        } else if (this.at("op", "[")) {
          const line = this.next().line;
          const index = this.parseExpr();
          this.expect("op", "]");
          node = { t: "index", obj: node, index, line };
        } else {
          break;
        }
      }
      return node;
    }

    parseAtom() {
      const t = this.peek();
      if (t.type === "number") { this.next(); return { t: "num", v: Number(t.value), line: t.line }; }
      if (t.type === "string") { this.next(); return { t: "str", v: t.value, line: t.line }; }
      if (t.type === "name") {
        if (t.value === "True") { this.next(); return { t: "const", v: true, line: t.line }; }
        if (t.value === "False") { this.next(); return { t: "const", v: false, line: t.line }; }
        if (t.value === "None") { this.next(); return { t: "const", v: null, line: t.line }; }
        this.next();
        return { t: "name", v: t.value, line: t.line };
      }
      if (t.type === "op" && t.value === "(") {
        this.next();
        if (this.at("op", ")")) { this.next(); return { t: "tuple", items: [], line: t.line }; }
        const items = [this.parseExpr()];
        while (this.at("op", ",")) {
          this.next();
          if (this.at("op", ")")) break;
          items.push(this.parseExpr());
        }
        this.expect("op", ")");
        return items.length === 1 ? items[0] : { t: "tuple", items, line: t.line };
      }
      if (t.type === "op" && t.value === "[") {
        this.next();
        const items = [];
        while (!this.at("op", "]")) {
          items.push(this.parseExpr());
          if (this.at("op", ",")) this.next();
          else break;
        }
        this.expect("op", "]");
        return { t: "list", items, line: t.line };
      }
      throw new PyError(`这里不该出现 ${t.value || t.type}`, t.line);
    }
  }

  function parse(src) {
    return new Parser(tokenize(src)).parseProgram();
  }

  // ------------------------------------------------------------------ values
  class Scope {
    constructor(parent) {
      this.parent = parent;
      this.vars = new Map();
    }
    has(name) {
      let s = this;
      while (s) {
        if (s.vars.has(name)) return true;
        s = s.parent;
      }
      return false;
    }
    get(name, line) {
      let s = this;
      while (s) {
        if (s.vars.has(name)) return s.vars.get(name);
        s = s.parent;
      }
      throw new PyError(`名字 ${name} 未定义`, line);
    }
    set(name, value) { this.vars.set(name, value); }
  }

  const ReturnSignal = Symbol("return");
  const BreakSignal = Symbol("break");
  const ContinueSignal = Symbol("continue");

  function isGen(v) {
    return !!v && typeof v.next === "function" && typeof v[Symbol.iterator] === "function";
  }

  function truthy(v) {
    if (v === null || v === undefined || v === false) return false;
    if (v === 0 || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }

  function fmt(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return "(" + v.map(fmt).join(", ") + ")";
    return String(v);
  }

  class Cursor {
    constructor(interp, idx, opts = {}) {
      this.interp = interp;
      this.idx = idx;              // 1..7, or -1 for the home sentinel
      this.owned = !!opts.owned;   // created by copy/node/spare -> release on rebind
      this.temp = !!opts.temp;     // expression temporary -> release when consumed
      this.names = new Set();      // variable names currently pointing at this cursor
      if (interp && idx > 0) interp.allCursors.push(this);
    }

    addName(name) {
      if (!name) return;
      // a real variable name replaces the $n placeholder
      if (!name.startsWith("$")) {
        for (const n of [...this.names]) if (n.startsWith("$")) this.names.delete(n);
      }
      this.names.add(name);
    }

    removeName(name) { this.names.delete(name); }
    clearNames() { this.names.clear(); }
    get vm() { return this.interp.vm; }
    position() { return this.idx < 0 ? -1 : this.vm.workers[this.idx]; }
    home() { return this.position() < 0; }
    pos() { return this.position(); }
    toString() { return "cursor(" + (this.idx < 0 ? "home" : "habcdefg"[this.idx]) + ")"; }

    *walk(n = 1) {
      if (this.idx < 0) throw new PyError("home 不能走", this.interp.line);
      for (let i = 0; i < n; i++) {
        this.vm.opWalk(this.idx);
        yield { kind: "op" };
      }
      return this;
    }

    *node() {
      if (this.idx < 0) throw new PyError("home 不能建节点", this.interp.line);
      this.vm.opNode(this.idx);
      yield { kind: "op" };
      return this;
    }

    *copy() {
      const c = this.interp.allocCursor();
      const cursor = new Cursor(this.interp, c, { owned: true });
      cursor.addName("$" + (++this.interp.tempSeq));
      this.vm.opJoin(c, this.idx);
      yield { kind: "op" };
      return cursor;
    }

    *next(n = 1) {
      const c = this.interp.allocCursor();
      const temp = new Cursor(this.interp, c, { owned: true, temp: true });
      temp.addName("$" + (++this.interp.tempSeq));
      this.vm.opJoin(c, this.idx);
      yield { kind: "op" };
      for (let i = 0; i < n; i++) {
        this.vm.opWalk(c);
        yield { kind: "op" };
      }
      return this.interp.trackTemp(temp);
    }

    *join(other) {
      if (this.idx < 0) throw new PyError("home 不能移动", this.interp.line);
      const src = other instanceof Cursor ? other.idx : 0;
      this.vm.opJoin(this.idx, src);
      yield { kind: "op" };
      return this;
    }

    *link(other) {
      if (this.idx < 0 || !(other instanceof Cursor) || other.idx < 0) {
        throw new PyError("link 需要两个站在节点上的 cursor", this.interp.line);
      }
      this.vm.opLink(this.idx, other.idx);
      yield { kind: "op" };
      return this;
    }

    *unlink(other) {
      if (this.idx < 0 || !(other instanceof Cursor) || other.idx < 0) {
        throw new PyError("unlink 需要两个站在节点上的 cursor", this.interp.line);
      }
      this.vm.opUnlink(this.idx, other.idx);
      yield { kind: "op" };
      return this;
    }

    *park() {
      if (this.idx > 0) this.vm.opJoin(this.idx, 0);
      yield { kind: "op" };
      this.clearNames();
      this.interp.forget(this);
      return this;
    }
  }

  class WorldRef {
    constructor(vm) {
      this.vm = vm;
      this.interp = null;
      this.cursors = new Map();
      this.homeCursor = null;
    }

    bind(interp) { this.interp = interp; }

    cursor(name) {
      const idx = "abcdefg".indexOf(name) + 1;
      if (!this.cursors.has(idx)) this.cursors.set(idx, new Cursor(this.interp, idx));
      return this.cursors.get(idx);
    }

    home() {
      if (!this.homeCursor) this.homeCursor = new Cursor(this.interp, -1);
      return this.homeCursor;
    }

    start() {
      // The start cursor is owned by the player: rebinding the name releases it.
      const c = this.cursor("a");
      c.owned = true;
      return c;
    }

    target() {
      // cursor the level parked on the target node (levels that have one)
      const c = this.cursor("b");
      c.owned = true;
      return c;
    }

    *node(c) {
      if (c instanceof Cursor) {
        this.vm.opNode(c.idx);
        yield { kind: "op" };
        return c;
      }
      const idx = this.interp.allocCursor();
      const temp = new Cursor(this.interp, idx, { owned: true, temp: true });
      temp.addName("$" + (++this.interp.tempSeq));
      this.vm.opNode(idx);
      yield { kind: "op" };
      return this.interp.trackTemp(temp);
    }

    spare() {
      const cursor = new Cursor(this.interp, this.interp.allocCursor(), { owned: true });
      cursor.addName("$" + (++this.interp.tempSeq));
      return cursor;
    }

    spares(k) {
      const out = [];
      for (let c = 1; c <= 7 && out.length < k; c++) {
        if (this.vm.workers[c] < 0) out.push(new Cursor(this.interp, c, { owned: true }));
      }
      if (out.length < k) throw new Error("没有足够的空闲寄存器");
      return out;
    }
    *walk(w) { this.vm.opWalk(w); yield { kind: "op" }; return w; }
    *join(dst, src) { this.vm.opJoin(dst, src); yield { kind: "op" }; return dst; }
    *link(a, b) { this.vm.opLink(a, b); yield { kind: "op" }; return a; }
    *unlink(a, b) { this.vm.opUnlink(a, b); yield { kind: "op" }; return a; }
    *peek(dst, src) {
      this.vm.opJoin(dst, src);
      yield { kind: "op" };
      this.vm.opWalk(dst);
      yield { kind: "op" };
      return dst;
    }
    *park(w) { this.vm.opJoin(w, 0); yield { kind: "op" }; return w; }
    test(a, b) { return this.vm.opTest(a, b); }
    at(c) { return this.vm.workers[c] >= 0; }
    at_home(c) { return this.vm.workers[c] < 0; }
    pos(c) { return this.vm.workers[c]; }
  }
  const WORLD_API = new Set([
    "node", "walk", "join", "link", "unlink", "peek", "park",
    "test", "at", "at_home", "pos", "spare", "spares", "home", "start", "target",
  ]);
  const CURSOR_API = new Set([
    "walk", "node", "next", "copy", "join", "link", "unlink", "park", "home", "pos",
  ]);

  // ------------------------------------------------------------ interpreter
  class Interp {
    constructor(program, opts) {
      this.program = program;
      this.vm = opts.vm;
      this.output = opts.output || [];
      this.globals = new Scope(null);
      this.line = 1;
      this.fuel = opts.fuel || 2000000;
      this.tempCursors = [];
      this.allCursors = [];
      this.tempSeq = 0;
      this.installBuiltins();
    }

    installBuiltins() {
      const g = this.globals;
      // The machine's cursors are globals, exactly like in the Python package.
      "habcdefg".split("").forEach((name, i) => g.set(name.toUpperCase(), i));
      const b = (name, fn) => g.set(name, { __builtin: true, name, fn });
      b("print", function* (args, interp) {
        const text = args.map(fmt).join(" ");
        interp.output.push(text);
        yield { kind: "print", text };
      });
      b("range", (args) => {
        let [a, z, step] = args;
        if (z === undefined) { z = a; a = 0; }
        step = step === undefined ? 1 : step;
        if (step === 0) throw new Error("range 的步长不能是 0");
        const out = [];
        if (step > 0) for (let i = a; i < z; i += step) out.push(i);
        else for (let i = a; i > z; i += step) out.push(i);
        if (out.length > 1000000) throw new Error("range 太大了");
        return out;
      });
      b("len", (args) => {
        const v = args[0];
        if (typeof v === "string" || Array.isArray(v)) return v.length;
        throw new Error("len() 只支持字符串和列表");
      });
      b("int", (args) => parseInt(args[0], 10) || 0);
      b("str", (args) => fmt(args[0]));
      b("abs", (args) => Math.abs(args[0]));
      b("min", (args) => Math.min(...args));
      b("max", (args) => Math.max(...args));
      b("sum", (args) => args[0].reduce((a, b) => a + b, 0));
      b("enumerate", (args) => args[0].map((v, i) => [i, v]));
    }

    tick() {
      if (--this.fuel < 0) {
        throw new PyError("执行步数过多（可能是死循环），已中止", this.line);
      }
    }

    labelsByWorker() {
      const out = {};
      for (const c of this.allCursors) {
        if (c.idx > 0 && c.names.size) {
          out[c.idx] = out[c.idx] || [];
          for (const n of c.names) if (!out[c.idx].includes(n)) out[c.idx].push(n);
        }
      }
      return out;
    }

    allocCursor() {
      for (let c = 1; c <= 7; c++) {
        if (this.vm.workers[c] >= 0) continue;
        // A cursor that is at home but still owned is not a free register:
        // handing its worker to someone else would silently alias the two.
        let taken = false;
        for (const cur of this.allCursors) {
          if (cur.owned && cur.idx === c) { taken = true; break; }
        }
        if (!taken) return c;
      }
      throw new PyError("没有空闲寄存器了：先 park 一个 cursor", this.line);
    }

    trackTemp(cursor) {
      this.tempCursors.push(cursor);
      return cursor;
    }

    promote(cursor) {
      cursor.temp = false;
      const i = this.tempCursors.indexOf(cursor);
      if (i >= 0) this.tempCursors.splice(i, 1);
    }

    forget(cursor) {
      cursor.owned = false;
      cursor.temp = false;
      cursor.clearNames();
      const i = this.tempCursors.indexOf(cursor);
      if (i >= 0) this.tempCursors.splice(i, 1);
    }

    releaseCursor(cursor) {
      if (!(cursor instanceof Cursor) || !cursor.owned) return;
      if (cursor.idx > 0 && this.vm.workers[cursor.idx] >= 0) {
        this.vm.opJoinFree(cursor.idx, 0);
      }
      this.forget(cursor);
    }

    isReferenced(env, cursor, exceptName) {
      for (let scope = env; scope; scope = scope.parent) {
        for (const [name, v] of scope.vars) {
          if (scope === env && name === exceptName) continue;
          if (v === cursor) return true;
        }
      }
      return false;
    }

    flushTemps() {
      for (const c of this.tempCursors.slice()) this.releaseCursor(c);
    }

    *start(fnName, args) {
      // Run the top level first: it defines the functions (and any constants).
      yield* this.execBlock(this.program, this.globals);
      if (args[0] instanceof WorldRef) args[0].bind(this);
      const fn = this.globals.get(fnName, 1);
      if (!fn || !fn.__fn) throw new PyError(`需要定义函数 ${fnName}(w)`, 1);
      try {
        yield* this.callValue(fn, args);
      } catch (e) {
        if (e && typeof e === "object" && ReturnSignal in e) return;
        throw e;
      }
    }

    *execBlock(stmts, env) {
      for (const s of stmts) {
        this.line = s.line;
        yield* this.execStmt(s, env);
      }
    }

    *execStmt(s, env) {
      this.tick();
      try {
        yield* this.execStmtInner(s, env);
      } finally {
        this.flushTemps();
      }
    }

    *execStmtInner(s, env) {
      switch (s.t) {
        case "pass":
          return;
        case "expr":
          yield* this.eval(s.value, env);
          return;
        case "def":
          env.set(s.name, { __fn: true, name: s.name, params: s.params, body: s.body, closure: env });
          return;
        case "assign": {
          const value = yield* this.eval(s.value, env);
          if (s.op !== "=") {
            if (s.targets.length !== 1) throw new PyError("增强赋值只能有一个目标", s.line);
            const cur = yield* this.eval(s.targets[0], env);
            const op = s.op.slice(0, -1);
            yield* this.assignTo(s.targets[0], this.binop(op, cur, value, s.line), env);
          } else if (s.targets.length === 1) {
            yield* this.assignTo(s.targets[0], value, env);
          } else {
            if (!Array.isArray(value) || value.length !== s.targets.length) {
              throw new PyError("解包失败：左右数量不一致", s.line);
            }
            for (let i = 0; i < s.targets.length; i++) {
              yield* this.assignTo(s.targets[i], value[i], env);
            }
          }
          return;
        }
        case "if": {
          for (const br of s.branches) {
            if (truthy(yield* this.eval(br.cond, env))) {
              yield* this.execBlock(br.body, env);
              return;
            }
          }
          if (s.orelse) yield* this.execBlock(s.orelse, env);
          return;
        }
        case "while": {
          while (truthy(yield* this.eval(s.cond, env))) {
            try {
              yield* this.execBlock(s.body, env);
            } catch (e) {
              if (e === BreakSignal) break;
              if (e === ContinueSignal) continue;
              throw e;
            }
          }
          return;
        }
        case "for": {
          const items = yield* this.eval(s.iter, env);
          if (!Array.isArray(items) && typeof items !== "string") {
            throw new PyError("for 只能遍历列表/字符串", s.line);
          }
          for (const item of items) {
            env.set(s.name, item);
            try {
              yield* this.execBlock(s.body, env);
            } catch (e) {
              if (e === BreakSignal) break;
              if (e === ContinueSignal) continue;
              throw e;
            }
          }
          return;
        }
        case "return": {
          const value = s.value ? yield* this.eval(s.value, env) : null;
          if (value instanceof Cursor && value.temp) this.promote(value);
          throw { [ReturnSignal]: value };
        }
        case "break":
          throw BreakSignal;
        case "continue":
          throw ContinueSignal;
        default:
          throw new PyError(`暂不支持的语句 ${s.t}`, s.line);
      }
    }

    *assignTo(target, value, env) {
      if (target.t === "name") {
        const old = env.vars.get(target.v);
        if (old instanceof Cursor && old !== value) old.removeName(target.v);
        if (old instanceof Cursor && old.owned && old !== value &&
            !this.isReferenced(env, old, target.v)) {
          this.releaseCursor(old);
        }
        if (value instanceof Cursor) {
          if (value.temp) this.promote(value);
          value.addName(target.v);
        }
        env.set(target.v, value);
        return;
      }
      if (target.t === "index") {
        const obj = yield* this.eval(target.obj, env);
        const idx = yield* this.eval(target.index, env);
        if (!Array.isArray(obj)) throw new PyError("只有列表支持下标赋值", target.line);
        obj[idx] = value;
        return;
      }
      throw new PyError("不能给这个表达式赋值", target.line);
    }

    binop(op, a, b, line) {
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "//": return Math.floor(a / b);
        case "%": return ((a % b) + b) % b;
        case "**": return a ** b;
        default: throw new PyError(`未知运算符 ${op}`, line);
      }
    }

    *eval(e, env) {
      this.tick();
      switch (e.t) {
        case "num": return e.v;
        case "str": return e.v;
        case "const": return e.v;
        case "name": return env.get(e.v, e.line);
        case "tuple": {
          const out = [];
          for (const it of e.items) out.push(yield* this.eval(it, env));
          return out;
        }
        case "list": {
          const out = [];
          for (const it of e.items) out.push(yield* this.eval(it, env));
          return out;
        }
        case "unary": {
          const v = yield* this.eval(e.value, env);
          if (e.op === "not") return !truthy(v);
          if (e.op === "-") return -v;
          return +v;
        }
        case "bin": {
          const a = yield* this.eval(e.left, env);
          const b = yield* this.eval(e.right, env);
          return this.binop(e.op, a, b, e.line);
        }
        case "bool": {
          const a = yield* this.eval(e.left, env);
          if (e.op === "and") return truthy(a) ? yield* this.eval(e.right, env) : a;
          return truthy(a) ? a : yield* this.eval(e.right, env);
        }
        case "compare": {
          const vals = [];
          for (const it of e.items) vals.push(yield* this.eval(it, env));
          const pos = (v) => (v instanceof Cursor ? v.position() : v);
          let result = true;
          for (let i = 0; i < e.ops.length; i++) {
            const a = pos(vals[i]), b = pos(vals[i + 1]);
            const op = e.ops[i];
            const ok =
              op === "==" ? a === b :
              op === "!=" ? a !== b :
              op === "<" ? a < b :
              op === ">" ? a > b :
              op === "<=" ? a <= b : a >= b;
            if (!ok) { result = false; break; }
          }
          for (const v of vals) {
            if (v instanceof Cursor && v.temp) this.releaseCursor(v);
          }
          return result;
        }
        case "attr": {
          const obj = yield* this.eval(e.obj, env);
          if (obj instanceof WorldRef) {
            if (!WORLD_API.has(e.name)) throw new PyError(`World 没有属性 ${e.name}`, e.line);
            return { __method: true, obj, name: e.name };
          }
          if (obj instanceof Cursor) {
            if (!CURSOR_API.has(e.name)) throw new PyError(`cursor 没有属性 ${e.name}`, e.line);
            return { __method: true, obj, name: e.name };
          }
          if (obj && typeof obj === "object" && e.name in obj) return obj[e.name];
          throw new PyError(`没有属性 ${e.name}`, e.line);
        }
        case "index": {
          const obj = yield* this.eval(e.obj, env);
          const idx = yield* this.eval(e.index, env);
          if (obj && typeof obj === "object") return obj[idx];
          throw new PyError("这个值不能取下标", e.line);
        }
        case "call": {
          const callee = yield* this.eval(e.fn, env);
          const args = [];
          for (const a of e.args) args.push(yield* this.eval(a, env));
          this.line = e.line;
          if (this.vm) this.vm.line = e.line;
          return yield* this.callValue(callee, args);
        }
        default:
          throw new PyError(`暂不支持的表达式 ${e.t}`, e.line);
      }
    }

    *callValue(fn, args) {
      if (fn && fn.__method) {
        const result = fn.obj[fn.name](...args);
        const value = isGen(result) ? yield* result : result;
        if (fn.obj instanceof Cursor && fn.obj.temp && !(value instanceof Cursor)) {
          this.releaseCursor(fn.obj);
        }
        return value;
      }
      if (fn && fn.__builtin) {
        const result = fn.fn(args, this);
        if (isGen(result)) return yield* result;
        return result;
      }
      if (fn && fn.__fn) {
        if (args.length !== fn.params.length) {
          throw new PyError(`${fn.name}() 需要 ${fn.params.length} 个参数，给了 ${args.length} 个`, this.line);
        }
        const env = new Scope(fn.closure);
        fn.params.forEach((p, i) => env.set(p, args[i]));
        try {
          yield* this.execBlock(fn.body, env);
        } catch (e) {
          if (e && typeof e === "object" && ReturnSignal in e) return e[ReturnSignal];
          throw e;
        }
        return null;
      }
      throw new PyError("这个值不能被调用", this.line);
    }
  }

  return { PyError, parse, Interp, WorldRef, tokenize };
});
