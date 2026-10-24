/* Headless tests for pointer mode.  node web/ptr/test.js */
"use strict";

const path = require("path");
const { World, checkGoal } = require(path.join(__dirname, "world.js"));
const { parse } = require(path.join(__dirname, "parser.js"));
const { Interp } = require(path.join(__dirname, "interp.js"));
const { LEVELS, casesOf, cppFor } = require(path.join(__dirname, "levels.js"));
const { parseCpp } = require(path.join(__dirname, "cpp.js"));

function run(level, code, seed = 1, parser = parse) {
  const world = new World(level, seed);
  const interp = new Interp(parser(code), world);
  interp.begin();
  const gen = interp.run();
  let result = gen.next();
  let guard = 0;
  while (!result.done) {
    result = gen.next();
    if (++guard > 20000) throw new Error("too many steps");
  }
  return { world, interp };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); }
}

// ------------------------------------------------------------------ levels
console.log("— levels");
for (const level of LEVELS) {
  const cases = casesOf(level);
  for (const c of cases) {
    let world, interp;
    try {
      ({ world, interp } = run(c, level.reference, c.seed));
    } catch (e) {
      failures++;
      console.log(`FAIL ${level.id} ${c.label}: ${e.message}`);
      continue;
    }
    const frame = world.frames[world.frames.length - 1];
    const [ok, why] = checkGoal(c.goal, frame, {
      result: interp.result,
      initialNodes: c.graph.nodes,
    });
    const refsOk = world.peak <= c.max_refs;
    const stepsOk = world.steps <= c.max_steps;
    const retOk = interp.result !== null && interp.result !== undefined;
    if (!ok || !refsOk || !stepsOk || !retOk) {
      failures++;
      console.log(
        `FAIL ${level.id} ${c.label}: goal=${ok}:${why} peak=${world.peak}/${c.max_refs} ` +
        `steps=${world.steps}/${c.max_steps} ret=${interp.result}`
      );
    } else {
      console.log(
        `ok   ${level.id} ${c.label}: ${world.steps} steps, peak ${world.peak}, ` +
        `${frame.nodes.length} nodes / ${frame.edges.length} edges`
      );
    }
  }
}

// -------------------------------------------------------------------- c++
console.log("— c++ levels");
for (const level of LEVELS) {
  const cpp = cppFor(level);
  for (const c of casesOf(level)) {
    let world, interp;
    try {
      ({ world, interp } = run(c, cpp.reference, c.seed, parseCpp));
    } catch (e) {
      failures++;
      console.log(`FAIL ${level.id} ${c.label} (cpp): ${e.message}`);
      continue;
    }
    const frame = world.frames[world.frames.length - 1];
    const [ok, why] = checkGoal(c.goal, frame, {
      result: interp.result,
      initialNodes: c.graph.nodes,
    });
    const pass = ok && interp.result != null && world.peak <= c.max_refs && world.steps <= c.max_steps;
    if (!pass) {
      failures++;
      console.log(`FAIL ${level.id} ${c.label} (cpp): ${why} peak=${world.peak} steps=${world.steps}`);
    } else {
      console.log(`ok   ${level.id} ${c.label} (cpp): ${world.steps} steps, peak ${world.peak}`);
    }
  }
}

// ------------------------------------------------------------------- units
console.log("— rules");

const chainLevel = {
  start: 0,
  graph: { nodes: 4, edges: [[0, 1], [1, 2], [2, 3]] },
};
const oneNode = {
  start: 0,
  graph: { nodes: 1, edges: [] },
};

