/* C++ subset front-end.
 *
 * Lowers a tiny, pointer-only C++ to the same AST the Python front-end
 * produces, so the interpreter, GC, stepping and judging are shared.
 *
 *   Node* solve(Node* s) {
 *       Node* cur = s;
 *       loop(3) {
 *           cur->link(new Node());
 *           cur = cur->next();
 *       }
 *       return s;
 *   }
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.PTR = Object.assign(root.PTR || {}, mod);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class CppError extends Error {
    constructor(message, line) { super(message); this.line = line; }
  }

  // ---------------------------------------------------------------- lexer
  function tokenize(src) {
    const out = [];
    let i = 0, line = 1;
    const push = (type, value) => out.push({ type, value, line });
    while (i < src.length) {
      const c = src[i];
      if (c === "\n") { line++; i++; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        push("name", src.slice(i, j));
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        push("number", src.slice(i, j));
        i = j;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (["->", "==", "!=", "&&", "||"].includes(two)) {
        push("punct", two);
        i += 2;
        continue;
      }
      if ("{}();,=*!.".includes(c)) {
        push("punct", c);
        i++;
        continue;
      }
      throw new CppError(`不认识这个字符 ${JSON.stringify(c)}`, line);
    }
    out.push({ type: "eof", value: "", line });
    return out;
  }

  // --------------------------------------------------------------- parser
  class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek(k = 0) { return this.tokens[this.pos + k]; }
    next() { return this.tokens[this.pos++]; }
    at(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
    atPunct(v) { return this.at("punct", v); }
    atName(v) { return this.at("name", v); }
    expectPunct(v) {
      const t = this.peek();
      if (!this.atPunct(v)) throw new CppError(`这里应该是 ${v}，实际是 ${t.value || t.type}`, t.line);
      return this.next();
    }
    expectName(v) {
      const t = this.peek();
      if (!this.atName(v)) throw new CppError(`这里应该是 ${v}，实际是 ${t.value || t.type}`, t.line);
      return this.next();
    }
    anyName() {
      const t = this.peek();
      if (t.type !== "name") throw new CppError(`这里应该是变量名，实际是 ${t.value || t.type}`, t.line);
      return this.next().value;
    }

    parseProgram() {
      this.expectName("Node");
      this.expectPunct("*");
      this.expectName("solve");
      this.expectPunct("(");
      this.expectName("Node");
      this.expectPunct("*");
      const param = this.anyName();
      this.expectPunct(")");
      if (!this.atPunct("{")) throw new CppError("solve 后面需要 {", this.peek().line);
      const body = this.parseBlockBody();
      if (!this.at("eof")) throw new CppError("solve 之后不能再有代码", this.peek().line);
      return { param, body };
    }

    parseBlock() {
      const t = this.peek();
      if (!this.atPunct("{")) throw new CppError("这里需要 {", t.line);
      const line = t.line;
      const body = this.parseBlockBody();
      return { t: "block", body, line };
    }

    parseBlockBody() {
      this.expectPunct("{");
      const body = [];
      while (!this.atPunct("}")) {
        if (this.at("eof")) throw new CppError("代码块没有闭合", this.peek().line);
        const s = this.parseStatement();
        if (s) body.push(s);
      }
      this.expectPunct("}");
      return body;
    }

    parseStatement() {
      const t = this.peek();
      if (t.type === "punct" && t.value === "{") return this.parseBlock();
      if (t.type === "punct" && t.value === ";") { this.next(); return null; }
      if (t.type === "name") {
        if (t.value === "if") return this.parseIf();
        if (t.value === "while") return this.parseWhile();
        if (t.value === "for") return this.parseFor();
        if (t.value === "loop") return this.parseLoop();
        if (t.value === "return") {
          this.next();
          const value = this.parseExpr();
          this.expectPunct(";");
          return { t: "return", value, line: t.line };
        }
        if (t.value === "break") { this.next(); this.expectPunct(";"); return { t: "break", line: t.line }; }
        if (t.value === "continue") { this.next(); this.expectPunct(";"); return { t: "continue", line: t.line }; }
        if (t.value === "Node") return this.parseDecl();
        if (t.value === "int" || t.value === "char" || t.value === "bool" || t.value === "void") {
          throw new CppError("只有 Node* 类型", t.line);
        }
      }
      return this.parseSimple();
    }

    parseDecl() {
      const line = this.peek().line;
      const decl = this.parseDeclHeader();
      this.expectPunct(";");
      return decl;
    }

    parseDeclHeader() {
      const line = this.peek().line;
      this.expectName("Node");
      this.expectPunct("*");
      const name = this.anyName();
      if (this.atPunct("=")) {
        this.next();
        const value = this.parseExpr();
        return { t: "assign", name, value, decl: true, line };
      }
      return { t: "assign", name, value: { t: "none", line }, noinit: true, decl: true, line };
    }

    parseSimple() {
      const t = this.peek();
      if (t.type === "name" && this.peek(1).type === "punct" && this.peek(1).value === "=") {
        this.next();
        this.next();
        const value = this.parseExpr();
        this.expectPunct(";");
        return { t: "assign", name: t.value, value, line: t.line };
      }
      const value = this.parseExpr();
      this.expectPunct(";");
      return { t: "expr", value, line: t.line };
    }

    parseIf() {
      const line = this.next().line;
      this.expectPunct("(");
      const cond = this.parseExpr();
      this.expectPunct(")");
      const body = this.parseBlock();
      const branches = [{ cond, body }];
      let orelse = null;
      if (this.atName("else")) {
        this.next();
        orelse = this.atName("if") ? this.parseIf() : this.parseBlock();
      }
      return { t: "if", branches, orelse, line };
    }

    parseWhile() {
      const line = this.next().line;
      this.expectPunct("(");
      const cond = this.parseExpr();
      this.expectPunct(")");
      const body = this.parseBlock();
      return { t: "while", cond, body, line };
    }

    parseFor() {
      const line = this.next().line;
      this.expectPunct("(");

      let init = null;
      if (this.atName("Node")) {
        init = this.parseDeclHeader();
        this.expectPunct(";");
      } else if (!this.atPunct(";")) {
        const name = this.anyName();
        this.expectPunct("=");
        const value = this.parseExpr();
        init = { t: "assign", name, value, line };
        this.expectPunct(";");
      } else {
        this.expectPunct(";");
      }

      let cond = null;
      if (!this.atPunct(";")) cond = this.parseExpr();
      this.expectPunct(";");

      let update = null;
      if (!this.atPunct(")")) {
        const name = this.anyName();
        this.expectPunct("=");
        const value = this.parseExpr();
        update = { t: "assign", name, value, line };
      }
      this.expectPunct(")");

      const body = this.parseBlock();
      return { t: "cfor", init, cond, update, body, line };
    }

    parseLoop() {
      const line = this.next().line;
      this.expectPunct("(");
      const n = this.peek();
      if (n.type !== "number") throw new CppError("loop 需要一个整数常量", n.line);
      this.next();
      const count = Number(n.value);
      if (!Number.isSafeInteger(count) || count > 10000) {
        throw new CppError("loop 的整数最多 10000", n.line);
      }
      this.expectPunct(")");
      const body = this.parseBlock();
      return { t: "for", count, body, line };
    }

    // -------------------------------------------------------- expressions
    parseExpr() { return this.parseOr(); }

    parseOr() {
      let left = this.parseAnd();
      while (this.atPunct("||")) {
        const line = this.next().line;
        left = { t: "or", left, right: this.parseAnd(), line };
      }
      return left;
    }

    parseAnd() {
      let left = this.parseNot();
      while (this.atPunct("&&")) {
        const line = this.next().line;
        left = { t: "and", left, right: this.parseNot(), line };
      }
      return left;
    }

    parseNot() {
      if (this.atPunct("!")) {
        const line = this.next().line;
        return { t: "not", value: this.parseNot(), line };
      }
      return this.parseCompare();
    }

    parseCompare() {
      const left = this.parsePostfix();
      if (this.atPunct("==") || this.atPunct("!=")) {
        const op = this.next();
        const right = this.parsePostfix();
        return { t: "is", left, right, neg: op.value === "!=", line: op.line };
      }
      return left;
    }

    parsePostfix() {
      let node = this.parsePrimary();
      for (;;) {
        if (!this.atPunct("->")) {
          if (this.atPunct(".")) throw new CppError("C++ 模式请用 ->", this.peek().line);
          break;
        }
        const line = this.next().line;
        const name = this.anyName();
        this.expectPunct("(");
        const args = [];
        if (!this.atPunct(")")) {
          args.push(this.parseExpr());
          while (this.atPunct(",")) { this.next(); args.push(this.parseExpr()); }
        }
        this.expectPunct(")");
        if (name === "next") {
          if (args.length) throw new CppError("next() 不带参数", line);
        } else if (name === "link" || name === "unlink") {
          if (args.length !== 1) throw new CppError(`${name}() 需要一个参数`, line);
        } else {
          throw new CppError(`没有这个方法 ${name}`, line);
        }
        node = { t: "call", recv: node, name, args, line };
      }
      return node;
    }

    parsePrimary() {
      const t = this.peek();
      if (t.type === "number") throw new CppError("整数常量只能写在 loop(...) 里", t.line);
      if (t.type === "name") {
        if (t.value === "nullptr") { this.next(); return { t: "none", line: t.line }; }
        if (t.value === "new") {
          this.next();
          this.expectName("Node");
          this.expectPunct("(");
          this.expectPunct(")");
          return { t: "node", line: t.line };
        }
        if (t.value === "Node") throw new CppError("Node 只能写在声明或 new Node() 里", t.line);
        if (["if", "while", "for", "loop", "return", "else", "true", "false"].includes(t.value)) {
          throw new CppError(`${t.value} 不能出现在表达式里`, t.line);
        }
        this.next();
        return { t: "name", name: t.value, line: t.line };
      }
      if (this.atPunct("(")) {
        this.next();
        const e = this.parseExpr();
        this.expectPunct(")");
        return e;
      }
      throw new CppError(`这里不该出现 ${t.value || t.type}`, t.line);
    }
  }

  function parseCpp(src) {
    return new Parser(tokenize(src)).parseProgram();
  }

  return { parseCpp, CppError, tokenizeCpp: tokenize };
});
