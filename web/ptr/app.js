/* Pointer mode — UI. */
(function () {
  "use strict";

  const { World, checkGoal, parse, parseCpp, Interp, LEVELS, CHAPTERS, chapterLevels, casesOf, cppFor } = window.PTR;
  const LH = 22;
  const PALETTE = [
    "#ffd43b", "#4dabf7", "#ff6b6b", "#51cf66", "#cc5de8",
    "#22b8cf", "#ff922b", "#f783ac", "#a9e34b", "#e599f7",
  ];
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ editor
  class Editor {
    constructor(textarea, hl, gutter, lineEl, errEl) {
      this.ta = textarea;
      this.hl = hl;
      this.gutter = gutter;
      this.lineEl = lineEl;
      this.errEl = errEl;
      this.currentLine = 0;
      this.errorLine = 0;
      this.lang = "py";
      this.onInput = null;
      this.onRun = null;
      this.onStep = null;

      this.ta.addEventListener("input", () => {
        this.refresh();
        if (this.onInput) this.onInput(this.ta.value);
      });
      this.ta.addEventListener("scroll", () => this.syncScroll());
      this.ta.addEventListener("keydown", (e) => this.key(e));
      this.ta.addEventListener("click", () => this.refreshMarks());
      this.ta.addEventListener("compositionstart", () => this.ta.classList.add("composing"));
      this.ta.addEventListener("compositionend", () => {
        this.ta.classList.remove("composing");
        this.refresh();
      });
      window.addEventListener("resize", () => this.refresh());
      this.refresh();
    }

    get value() { return this.ta.value; }

    setValue(code) {
      this.ta.value = code;
      this.ta.scrollTop = 0;
      this.refresh();
    }

    key(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t } = this.ta;
        this.ta.setRangeText("    ", s, t, "end");
        this.refresh();
        if (this.onInput) this.onInput(this.ta.value);
        return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (this.onRun) this.onRun();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        if (this.onStep) this.onStep();
      }
    }

    refresh() {
      this.renderHighlight();
      this.renderGutter();
      this.refreshMarks();
    }

    renderHighlight() {
      const code = this.ta.value;
      const spec = this.lang === "cpp"
        ? {
            re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\b(?:Node|solve|nullptr|new|loop|while|if|else|for|return|break|continue)\b)|(\b\d+\b)|(->)/g,
            cls: ["com", "kw", "num", "bi"],
          }
        : {
            re: /(#[^\n]*)|(\b(?:def|if|elif|else|while|for|in|return|break|continue|pass|is|not|and|or|None)\b)|(\b(?:Node|range|next|link|unlink)\b)|(\b\d+\b)/g,
            cls: ["com", "kw", "bi", "num"],
          };
      let out = "";
      let last = 0;
      let m;
      while ((m = spec.re.exec(code))) {
        out += esc(code.slice(last, m.index));
        const idx = m.slice(1).findIndex((x) => x !== undefined);
        out += `<span class="tok-${spec.cls[idx]}">${esc(m[0])}</span>`;
        last = m.index + m[0].length;
      }
      out += esc(code.slice(last));
      this.hl.innerHTML = out + (code.endsWith("\n") ? "\n" : " ");
    }

    renderGutter() {
      const lines = this.ta.value.split("\n");
      let html = "";
      for (let i = 1; i <= lines.length; i++) {
        const cls = i === this.errorLine ? "error" : i === this.currentLine ? "active" : "";
        html += `<div class="${cls}">${i}</div>`;
      }
      this.gutter.innerHTML = html;
    }

    syncScroll() {
      this.hl.scrollTop = this.ta.scrollTop;
      this.hl.scrollLeft = this.ta.scrollLeft;
      this.gutter.scrollTop = this.ta.scrollTop;
      this.refreshMarks();
    }

    refreshMarks() {
      const pad = 12;
      const top = pad + (this.currentLine - 1) * LH - this.ta.scrollTop;
      const ok = this.currentLine > 0 && top > -LH && top < this.ta.clientHeight;
      this.lineEl.style.display = ok ? "block" : "none";
      this.lineEl.style.top = `${top}px`;

      const etop = pad + (this.errorLine - 1) * LH - this.ta.scrollTop;
      const eok = this.errorLine > 0 && etop > -LH && etop < this.ta.clientHeight;
      this.errEl.style.display = eok ? "block" : "none";
      this.errEl.style.top = `${etop}px`;
    }

    setCurrentLine(n) {
      if (n === this.currentLine) return;
      this.currentLine = n;
      this.renderGutter();
      this.refreshMarks();
    }

    setErrorLine(n) {
      this.errorLine = n;
      this.renderGutter();
      this.refreshMarks();
    }
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------------------------------------------------------------- renderer
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.nodes = new Map();
      this.frame = null;
      this.w = 0;
      this.h = 0;
      this.colors = new Map();
      this.drag = null;
      window.addEventListener("resize", () => this.resize());
      canvas.addEventListener("pointerdown", (e) => this.onDown(e));
      canvas.addEventListener("pointerleave", () => { if (!this.drag) canvas.style.cursor = ""; });
      window.addEventListener("pointermove", (e) => this.onMove(e));
      window.addEventListener("pointerup", () => this.onUp());
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w === this.w && h === this.h) return;
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    reset() {
      this.nodes.clear();
      this.frame = null;
      this.colors.clear();
      this.drag = null;
    }

    colorOf(key) {
      if (!this.colors.has(key)) this.colors.set(key, PALETTE[this.colors.size % PALETTE.length]);
      return this.colors.get(key);
    }

    ensure(id, frame) {
      if (this.nodes.has(id)) return this.nodes.get(id);
      let x = this.w / 2 + (Math.random() - 0.5) * 50;
      let y = this.h / 2 + (Math.random() - 0.5) * 50;
      for (const [u, v] of frame.edges) {
        const other = u === id ? v : v === id ? u : null;
        if (other !== null && this.nodes.has(other)) {
          const p = this.nodes.get(other);
          const a = Math.random() * Math.PI * 2;
          x = p.x + Math.cos(a) * 90;
          y = p.y + Math.sin(a) * 90;
          break;
        }
      }
      const node = { x, y, vx: 0, vy: 0 };
      this.nodes.set(id, node);
      return node;
    }

    show(frame) {
      this.frame = frame;
      for (const id of frame.nodes) this.ensure(id, frame);
    }

    physics() {
      const f = this.frame;
      if (!f) return;
      const pos = f.nodes.map((id) => this.nodes.get(id)).filter(Boolean);
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          let dx = pos[i].x - pos[j].x;
          let dy = pos[i].y - pos[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const d = Math.sqrt(d2);
          const force = Math.min(6, 5200 / d2);
          const fx = (dx / d) * force, fy = (dy / d) * force;
          if (!pos[i].pinned) { pos[i].vx += fx; pos[i].vy += fy; }
          if (!pos[j].pinned) { pos[j].vx -= fx; pos[j].vy -= fy; }
        }
      }
      for (const [u, v] of f.edges) {
        const a = this.nodes.get(u), b = this.nodes.get(v);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const force = 0.012 * (d - 165);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        if (!a.pinned) { a.vx += fx; a.vy += fy; }
        if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
      }
      const cx = this.w / 2, cy = this.h / 2;
      for (const p of pos) {
        if (p.pinned) {
          p.vx = 0; p.vy = 0;
          p.x = Math.max(34, Math.min(this.w - 34, p.x));
          p.y = Math.max(34, Math.min(this.h - 34, p.y));
          continue;
        }
        p.vx += (cx - p.x) * 0.0016;
        p.vy += (cy - p.y) * 0.0016;
        p.vx *= 0.86;
        p.vy *= 0.86;
        p.vx = Math.max(-9, Math.min(9, p.vx));
        p.vy = Math.max(-9, Math.min(9, p.vy));
        p.x = Math.max(46, Math.min(this.w - 46, p.x + p.vx));
        p.y = Math.max(46, Math.min(this.h - 46, p.y + p.vy));
      }
    }

    local(e) {
      const r = this.canvas.getBoundingClientRect
        ? this.canvas.getBoundingClientRect()
        : { left: 0, top: 0 };
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    nodeAt(x, y) {
      if (!this.frame) return null;
      for (let i = this.frame.nodes.length - 1; i >= 0; i--) {
        const id = this.frame.nodes[i];
        const p = this.nodes.get(id);
        if (p && Math.hypot(p.x - x, p.y - y) <= 34) return id;
      }
      return null;
    }

    onDown(e) {
      const q = this.local(e);
      const id = this.nodeAt(q.x, q.y);
      if (id === null) return;
      const p = this.nodes.get(id);
      this.drag = { id, dx: p.x - q.x, dy: p.y - q.y };
      p.pinned = true;
      p.vx = p.vy = 0;
      this.canvas.style.cursor = "grabbing";
      if (e.preventDefault) e.preventDefault();
    }

    onMove(e) {
      const q = this.local(e);
      if (!this.drag) {
        this.canvas.style.cursor = this.nodeAt(q.x, q.y) !== null ? "grab" : "";
        return;
      }
      const p = this.nodes.get(this.drag.id);
      if (!p) return;
      p.x = Math.max(34, Math.min(this.w - 34, q.x + this.drag.dx));
      p.y = Math.max(34, Math.min(this.h - 34, q.y + this.drag.dy));
      p.vx = p.vy = 0;
    }

    onUp() {
      if (!this.drag) return;
      this.drag = null;
      this.canvas.style.cursor = "";
    }

    draw() {
      const ctx = this.ctx;
      const { w, h } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0c121c";
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = "rgba(120, 150, 200, 0.055)";
      for (let x = 28; x < w; x += 34) {
        for (let y = 28; y < h; y += 34) ctx.fillRect(x, y, 1.4, 1.4);
      }

      const f = this.frame;
      if (!f) return;
      const R = 26;

      for (const [u, v] of f.edges) {
        const a = this.nodes.get(u), b = this.nodes.get(v);
        if (!a || !b) continue;
        this.edge(a, b, R, "rgba(96, 122, 160, 0.9)", 2, 0);
      }

      for (const id of f.nodes) {
        const p = this.nodes.get(id);
        if (!p) continue;
        if (id === this.mark) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(255, 212, 59, 0.75)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, R + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        const hue = (id * 137.508) % 360;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue.toFixed(0)}, 26%, 26%)`;
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = `hsl(${hue.toFixed(0)}, 38%, 46%)`;
        ctx.stroke();
      }

      ctx.font = "bold 10.5px ui-monospace, SFMono-Regular, monospace";
      const groups = new Map();
      for (const r of f.refs) {
        if (!groups.has(r.node)) groups.set(r.node, []);
        groups.get(r.node).push(r);
      }
      const ring = R + 26;
      for (const [node, refs] of groups) {
        const p = this.nodes.get(node);
        if (!p) continue;
        refs.sort((a, b) => a.key.localeCompare(b.key));
        const items = refs.map((r) => {
          const text = r.label.length > 14 ? r.label.slice(0, 13) + "…" : r.label;
          return { r, text, w: ctx.measureText(text).width + 16 };
        });
        const total = items.reduce((s, it) => s + it.w + 6, 0);
        const totalAng = Math.min(Math.PI * 1.8, total / ring);
        let ang = -Math.PI / 2 - totalAng / 2;
        for (const it of items) {
          const step = (it.w + 6) / ring;
          const a = ang + step / 2;
          ang += step;
          const cx = p.x + Math.cos(a) * ring;
          const cy = p.y + Math.sin(a) * ring;
          const px = Math.max(it.w / 2 + 3, Math.min(this.w - it.w / 2 - 3, cx));
          const py = Math.max(12, Math.min(this.h - 12, cy));
          this.pill(px, py, it.w, 20, this.colorOf(it.r.key), it.text);
        }
      }
    }

    pill(cx, cy, w, h, color, text) {
      const ctx = this.ctx;
      const r = h / 2;
      const x = cx - w / 2;
      const y = cy - h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "#0a0e16";
      ctx.stroke();
      ctx.fillStyle = "#0a0e16";
      ctx.font = "bold 10.5px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + 0.5);
    }

    edge(a, b, r, color, width, offset) {
      const ctx = this.ctx;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) return;
      const ux = dx / d, uy = dy / d;
      const nx = -uy * offset, ny = ux * offset;
      const sx = a.x + ux * r + nx, sy = a.y + uy * r + ny;
      const ex = b.x - ux * (r + 8) + nx, ey = b.y - uy * (r + 8) + ny;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * 10 - uy * 5.5, ey - uy * 10 + ux * 5.5);
      ctx.lineTo(ex - ux * 10 + uy * 5.5, ey - uy * 10 - ux * 5.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --------------------------------------------------------------------- app
  class App {
    constructor() {
      this.chapterIndex = 0;
      this.chapterLevels = chapterLevels(CHAPTERS[0]);
      this.levelIndex = 0;
      this.caseIndex = 0;
      this.lang = "py";
      this.world = null;
      this.interp = null;
      this.gen = null;
      this.running = false;
      this.timer = null;
      this.status = "idle";
      this.dirty = false;
      this.started = false;
      this.frameIndex = 0;
      this.done = false;

      this.editor = new Editor($("code"), $("hl"), $("gutter"), $("line-hl"), $("line-err"));
      this.editor.onInput = (code) => this.onCode(code);
      this.editor.onRun = () => this.toggleRun();
      this.editor.onStep = () => this.step();

      this.renderer = new Renderer($("stage"));

      $("run").onclick = () => this.toggleRun();
      $("step").onclick = () => this.step();
      $("back").onclick = () => this.back();
      $("reset").onclick = () => this.reset();
      $("load-ref").onclick = () => this.loadReference();
      $("lang-py").onclick = () => this.setLang("py");
      $("lang-cpp").onclick = () => this.setLang("cpp");
      $("case").onchange = () => this.onCase();
      $("submit").onclick = () => this.submit();
      $("back-chapters").onclick = () => this.showChapters();
      $("speed").onchange = () => {
        if (this.running) { this.stopTimer(); this.startTimer(); }
      };

      const last = this.loadLast();
      if (last && last.lang === "cpp") {
        this.lang = "cpp";
        this.editor.lang = "cpp";
        $("lang-py").classList.toggle("on", false);
        $("lang-cpp").classList.toggle("on", true);
        $("file-name").textContent = "solution.cpp";
      }
      this.updateProgress();
      this.showChapters();
      this.loop();
    }

    get chapter() { return CHAPTERS[this.chapterIndex]; }
    get level() { return this.chapterLevels[this.levelIndex]; }
    get cases() { return casesOf(this.level); }
    get cpp() { return cppFor(this.level); }

    isSolved(level, lang = this.lang) {
      return !!localStorage.getItem(`ptr.solved.${level.id}.${lang}`);
    }

    anySolved(level) {
      return this.isSolved(level, "py") || this.isSolved(level, "cpp");
    }

    chapterProgress(chapter) {
      const levels = chapterLevels(chapter);
      let py = 0, cpp = 0;
      for (const lv of levels) {
        if (this.isSolved(lv, "py")) py++;
        if (this.isSolved(lv, "cpp")) cpp++;
      }
      return { py, cpp, total: levels.length };
    }

    chapterUnlocked(i) {
      for (let k = 0; k < i; k++) {
        const levels = chapterLevels(CHAPTERS[k]);
        if (!levels.every((lv) => this.anySolved(lv))) return false;
      }
      return true;
    }

    levelUnlocked(i) {
      if (i <= 0) return true;
      const lv = this.chapterLevels[i];
      if (!lv) return false;
      if (this.isSolved(lv)) return true;
      const prev = this.chapterLevels[i - 1];
      return !!prev && this.isSolved(prev);
    }

    firstUnlocked() {
      for (let i = 0; i < this.chapterLevels.length; i++) {
        if (this.levelUnlocked(i) && !this.isSolved(this.chapterLevels[i])) return i;
      }
      for (let i = this.chapterLevels.length - 1; i >= 0; i--) {
        if (this.levelUnlocked(i)) return i;
      }
      return 0;
    }

    showChapters() {
      this.stopTimer();
      this.running = false;
      if ($("game-view")) $("game-view").hidden = true;
      if ($("chapter-view")) $("chapter-view").hidden = false;
      this.renderChapters();
    }

    renderChapters() {
      const box = $("chapter-cards");
      if (!box) return;
      box.innerHTML = "";
      CHAPTERS.forEach((ch, i) => {
        const { py, cpp, total } = this.chapterProgress(ch);
        const unlocked = this.chapterUnlocked(i);
        const card = document.createElement("div");
        card.className = "chapter-card" + (unlocked ? "" : " locked");
        card.innerHTML =
          `<h3>${esc(ch.title)}</h3><p>${esc(ch.subtitle)}</p>` +
          `<div class="prog">Python ${py}/${total} · C++ ${cpp}/${total}</div>` +
          (unlocked ? `<div class="lock">点击进入</div>` : `<div class="lock">完成上一章后解锁</div>`);
        card.onclick = () => { if (unlocked) this.openChapter(i); };
        box.appendChild(card);
      });
    }

    openChapter(i) {
      if (!this.chapterUnlocked(i)) return;
      this.chapterIndex = i;
      this.chapterLevels = chapterLevels(CHAPTERS[i]);
      this.levelIndex = 0;
      this.caseIndex = 0;
      $("chapter-view").hidden = true;
      $("game-view").hidden = false;

      const last = this.loadLast();
      let idx = this.firstUnlocked();
      if (last && last.chapter === i && last.level >= 0 && last.level < this.chapterLevels.length && this.levelUnlocked(last.level)) {
        idx = last.level;
      }
      this.selectLevel(idx);
      if (last && last.chapter === i && last.level === idx && last.case >= 0 && last.case < this.cases.length) {
        this.caseIndex = last.case;
        this.buildCases();
        this.reset();
        this.saveLast();
      }
    }

    setLang(lang) {
      if (lang === this.lang) return;
      this.lang = lang;
      this.editor.lang = lang;
      $("lang-py").classList.toggle("on", lang === "py");
      $("lang-cpp").classList.toggle("on", lang === "cpp");
      $("file-name").textContent = lang === "cpp" ? "solution.cpp" : "solution.py";
      if (!this.levelUnlocked(this.levelIndex)) {
        this.levelIndex = this.firstUnlocked();
        this.caseIndex = 0;
      }
      this.buildTabs();
      this.refreshHeader();
      this.loadCode();
      this.reset();
      this.saveLast();
    }

    loadLast() {
      try {
        return JSON.parse(localStorage.getItem("ptr.last") || "null");
      } catch (e) {
        return null;
      }
    }

    saveLast() {
      localStorage.setItem("ptr.last", JSON.stringify({
        chapter: this.chapterIndex,
        level: this.levelIndex,
        lang: this.lang,
        case: this.caseIndex,
      }));
    }

    updateProgress() {
      let py = 0, cpp = 0;
      for (const lv of LEVELS) {
        if (localStorage.getItem(`ptr.solved.${lv.id}.py`)) py++;
        if (localStorage.getItem(`ptr.solved.${lv.id}.cpp`)) cpp++;
      }
      const el = $("progress");
      if (el) el.textContent = `进度 Python ${py}/${LEVELS.length} · C++ ${cpp}/${LEVELS.length}`;
    }

    loadCode() {
      const lv = this.level;
      const key = `ptr.code.${lv.id}.${this.lang}`;
      let draft = localStorage.getItem(key);
      if (draft == null && this.lang === "py") draft = localStorage.getItem(`ptr.code.${lv.id}`);
      if (draft == null) {
        draft = this.lang === "cpp" && this.cpp ? this.cpp.starter : lv.starter;
      }
      this.editor.setValue(draft);
    }

    referenceFor() {
      if (this.lang === "cpp" && this.cpp) return this.cpp.reference;
      return this.level.reference;
    }

    parseCode(code) {
      return this.lang === "cpp" ? parseCpp(code) : parse(code);
    }

    solvedKey() {
      return `ptr.solved.${this.level.id}.${this.lang}`;
    }
    get testCase() { return this.cases[this.caseIndex] || this.cases[0]; }

    buildTabs() {
      const nav = $("levels");
      nav.innerHTML = "";
      this.chapterLevels.forEach((lv, i) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${String(i + 1).padStart(2, "0")}</b>${lv.title}`;
        if (this.isSolved(lv)) b.classList.add("solved");
        if (!this.levelUnlocked(i)) b.classList.add("locked");
        if (i === this.levelIndex) b.classList.add("on");
        b.onclick = () => this.selectLevel(i);
        nav.appendChild(b);
      });
    }

    refreshHeader() {
      const lv = this.level;
      $("lv-title").textContent = lv.title;
      $("lv-brief").innerHTML = `<i class="diff">${esc(lv.difficulty || "")}</i>${esc(lv.brief)}`;
      $("hint").innerHTML = `<b>提示</b> ${esc(lv.hint)}`;
      const ref = $("load-ref");
      if (ref) {
        ref.hidden = !this.chapter.reference;
        ref.style.display = this.chapter.reference ? "" : "none";
      }
    }

    selectLevel(i) {
      if (!this.chapterLevels[i]) return;
      if (!this.levelUnlocked(i)) {
        this.setMsg("先完成上一关才能解锁", "");
        return;
      }
      this.stopTimer();
      this.levelIndex = i;
      this.caseIndex = 0;
      this.buildTabs();
      this.refreshHeader();
      this.buildCases();
      this.loadCode();
      this.reset();
      this.saveLast();
    }

    buildCases() {
      const sel = $("case");
      sel.innerHTML = "";
      this.cases.forEach((c, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = c.label;
        opt.title = c.detail || "";
        sel.appendChild(opt);
      });
      if (this.caseIndex >= this.cases.length) this.caseIndex = 0;
      sel.value = String(this.caseIndex);
    }

    onCase() {
      this.caseIndex = Number($("case").value) || 0;
      this.reset();
      this.saveLast();
    }

    markSolved() {
      localStorage.setItem(this.solvedKey(), "1");
      this.updateProgress();
      this.buildTabs();
    }

    loadReference() {
      if (!this.chapter.reference) return;
      const code = this.referenceFor();
      this.editor.setValue(code);
      localStorage.setItem(`ptr.code.${this.level.id}.${this.lang}`, code);
      this.reset();
    }

    onCode(code) {
      localStorage.setItem(`ptr.code.${this.level.id}.${this.lang}`, code);
      if (this.started) {
        this.dirty = true;
        this.setMsg("代码已修改：下一步会从头开始", "");
      }
    }

    initialFrame() {
      const c = this.testCase;
      const edges = (c.graph.edges || []).map(([u, v]) => [u, v]);
      return {
        step: 0,
        op: "init",
        line: 0,
        refs: [{ key: "v:s", label: "s", node: c.start, temp: false }],
        nodes: Array.from({ length: c.graph.nodes }, (_, i) => i),
        edges,
        peak: 1,
      };
    }

    reset() {
      this.renderer.mark = this.level.mark ?? null;
      this.stopTimer();
      this.running = false;
      this.status = "idle";
      this.started = false;
      this.dirty = false;
      this.world = null;
      this.interp = null;
      this.gen = null;
      this.done = false;
      this.frameIndex = 0;
      this.renderer.reset();
      const initial = this.initialFrame();
      this.renderer.show(initial);
      this.editor.setCurrentLine(0);
      this.editor.setErrorLine(0);
      this.setMsg("", "");
      this.setVerdict("", "");
      if ($("case")) $("case").value = String(this.caseIndex);
      $("empty").classList.remove("hide");
      $("run").textContent = "▶ 运行";
      this.updateHud(initial);
      this.updateButtons();
    }

    prepare() {
      if (this.dirty) this.reset();
      if (this.gen) return true;
      let program;
      try {
        program = this.parseCode(this.editor.value);
      } catch (e) {
        this.fail(e);
        return false;
      }
      const c = this.testCase;
      this.world = new World(c, c.seed);
      this.interp = new Interp(program, this.world);
      try {
        this.interp.begin();
      } catch (e) {
        this.fail(e);
        return false;
      }
      this.gen = this.interp.run();
      this.started = true;
      this.dirty = false;
      this.done = false;
      this.frameIndex = 0;
      return true;
    }

    step() {
      if (this.running) { this.stopTimer(); this.running = false; $("run").textContent = "▶ 运行"; }
      if (this.dirty) this.reset();
      if (!this.world && !this.prepare()) return;
      if (this.frameIndex < this.world.frames.length - 1) {
        this.showFrame(this.frameIndex + 1);
        return;
      }
      if (this.done) return;

      let r;
      try {
        r = this.gen.next();
      } catch (e) {
        this.fail(e);
        return;
      }
      if (r.done) this.finish();
      else this.afterStep();
    }

    back() {
      if (this.running) { this.stopTimer(); this.running = false; $("run").textContent = "▶ 运行"; }
      if (!this.world || this.frameIndex <= 0) return;
      this.setMsg("", "");
      this.showFrame(this.frameIndex - 1);
    }

    showFrame(i) {
      const f = this.world && this.world.frames[i];
      if (!f) return;
      this.frameIndex = i;
      this.renderer.show(f);
      $("empty").classList.add("hide");
      this.editor.setCurrentLine(f.line || 0);
      this.editor.setErrorLine(0);
      this.updateHud(f);
      this.updateButtons();
    }

    updateButtons() {
      if ($("back")) $("back").disabled = !this.world || this.frameIndex <= 0;
    }

    advanceOne() {
      if (!this.world && !this.prepare()) return false;
      if (this.frameIndex < this.world.frames.length - 1) {
        this.showFrame(this.frameIndex + 1);
        return true;
      }
      if (this.done) return false;

      let r;
      try {
        r = this.gen.next();
      } catch (e) {
        this.fail(e);
        return false;
      }
      if (r.done) { this.finish(); return false; }
      this.afterStep();
      return true;
    }

    afterStep() {
      this.setMsg("", "");
      this.showFrame(this.world.frames.length - 1);
    }

    finish() {
      this.done = true;
      this.frameIndex = this.world.frames.length - 1;
      this.showFrame(this.frameIndex);
      this.stopTimer();
      this.running = false;
      $("run").textContent = "▶ 运行";

      const c = this.testCase;
      const frame = this.world.frames[this.world.frames.length - 1];
      const [ok, why] = checkGoal(c.goal, frame, {
        result: this.interp.result,
        initialNodes: c.graph.nodes,
      });
      const retOk = this.interp.result !== null && this.interp.result !== undefined;
      const refsOk = this.world.peak <= c.max_refs;
      const stepsOk = this.world.steps <= c.max_steps;

      let verdict;
      if (!ok) verdict = [`测试点 ${this.caseIndex + 1} 失败`, "fail", why];
      else if (!retOk) verdict = ["return 了 None", "fail", "需要返回新的起始节点"];
      else if (!refsOk) verdict = ["引用数超限", "fail", `峰值 ${this.world.peak} > ${c.max_refs}`];
      else if (!stepsOk) verdict = ["步数超限", "fail", `${this.world.steps} > ${c.max_steps}`];
      else verdict = [`测试点 ${this.caseIndex + 1} 通过`, "case", `提交验证全部 ${this.cases.length} 个测试点`];

      this.status = verdict[1];
      this.setVerdict(`${verdict[0]} · ${this.world.steps} steps`, verdict[1]);
      this.setMsg(`${verdict[0]}：${verdict[2]}`, verdict[1] === "fail" ? "bad" : "ok");
      this.updateButtons();
    }

    submit() {
      this.stopTimer();
      this.running = false;
      $("run").textContent = "▶ 运行";

      let program;
      try {
        program = this.parseCode(this.editor.value);
      } catch (e) {
        this.fail(e);
        return;
      }

      const cases = this.cases;
      const fails = [];
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        let world, interp;
        try {
          world = new World(c, c.seed);
          interp = new Interp(program, world);
          interp.begin();
          const gen = interp.run();
          let r = gen.next();
          let guard = 0;
          while (!r.done) {
            r = gen.next();
            if (++guard > 20000) throw new Error("步数太多");
          }
        } catch (e) {
          fails.push({ i, why: e.message || String(e) });
          continue;
        }
        const frame = world.frames[world.frames.length - 1];
        const [ok, why] = checkGoal(c.goal, frame, {
          result: interp.result,
          initialNodes: c.graph.nodes,
        });
        let reason = null;
        if (!ok) reason = why;
        else if (interp.result === null || interp.result === undefined) reason = "return 了 None";
        else if (world.peak > c.max_refs) reason = `峰值 ${world.peak} > ${c.max_refs}`;
        else if (world.steps > c.max_steps) reason = `${world.steps} 步 > ${c.max_steps}`;
        if (reason) fails.push({ i, why: reason });
      }

      if (!fails.length) {
        this.status = "pass";
        this.setVerdict(`全部 ${cases.length} 个测试点通过`, "pass");
        this.setMsg(`${this.level.title} 通过：${cases.length} 个测试点全部满足`, "ok");
        this.markSolved();
        return;
      }

      const f = fails[0];
      this.caseIndex = f.i;
      this.buildCases();
      this.reset();
      this.prepare();
      this.runInstant();
      this.status = "fail";
      this.setVerdict(`测试点 ${f.i + 1} 失败`, "fail");
      this.setMsg(`测试点 ${f.i + 1}（${this.testCase.detail}）失败：${f.why}`, "bad");
    }

    fail(e) {
      this.status = "fail";
      this.done = true;
      this.stopTimer();
      this.running = false;
      $("run").textContent = "▶ 运行";
      const line = e && e.line ? e.line : 0;
      this.editor.setErrorLine(line);
      const msg = e && e.message ? e.message : String(e);
      this.setMsg(`${line ? `第 ${line} 行 · ` : ""}${msg}`, "bad");
      this.setVerdict("运行出错", "fail");
    }

    toggleRun() {
      if (this.running) {
        this.stopTimer();
        this.running = false;
        $("run").textContent = "▶ 运行";
        return;
      }
      if (this.done) this.reset();
      if (this.dirty) this.reset();
      if (!this.prepare()) return;
      this.status = "running";
      this.running = true;
      $("run").textContent = "⏸ 暂停";
      $("empty").classList.add("hide");

      const speed = Number($("speed").value);
      if (speed === 0) this.runInstant();
      else this.startTimer();
    }

    runInstant() {
      const t0 = performance.now();
      let n = 0;
      while (n++ < 20000) {
        if (!this.advanceOne()) break;
        if (performance.now() - t0 > 1500) break;
      }
      this.running = false;
      $("run").textContent = "▶ 运行";
    }

    startTimer() {
      this.stopTimer();
      const speed = Number($("speed").value) || 180;
      this.timer = setInterval(() => {
        if (!this.advanceOne()) {
          this.stopTimer();
          this.running = false;
          $("run").textContent = "▶ 运行";
        }
      }, speed);
    }

    stopTimer() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    updateHud(frame) {
      $("steps").textContent = String(frame.step);
      $("refs").textContent = String(frame.refs.length);
      $("peak").textContent = `${frame.peak} / ${this.testCase.max_refs}`;
      const names = frame.refs.map((r) => r.label).join(", ");
      $("lastop").textContent = names ? `${frame.op} · ${names}` : frame.op;
    }

    setMsg(text, kind) {
      const el = $("msg");
      el.textContent = text;
      el.className = "msg" + (text ? " on" : "") + (kind === "ok" ? " ok" : "");
    }

    setVerdict(text, kind) {
      const el = $("verdict");
      el.textContent = text;
      el.className = "verdict" + (text ? " show " + kind : "");
    }

    loop() {
      const tick = () => {
        this.renderer.resize();
        this.renderer.physics();
        this.renderer.draw();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    window.__app = new App();
    $("loadinfo").textContent = `${LEVELS.length} 关 · 峰值 = active 变量 + 临时值`;
  });
})();