function unit(name, level, code, fn, parser = parse) {
  try {
    const { world, interp } = run(level, code, 1, parser);
    fn(world, interp);
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

unit("chain peek: 3 steps, peak 2", chainLevel, [
  "def solve(s):",
  "    s.next().next().next()",
  "    return s",
  "",
].join("\n"), (world, interp) => {
  if (world.steps !== 3) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
  const labels = world.frames.map((f) => f.refs.map((r) => r.label).sort().join("+"));
  const last = labels[labels.length - 2]; // last is "done" without the temp
  if (!labels.includes("s+s.next()")) throw new Error("missing a.next() tag: " + labels.join(" | "));
});

unit("b = a.next(): 1 step, binding merged into next", chainLevel, [
  "def solve(s):",
  "    b = s.next()",
  "    return b",
  "",
].join("\n"), (world) => {
  if (world.steps !== 1) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
  const f = world.frames[1];
  if (f.op !== "next") throw new Error("op=" + f.op);
  const labels = f.refs.map((r) => r.label).sort().join(",");
  if (labels !== "b,s") throw new Error("frame=" + labels);
});

unit("b = a.next().next(): 2 steps, chain then merged binding", chainLevel, [
  "def solve(s):",
  "    b = s.next().next()",
  "    return b",
  "",
].join("\n"), (world) => {
  if (world.steps !== 2) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
  const first = world.frames[1].refs.map((r) => r.label).sort().join(",");
  if (first !== "s,s.next()") throw new Error("frame1=" + first);
  const second = world.frames[2].refs.map((r) => r.label).sort().join(",");
  if (second !== "b,s") throw new Error("frame2=" + second);
});

unit("for _ in range(3) loops the body", chainLevel, [
  "def solve(s):",
  "    for _ in range(3):",
  "        s = s.next()",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 3) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
  const live = world.liveNodes();
  if (live.length !== 1 || !live.includes(3)) throw new Error("nodes=" + live);
});

unit("for + link builds a star", oneNode, [
  "def solve(s):",
  "    for _ in range(3):",
  "        s.link(Node())",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 6) throw new Error(`steps=${world.steps}`);
  if (world.liveNodes().length !== 4) throw new Error("nodes=" + world.liveNodes());
});

unit("break / continue are free", chainLevel, [
  "def solve(s):",
  "    for _ in range(10):",
  "        break",
  "    for _ in range(10):",
  "        continue",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 0) throw new Error(`steps=${world.steps}`);
});

unit("range(0) runs zero times", chainLevel, [
  "def solve(s):",
  "    for _ in range(0):",
  "        s = s.next()",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 0) throw new Error(`steps=${world.steps}`);
  if (world.liveNodes().length !== 4) throw new Error("nodes=" + world.liveNodes());
});

unit("s = s.next(): 1 step, peak 2", chainLevel, [
  "def solve(s):",
  "    s = s.next()",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 1) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
  if (world.liveNodes().includes(0)) throw new Error("old node still alive");
});

unit("a = b is a move step", chainLevel, [
  "def solve(s):",
  "    a = s",
  "    return a",
  "",
].join("\n"), (world) => {
  if (world.steps !== 1) throw new Error(`steps=${world.steps}`);
  if (world.frames[1].op !== "move") throw new Error(`op=${world.frames[1].op}`);
  const labels = world.frames[1].refs.map((r) => r.label).sort().join(",");
  if (labels !== "a,s") throw new Error("labels=" + labels);
});

unit("s.link(Node()): 2 steps, peak 2", chainLevel, [
  "def solve(s):",
  "    s.link(Node())",
  "    return s",
  "",
].join("\n"), (world) => {
  if (world.steps !== 2) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
});

// GC: one-way edge
unit("gc: one-way edge survives while a refs it", chainLevel, [
  "def solve(s):",
  "    a = Node()",
  "    b = Node()",
  "    a.link(b)",
  "    b = None",
  "    return a",
  "",
].join("\n"), (world) => {
  const live = world.liveNodes();
  if (!live.includes(4) || !live.includes(5)) throw new Error("nodes=" + live);
});

unit("gc: no refs collects the pair (one-way)", chainLevel, [
  "def solve(s):",
  "    a = Node()",
  "    b = Node()",
  "    a.link(b)",
  "    b = None",
  "    a = None",
  "    return s",
  "",
].join("\n"), (world) => {
  const live = world.liveNodes();
  if (live.length !== 4) throw new Error("nodes=" + live);
});

// GC: two-way edge, unreachable cycle is collected
unit("gc: cycle without refs is collected", chainLevel, [
  "def solve(s):",
  "    a = Node()",
  "    b = Node()",
  "    a.link(b)",
  "    b.link(a)",
  "    b = None",
  "    a = None",
  "    return s",
  "",
].join("\n"), (world) => {
  const live = world.liveNodes();
  if (live.length !== 4) throw new Error("nodes=" + live);
});

unit("moving s collects the node it left", chainLevel, [
  "def solve(s):",
  "    s = s.next()",
  "    return s",
  "",
].join("\n"), (world) => {
  const live = world.liveNodes();
  if (live.includes(0)) throw new Error("old node still alive: " + live);
  if (live.length !== 3) throw new Error("nodes=" + live);
});

