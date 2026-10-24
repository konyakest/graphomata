/* Headless smoke test for app.js: a fake DOM, the real app wiring.
 * Catches missing elements / typos / broken state transitions without a browser.
 *   node web/smoke.js
 */
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
    this.classList = {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
  setRangeText() {}
  getContext() { return ctx2d; }
  setAttribute() {}
}

const IDs = [
  "levels", "seed", "reseed", "run", "step", "reset", "load-ref", "speed",
  "lv-title", "lv-brief", "hint", "code", "hl", "gutter", "line-hl", "line-err",
  "msg", "out", "ops", "peak", "lastop", "verdict", "stage", "empty",
  "home-chips", "loadinfo",
];

const elements = new Map(IDs.map((id) => [id, new El(id)]));
elements.get("speed").value = "0";

const document = {
  getElementById: (id) => {
    if (!elements.has(id)) throw new Error(`app.js asked for #${id}, which the page does not have`);
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
  list: [],
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = (name, fn) => sandbox.list.push({ name, fn });
sandbox.GM = Object.assign({}, require("./vm.js"), require("./py.js"), require("./levels.js"));

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), sandbox, { filename: "app.js" });

// The app boots on DOMContentLoaded.
for (const entry of sandbox.list) if (entry.name === "DOMContentLoaded") entry.fn();
const app = sandbox.__app;
if (!app) throw new Error("app did not boot");

let failures = 0;
const levelCount = sandbox.GM.LEVELS.length;

for (let i = 0; i < levelCount; i++) {
  app.selectLevel(i);
  app.editor.setValue(sandbox.GM.LEVELS[i].reference);
  app.reset();
  let guard = 0;
  while (app.status !== "pass" && app.status !== "fail" && app.status !== "error" && guard++ < 5000) {
    app.step();
  }
  const ok = app.status === "pass";
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} level ${i + 1}: status=${app.status} ops=${app.vm.ops} ${elements.get("msg").textContent}`);
}

// Rendering: node labels should include the variable names that point at them.
app.selectLevel(2);
app.editor.setValue(sandbox.GM.LEVELS[2].reference);
app.reset();
for (let i = 0; i < 4; i++) app.step();
drawnText.length = 0;
app.renderer.resize();
app.renderer.draw(0);
const hasName = drawnText.some((t) => /^(a|nxt|nn)(,|$)/.test(t));
if (!hasName) {
  failures++;
  console.log(`FAIL worker labels: drew ${JSON.stringify(drawnText.slice(0, 12))}`);
} else {
  console.log(`ok   worker labels: ${JSON.stringify(drawnText.filter((t) => /^(a|nxt|nn)(,|$)/.test(t)))}`);
}

// Error path: a self-link must be reported with a line number.
app.selectLevel(2);
app.editor.setValue("def solve(w):\n    w.link(A, A)\n");
app.reset();
for (let i = 0; i < 5 && app.status !== "error"; i++) app.step();
if (app.status !== "error") {
  failures++;
  console.log(`FAIL error path: status=${app.status}`);
} else {
  console.log(`ok   error path: ${elements.get("msg").textContent}`);
}

// Budget path.
app.selectLevel(0);
app.editor.setValue("def solve(w):\n    w.node(A)\n    w.node(A)\n    w.node(A)\n    w.node(A)\n");
app.reset();
for (let i = 0; i < 10 && app.status !== "error"; i++) app.step();
if (app.status !== "error") {
  failures++;
  console.log(`FAIL budget path: status=${app.status}`);
} else {
  console.log(`ok   budget path: ${elements.get("msg").textContent}`);
}

process.exit(failures ? 1 : 0);
