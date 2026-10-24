/* Headless smoke test for the pointer UI: fake DOM, real app wiring. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const drawnText = [];
const ctx2d = new Proxy({}, {
  get(target, key) {
    if (key === "fillText") return (text) => drawnText.push(String(text));
    if (key === "measureText") return (text) => ({ width: String(text).length * 6 });
    if (!(key in target)) target[key] = () => {};
    return target[key];
  },
  set(target, key, value) { target[key] = value; return true; },
});

class El {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.clientWidth = 800;
    this.clientHeight = 500;
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
  setRangeText() {}
  getContext() { return ctx2d; }
  setAttribute() {}
}

const IDs = [
  "levels", "case", "submit", "run", "step", "back", "reset", "load-ref", "speed",
  "lang-py", "lang-cpp", "file-name", "progress",
  "lv-title", "lv-brief", "hint", "code", "hl", "gutter", "line-hl", "line-err",
  "msg", "steps", "refs", "peak", "lastop", "verdict", "stage", "empty", "loadinfo",
];
const elements = new Map(IDs.map((id) => [id, new El(id)]));
elements.get("speed").value = "0";

const document = {
  getElementById: (id) => {
    if (!elements.has(id)) throw new Error(`missing #${id}`);
    return elements.get(id);
  },
  createElement: () => new El(),
};

const store = new Map();
const sandbox = {
  console,
  document,
  devicePixelRatio: 1,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setInterval: () => 0,
  clearInterval: () => {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  listeners: [],
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = (name, fn) => sandbox.listeners.push({ name, fn });
sandbox.PTR = Object.assign(
  {},
  require("./world.js"),
  require("./parser.js"),
  require("./interp.js"),
  require("./levels.js"),
  require("./cpp.js")
);

vm.createContext(sandbox);
for (const f of ["app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), sandbox, { filename: f });
}
for (const l of sandbox.listeners) if (l.name === "DOMContentLoaded") l.fn();
const app = sandbox.__app;
if (!app) throw new Error("app did not boot");

let failures = 0;
for (let i = 0; i < sandbox.PTR.LEVELS.length; i++) {
  app.selectLevel(i);
  app.editor.setValue(sandbox.PTR.LEVELS[i].reference);
  app.reset();
  app.submit();
  const ok = app.status === "pass";
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} level ${i + 1}: status=${app.status} ${elements.get("msg").textContent}`);
}

// a solution that only handles the sample must fail the hidden case and load it
app.selectLevel(3); // 04-ring: sample 4-chain, hidden 6-chain
app.editor.setValue([
  "def solve(s):",
  "    head = s",
  "    s = s.next()",
  "    s = s.next()",
  "    s = s.next()",
  "    s.link(head)",
  "    return head",
  "",
].join("\n"));
app.reset();
app.submit();
const caseVal = elements.get("case").value;
if (app.status !== "fail" || caseVal !== "1") {
  failures++;
  console.log(`FAIL failing case: status=${app.status} case=${caseVal} ${elements.get("msg").textContent}`);
} else {
  console.log(`ok   failing case loaded: ${elements.get("msg").textContent}`);
}

// Peak labels should be drawn: at some point the temp tag must appear.
app.selectLevel(5);
app.editor.setValue(sandbox.PTR.LEVELS[5].reference);
app.reset();
for (let i = 0; i < 3; i++) app.step();
drawnText.length = 0;
app.renderer.resize();
app.renderer.draw();
const hasName = drawnText.some((t) => t === "head" || t === "ss");
if (!hasName) {
  failures++;
  console.log(`FAIL ref labels: ${JSON.stringify(drawnText.slice(0, 12))}`);
} else {
  console.log(`ok   ref labels drawn`);
}

// step back/forward over recorded frames
app.selectLevel(0);
app.editor.setValue(sandbox.PTR.LEVELS[0].reference);
app.reset();
app.step();
app.step();
const at = app.frameIndex;
app.back();
const backOk = app.frameIndex === at - 1 && elements.get("steps").textContent === String(at - 1);
app.step();
const fwdOk = app.frameIndex === at;
if (!backOk || !fwdOk) {
  failures++;
  console.log(`FAIL step back: at=${at} back=${backOk} fwd=${fwdOk}`);
} else {
  console.log("ok   step back / forward");
}

// drag a node: it should follow the pointer and stay pinned afterwards
app.selectLevel(0);
app.editor.setValue(sandbox.PTR.LEVELS[0].reference);
app.reset();
app.renderer.resize();
const node = app.renderer.nodes.get(0);
const before = { x: node.x, y: node.y };
app.renderer.onDown({ clientX: node.x, clientY: node.y, preventDefault() {} });
app.renderer.onMove({ clientX: node.x + 80, clientY: node.y + 40 });
app.renderer.onUp();
for (let i = 0; i < 30; i++) app.renderer.physics();
const near = Math.hypot(node.x - (before.x + 80), node.y - (before.y + 40)) < 3;
if (!near || !node.pinned) {
  failures++;
  console.log(`FAIL drag: near=${near} pinned=${node.pinned} pos=${node.x.toFixed(1)},${node.y.toFixed(1)}`);
} else {
  console.log("ok   node drag + pin");
}

// C++ mode: switch language, run the C++ reference, submit
app.selectLevel(5); // copy
app.setLang("cpp");
const cppRef = sandbox.PTR.cppFor(app.level).reference;
app.editor.setValue(cppRef);
app.reset();
app.submit();
if (app.status !== "pass") {
  failures++;
  console.log(`FAIL cpp submit: ${elements.get("msg").textContent}`);
} else {
  console.log("ok   cpp submit");
}
app.setLang("py");
if (!app.editor.value.includes("def solve")) {
  failures++;
  console.log("FAIL language switch back");
} else {
  console.log("ok   language switch back");
}

const lastRaw = store.get("ptr.last");
let lastOk = false;
try {
  const last = JSON.parse(lastRaw);
  lastOk = last.level === 5 && last.lang === "py";
} catch (e) { /* ignore */ }
if (!lastOk) {
  failures++;
  console.log(`FAIL last position: ${lastRaw}`);
} else {
  console.log(`ok   last position saved: ${lastRaw}`);
}

const prog = elements.get("progress").textContent;
if (!/Python 12\/12/.test(prog) || !/C\+\+ 1\/12/.test(prog)) {
  failures++;
  console.log(`FAIL progress summary: ${prog}`);
} else {
  console.log(`ok   progress summary: ${prog}`);
}

process.exit(failures ? 1 : 0);