unit("saving the head keeps the chain", chainLevel, [
  "def solve(s):",
  "    head = s",
  "    s = s.next()",
  "    return head",
  "",
].join("\n"), (world) => {
  const live = world.liveNodes();
  if (live.length !== 4) throw new Error("nodes=" + live);
});

unit("copy level rejects returning the old start", LEVELS[2], [
  "def solve(s):",
  "    return s",
  "",
].join("\n"), (world, interp) => {
  const [ok] = checkGoal(LEVELS[2].goal, world.frames[world.frames.length - 1], {
    result: interp.result,
    initialNodes: LEVELS[2].graph.nodes,
  });
  if (ok) throw new Error("do-nothing passed");
});

unit("returned isolated node survives", chainLevel, [
  "def solve(s):",
  "    return Node()",
  "",
].join("\n"), (world, interp) => {
  if (!world.liveNodes().includes(interp.result)) throw new Error("returned node was collected");
});

unit("cpp: Node* a = s->next() is 1 step", chainLevel, [
  "Node* solve(Node* s) {",
  "    Node* a = s->next();",
  "    return a;",
  "}",
  "",
].join("\n"), (world) => {
  if (world.steps !== 1) throw new Error(`steps=${world.steps}`);
  if (world.peak !== 2) throw new Error(`peak=${world.peak}`);
}, parseCpp);

unit("cpp: Node* a; is free", chainLevel, [
  "Node* solve(Node* s) {",
  "    Node* a;",
  "    return s;",
  "}",
  "",
].join("\n"), (world) => {
  if (world.steps !== 0) throw new Error(`steps=${world.steps}`);
}, parseCpp);

unit("cpp: block scope drops inner names", oneNode, [
  "Node* solve(Node* s) {",
  "    {",
  "        Node* a = new Node();",
  "        s->link(a);",
  "    }",
  "    return s;",
  "}",
  "",
].join("\n"), (world) => {
  if (world.steps !== 2) throw new Error(`steps=${world.steps}`);
  if (world.liveNodes().length !== 2) throw new Error("nodes=" + world.liveNodes());
}, parseCpp);

unit("cpp: pointer for walks the chain", chainLevel, [
  "Node* solve(Node* s) {",
  "    Node* p = s;",
  "    for (; p->next() != nullptr; p = p->next()) {",
  "    }",
  "    return p;",
  "}",
  "",
].join("\n"), (world) => {
  if (world.steps !== 8) throw new Error(`steps=${world.steps}`);
  const live = world.liveNodes();
  if (live.length !== 1 || !live.includes(3)) throw new Error("nodes=" + live);
}, parseCpp);

// ------------------------------------------------------------------ parser
console.log("— parser");
function parseFails(name, code, re) {
  try {
    parse(code);
  } catch (e) {
    if (re.test(e.message)) { console.log(`ok   ${name}`); return; }
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
    return;
  }
  failures++;
  console.log(`FAIL ${name}: parsed without error`);
}
parseFails("_ cannot be a variable", "def solve(s):\n    _ = s\n", /_ 不能/);
parseFails("loop variable must be _", "def solve(s):\n    for i in range(3):\n        pass\n", /只能是 _/);
parseFails("integer only in range", "def solve(s):\n    x = 3\n", /整数常量只能/);
parseFails("range only in for", "def solve(s):\n    x = range(3)\n", /range 只能/);
parseFails("range is capped", "def solve(s):\n    for _ in range(10001):\n        pass\n", /最多 10000/);

function cppFails(name, code, re) {
  try {
    parseCpp(code);
  } catch (e) {
    if (re.test(e.message)) { console.log(`ok   ${name}`); return; }
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
    return;
  }
  failures++;
  console.log(`FAIL ${name}: parsed without error`);
}
const HEAD = "Node* solve(Node* s) {\n";
const TAIL = "\n}\n";
cppFails("cpp: missing semicolon", HEAD + "    Node* a = s" + TAIL, /这里应该是 ;/);
cppFails("cpp: no int", HEAD + "    int i = 0;" + TAIL, /只有 Node\*/);
cppFails("cpp: dot instead of arrow", HEAD + "    s.next();" + TAIL, /请用 ->/);
cppFails("cpp: loop capped", HEAD + "    loop(10001) { }" + TAIL, /最多 10000/);
cppFails("cpp: Node without star", HEAD + "    Node a;" + TAIL, /这里应该是 \*/);
cppFails("cpp: delete rejected", HEAD + "    delete s;" + TAIL, /不认识|这里应该/);

process.exit(failures ? 1 : 0);
