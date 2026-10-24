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
  "chapter-view", "game-view", "chapter-cards", "back-chapters",
  "lang-py", "lang-cpp", "file-name", "progress", "ex-start", "ex-goal", "ex-goal-label",
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
function check(name, cond, detail = "") {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? " — " + detail : ""}`);
}

const PTR = sandbox.PTR;
const cards = elements.get("chapter-cards");

check("boots on chapter select", elements.get("chapter-view").hidden === false && elements.get("game-view").hidden === true);
check("two chapters", cards.children.length === 2, `cards=${cards.children.length}`);
check("chapter 2 starts locked", cards.children[1].className.includes("locked"));

cards.children[0].onclick();
check("chapter 1 opens", app.chapterIndex === 0 && elements.get("game-view").hidden === false);

const ch1 = app.chapterLevels;
for (let i = 0; i < ch1.length; i++) {
  app.selectLevel(i);
  app.editor.setValue(ch1[i].reference);
  app.reset();
  app.submit();
  check(`chapter 1 level ${i + 1} passes`, app.status === "pass", elements.get("msg").textContent);
  if (i + 1 < ch1.length) check(`level ${i + 2} unlocked`, app.levelUnlocked(i + 1));
}
check("example canvases drawn", elements.get("ex-start").width > 0 && elements.get("ex-goal").width > 0);
check("reference visible in chapter 1", elements.get("load-ref").hidden !== true);

app.showChapters();
check("chapter 2 unlocked", app.chapterUnlocked(1) === true);
app.openChapter(1);
const ch2 = app.chapterLevels;
for (let i = 0; i < ch2.length; i++) {
  app.selectLevel(i);
  app.editor.setValue(ch2[i].reference);
  app.reset();
  app.submit();
  check(`chapter 2 level ${i + 1} passes`, app.status === "pass", elements.get("msg").textContent);
}
check("reference hidden in chapter 2", elements.get("load-ref").hidden === true);

// sample-only solution must fail a hidden case and load it
app.openChapter(0);
app.selectLevel(3);
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
check("hidden case fails and loads", app.status === "fail" && elements.get("case").value === "1", elements.get("msg").textContent);

// copy reference draws variable labels
app.openChapter(1);
app.selectLevel(0);
app.editor.setValue(ch2[0].reference);
app.reset();
for (let i = 0; i < 3; i++) app.step();
drawnText.length = 0;
app.renderer.resize();
app.renderer.draw();
check("ref labels drawn", drawnText.some((t) => t === "head" || t === "ss"), JSON.stringify(drawnText.slice(0, 8)));

// step back / forward on the first level of chapter 1
app.openChapter(0);
app.selectLevel(0);
app.editor.setValue(ch1[0].reference);
app.reset();
app.step();
app.step();
const at = app.frameIndex;
app.back();
const backOk = app.frameIndex === at - 1 && elements.get("steps").textContent === String(at - 1);
app.step();
check("step back / forward", backOk && app.frameIndex === at, `at=${at}`);

// drag a node
app.reset();
app.renderer.resize();
const node = app.renderer.nodes.get(0);
const before = { x: node.x, y: node.y };
app.renderer.onDown({ clientX: node.x, clientY: node.y, preventDefault() {} });
app.renderer.onMove({ clientX: node.x + 80, clientY: node.y + 40 });
app.renderer.onUp();
for (let i = 0; i < 30; i++) app.renderer.physics();
check("node drag + pin", Math.hypot(node.x - (before.x + 80), node.y - (before.y + 40)) < 3 && node.pinned);

// C++ mode
app.openChapter(1);
app.setLang("cpp");
app.editor.setValue(PTR.cppFor(app.level).reference);
app.reset();
app.submit();
check("cpp submit", app.status === "pass", elements.get("msg").textContent);
app.setLang("py");
check("language switch back", app.editor.value.includes("def solve"));

const lastRaw = store.get("ptr.last");
let last = null;
try { last = JSON.parse(lastRaw); } catch (e) { /* ignore */ }
check("last position saved", last && last.chapter === 1 && last.level === 0 && last.lang === "py", lastRaw);

const prog = elements.get("progress").textContent;
check("progress summary", /Python 12\/12/.test(prog) && /C\+\+ 1\/12/.test(prog), prog);

process.exit(failures ? 1 : 0);
