/* Pointer mode — a deliberately tiny Python-like language.
 *
 *   def solve(s):
 *       ...
 *
 * Only node references and None exist.  Statements: assignment, if/elif/else,
 * while, return, break, continue, pass.  Expressions: variables, Node(),
 * None, .next(), .link(x), .unlink(x), is / is not, and/or/not.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PTR = Object.assign(root.PTR || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class ParseError extends Error {
    constructor(message, line) { super(message); this.line = line; }
  }

  const KEYWORDS = new Set([
    "def", "if", "elif", "else", "while", "for", "in", "return", "break",
    "continue", "pass", "is", "not", "and", "or", "None",
  ]);

  // ------------------------------------------------------------------ lexer
  function tokenize(src) {
    const tokens = [];
    const indents = [0];
    let i = 0, line = 1, atLineStart = true;
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
        if (col > top) { indents.push(col); push("indent", col, line); }
        else if (col < top) {
          while (indents.length > 1 && col < indents[indents.length - 1]) {
            indents.pop(); push("dedent", col, line);
          }
          if (col !== indents[indents.length - 1]) throw new ParseError("缩进不一致", line);
        }
        atLineStart = false;
        i = j;
        continue;
      }

      const ch = src[i];
      if (ch === "\n") {
        const last = tokens[tokens.length - 1];
        if (!last || last.type !== "newline") push("newline", "\n", line);
        atLineStart = true;
        line++;
        i++;
        continue;
      }
      if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
      if (ch === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        push("name", src.slice(i, j), line);
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        push("number", src.slice(i, j), line);
        i = j;
        continue;
      }
      if ("=().:".includes(ch)) { push("op", ch, line); i++; continue; }
      throw new ParseError(`不认识这个字符 ${JSON.stringify(ch)}`, line);
    }

    const last = tokens[tokens.length - 1];
    if (last && last.type !== "newline") push("newline", "\n", line);
    while (indents.length > 1) { indents.pop(); push("dedent", 0, line); }
    push("eof", "", line);
    return tokens;
  }

  // ----------------------------------------------------------------- parser
  class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek(k = 0) { return this.tokens[this.pos + k]; }
    at(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
    atName(value) { return this.at("name", value); }
    next() { return this.tokens[this.pos++]; }
    expect(type, value) {
      const t = this.peek();
      if (t.type !== type || (value !== undefined && t.value !== value)) {
        throw new ParseError(`这里应该是 ${value || type}，实际是 ${t.value || t.type}`, t.line);
      }
      return this.next();
    }
    skipNewlines() { while (this.at("newline")) this.next(); }

    parseProgram() {
      this.expect("name", "def");
      this.expect("name", "solve");
      this.expect("op", "(");
      const param = this.expect("name").value;
      this.expect("op", ")");
      const body = this.parseSuite();
      this.skipNewlines();
      if (!this.at("eof")) throw new ParseError("solve 之后不能再有代码", this.peek().line);
      return { param, body };
    }

    parseSuite() {
      this.expect("op", ":");
      if (this.at("newline")) this.next();
      if (!this.at("indent")) throw new ParseError("这里需要缩进的代码块", this.peek().line);
      this.next();
      const body = [];
      while (!this.at("dedent") && !this.at("eof")) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      if (this.at("dedent")) this.next();
      if (!body.length) throw new ParseError("代码块不能为空", this.peek().line);
      return body;
    }

    parseStatement() {
      const t = this.peek();
      if (t.type === "name") {
        if (t.value === "if") return this.parseIf();
        if (t.value === "while") return this.parseWhile();
        if (t.value === "for") return this.parseFor();
        if (t.value === "return") {
          this.next();
          const value = this.parseExpr();
          this.endLine();
          return { t: "return", value, line: t.line };
        }
        if (t.value === "break") { this.next(); this.endLine(); return { t: "break", line: t.line }; }
        if (t.value === "continue") { this.next(); this.endLine(); return { t: "continue", line: t.line }; }
        if (t.value === "pass") { this.next(); this.endLine(); return { t: "pass", line: t.line }; }
        if (t.value === "def") throw new ParseError("除了 solve 不能再定义函数", t.line);
      }

      const expr = this.parseExpr();
      if (this.at("op", "=")) {
        if (expr.t !== "name") throw new ParseError("只能给变量名赋值", t.line);
        this.next();
        const value = this.parseExpr();
        this.endLine();
        return { t: "assign", name: expr.name, value, line: t.line };
      }
      this.endLine();
      return { t: "expr", value: expr, line: t.line };
    }

    endLine() { if (this.at("newline")) this.next(); }

    parseIf() {
      const line = this.next().line;
      const branches = [{ cond: this.parseExpr(), body: this.parseSuite() }];
      while (this.atName("elif")) {
        this.next();
        branches.push({ cond: this.parseExpr(), body: this.parseSuite() });
      }
      let orelse = null;
      if (this.atName("else")) { this.next(); orelse = this.parseSuite(); }
      return { t: "if", branches, orelse, line };
    }

    parseWhile() {
      const line = this.next().line;
      const cond = this.parseExpr();
      return { t: "while", cond, body: this.parseSuite(), line };
    }

    parseFor() {
      const line = this.next().line;
      const v = this.peek();
      if (v.type !== "name" || v.value !== "_") {
        throw new ParseError("for 的循环变量只能是 _", v.line);
      }
      this.next();
      this.expect("name", "in");
      const fn = this.peek();
      if (fn.type !== "name" || fn.value !== "range") {
        throw new ParseError("for 只能写成 for _ in range(整数)", fn.line);
      }
      this.next();
      this.expect("op", "(");
      const num = this.peek();
      if (num.type !== "number") throw new ParseError("range 里需要一个整数常量", num.line);
      this.next();
      const count = Number(num.value);
      if (!Number.isSafeInteger(count) || count > 10000) {
        throw new ParseError("range 的整数最多 10000", num.line);
      }
      this.expect("op", ")");
      return { t: "for", count, body: this.parseSuite(), line };
    }

    parseExpr() { return this.parseOr(); }

    parseOr() {
      let left = this.parseAnd();
      while (this.atName("or")) {
        const line = this.next().line;
        left = { t: "or", left, right: this.parseAnd(), line };
      }
      return left;
    }

    parseAnd() {
      let left = this.parseNot();
      while (this.atName("and")) {
        const line = this.next().line;
        left = { t: "and", left, right: this.parseNot(), line };
      }
      return left;
    }

    parseNot() {
      if (this.atName("not")) {
        const line = this.next().line;
        return { t: "not", value: this.parseNot(), line };
      }
      return this.parseCompare();
    }

    parseCompare() {
      const left = this.parsePostfix();
      if (this.atName("is")) {
        const line = this.next().line;
        const neg = this.atName("not");
        if (neg) this.next();
        return { t: "is", left, right: this.parsePostfix(), neg, line };
      }
      return left;
    }

    parsePostfix() {
      let node = this.parsePrimary();
      for (;;) {
        if (!this.at("op", ".")) break;
        const line = this.next().line;
        const name = this.expect("name").value;
        this.expect("op", "(");
        const args = [];
        if (!this.at("op", ")")) {
          args.push(this.parseExpr());
          while (this.at("op", ",")) {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.expect("op", ")");
        if (name !== "next" && name !== "link" && name !== "unlink") {
          throw new ParseError(`没有这个方法 ${name}`, line);
        }
        if (name === "next" && args.length) throw new ParseError("next() 不带参数", line);
        if (name !== "next" && args.length !== 1) throw new ParseError(`${name}() 需要一个参数`, line);
        node = { t: "call", recv: node, name, args, line };
      }
      return node;
    }

    parsePrimary() {
      const t = this.peek();
      if (t.type === "number") {
        throw new ParseError("整数常量只能写在 range(...) 里", t.line);
      }
      if (t.type === "name") {
        if (t.value === "_") throw new ParseError("_ 不能当变量使用", t.line);
        if (t.value === "range") throw new ParseError("range 只能出现在 for 里", t.line);
        if (t.value === "None") { this.next(); return { t: "none", line: t.line }; }
        if (t.value === "Node") {
          this.next();
          this.expect("op", "(");
          this.expect("op", ")");
          return { t: "node", line: t.line };
        }
        if (KEYWORDS.has(t.value)) throw new ParseError(`${t.value} 不能出现在这里`, t.line);
        this.next();
        return { t: "name", name: t.value, line: t.line };
      }
      if (t.type === "op" && t.value === "(") {
        this.next();
        const e = this.parseExpr();
        this.expect("op", ")");
        return e;
      }
      throw new ParseError(`这里不该出现 ${t.value || t.type}`, t.line);
    }
  }

  function parse(src) {
    return new Parser(tokenize(src)).parseProgram();
  }

  return { parse, tokenize, ParseError };
});
