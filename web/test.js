/* Headless check for the web build: runs every level's reference solution
 * through the browser VM + interpreter and compares op counts with the native
 * judge.  Run with:  node web/test.js
 */
"use strict";

const path = require("path");
const { VM, checkGoal } = require(path.join(__dirname, "vm.js"));
const { Py } = require(path.join(__dirname, "py.js"));
const { LEVELS } = require(path.join(__dirname, "levels.js"));

function run(level, code, seed) {
  const vm = new VM(level, seed);
  const output = [];
  const interp = new Py.Interp(Py.parse(code), { vm, output });
  const gen = interp.start("solve", [new Py.WorldRef(vm)]);
  let result = gen.next();
  let guard = 0;
  while (!result.done) {
    result = gen.next();
    if (++guard > 200000) throw new Error("too many yields");
  }
  return { vm, output };
}

// Values measured with the native judge (tools/gmj all).
const EXPECTED = {
  "01-hello": 1,
  "02-chain": 9,
  "03-reverse": 17,
  "04-clone": 22,
  "06-even": 25,
};

let failures = 0;
for (const level of LEVELS) {
  for (const seed of level.seeds.slice(0, 3)) {
    try {
      const { vm } = run(level, level.reference, seed);
      const [ok, why] = checkGoal(level.goal, vm.lastFrame());
      const expected = EXPECTED[level.id];
      const opsOk = expected === undefined || vm.ops === expected;
      if (!ok || !opsOk) {
        failures++;
        console.log(`FAIL ${level.id} seed=${seed}: ops=${vm.ops} goal=${ok}:${why}`);
      } else {
        console.log(`ok   ${level.id} seed=${seed} ops=${vm.ops} peak=${vm.peak}`);
      }
    } catch (e) {
      failures++;
      console.log(`ERR  ${level.id} seed=${seed}: ${e.message} (line ${e.line || "?"})`);
    }
  }
}

// The interpreter should also fail gracefully on bad code.
try {
  run(LEVELS[2], "def solve(w):\n    w.link(A, A)\n", 1);
  console.log("FAIL expected an IllegalOp for self-link");
  failures++;
} catch (e) {
  console.log(`ok   illegal op reported: ${e.message}`);
}

process.exit(failures ? 1 : 0);
