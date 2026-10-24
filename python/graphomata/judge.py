"""gmj — the level judge / leaderboard for graphomata-cpp.

    python -m graphomata.judge all
    python -m graphomata.judge run levels/03-reverse.json examples/py/03_reverse.py
    python -m graphomata.judge test levels/03-reverse.json examples/cpp/03_reverse.cpp --cost
    python -m graphomata.judge diff
    python -m graphomata.judge gif levels/03-reverse.json examples/py/03_reverse.py --out /tmp/r.gif
"""

from __future__ import annotations

import argparse
import glob
import os
import sys
from typing import Any

from .core import check_goal
from .runner import ROOT, final_frame, load_level, run

LEVELS = os.path.join(ROOT, "levels")


def resolve(path: str) -> str:
    if os.path.isabs(path):
        return path
    if os.path.exists(path):
        return os.path.abspath(path)
    return os.path.join(ROOT, path)


def all_levels() -> list[dict[str, Any]]:
    paths = sorted(glob.glob(os.path.join(LEVELS, "*.json")))
    return [load_level(p) for p in paths]


def evaluate(level: dict[str, Any], trace: dict[str, Any]) -> tuple[bool, str]:
    if trace.get("error"):
        return False, trace["error"]
    return check_goal(level["goal"], final_frame(trace))


def run_seeds(level: dict[str, Any], solution: str, only: int | None = None) -> list[dict[str, Any]]:
    out = []
    for seed in level["seeds"]:
        if only is not None and seed != only:
            continue
        trace, elapsed = run(level, solution, seed)
        ok, why = evaluate(level, trace)
        out.append(
            {
                "seed": seed,
                "ops": trace["ops"],
                "peak": trace["peak_registers"],
                "ok": ok,
                "why": why,
                "ms": elapsed * 1000,
                "trace": trace,
            }
        )
    return out


def bar(ops: int, budget: int, width: int = 24) -> str:
    filled = min(width, max(0, round(width * ops / budget))) if budget else 0
    return "[" + "#" * filled + "." * (width - filled) + f"] {ops}/{budget}"


def print_costs(trace: dict[str, Any]) -> None:
    costs = sorted(trace["line_costs"].items(), key=lambda kv: -kv[1])
    total = sum(v for _, v in costs) or 1
    print("    ops per line:")
    for line, n in costs:
        print(f"      {line:<28} {n:>3}  {100 * n / total:>5.1f}%  {'*' * n}")


def cmd_run(args: argparse.Namespace) -> int:
    level = load_level(resolve(args.level))
    sol = resolve(args.solution)
    results = run_seeds(level, sol, only=args.seed)
    print(f"{level['id']}  {level['title']}   budget {level['budget']}")
    for r in results:
        mark = "ok" if r["ok"] else "FAIL"
        print(f"  seed {r['seed']:>3}: {r['ops']:>3} ops  peak {r['peak']}  {mark}"
              f"  ({r['ms']:.0f} ms)")
        if not r["ok"]:
            print(f"           {r['why']}")
    if args.cost and results:
        print_costs(results[0]["trace"])
    ok = all(r["ok"] for r in results) and len(results) > 0
    print("  verdict:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def cmd_diff(args: argparse.Namespace) -> int:
    bad = 0
    for level in all_levels():
        ref = level.get("reference", {})
        if "cpp" not in ref or "py" not in ref:
            continue
        cpp = run(level, resolve(ref["cpp"]), level["seeds"][0])[0]
        py = run(level, resolve(ref["py"]), level["seeds"][0])[0]
        same = cpp["frames"] == py["frames"] and cpp["ops"] == py["ops"]
        print(f"{level['id']:<14} cpp={cpp['ops']:>3} ops  py={py['ops']:>3} ops  "
              f"{'identical traces' if same else 'MISMATCH'}")
        if not same:
            bad += 1
            for i, (a, b) in enumerate(zip(cpp["frames"], py["frames"])):
                if a != b:
                    print(f"  first divergence at frame {i}:")
                    print("    cpp:", a)
                    print("    py :", b)
                    break
    return 1 if bad else 0


def cmd_all(args: argparse.Namespace) -> int:
    rows = []
    failures = 0
    for level in all_levels():
        ref = level.get("reference", {})
        for lang in ("cpp", "py"):
            if lang not in ref:
                continue
            results = run_seeds(level, resolve(ref[lang]))
            ok = all(r["ok"] for r in results)
            failures += 0 if ok else 1
            rows.append(
                {
                    "level": level,
                    "lang": lang,
                    "ok": ok,
                    "ops": max(r["ops"] for r in results),
                    "best": min(r["ops"] for r in results),
                    "peak": max(r["peak"] for r in results),
                    "why": next((r["why"] for r in results if not r["ok"]), ""),
                }
            )

    print(f"{'level':<14} {'':<22} {'lang':<5} {'ops':>4} {'best':>5} {'peak':>5}  verdict")
    for row in rows:
        lv = row["level"]
        print(
            f"{lv['id']:<14} {lv['title'][:22]:<22} {row['lang']:<5} "
            f"{row['ops']:>4} {row['best']:>5} {row['peak']:>5}  "
            f"{'PASS' if row['ok'] else 'FAIL ' + row['why']}"
        )
    return 0 if failures == 0 else 1


def cmd_trace(args: argparse.Namespace) -> int:
    import json

    level = load_level(resolve(args.level))
    seed = args.seed if args.seed is not None else level["seeds"][0]
    trace, _ = run(level, resolve(args.solution), seed)
    out = resolve(args.out) if args.out else "-"
    text = json.dumps(trace, indent=1)
    if out == "-":
        print(text)
    else:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text)
        ok, why = evaluate(level, trace)
        print(f"wrote {out} ({trace['ops']} ops, {'PASS' if ok else 'FAIL: ' + why})")
    return 0


def cmd_gif(args: argparse.Namespace) -> int:
    from .viz import render_gif

    level = load_level(resolve(args.level))
    seed = args.seed if args.seed is not None else level["seeds"][0]
    trace, _ = run(level, resolve(args.solution), seed)
    render_gif(trace, resolve(args.out), title=f"{level['id']} — {level['title']}")
    ok, why = evaluate(level, trace)
    print(f"wrote {args.out} ({trace['ops']} ops, {'PASS' if ok else 'FAIL: ' + why})")
    return 0 if ok else 1


def cmd_sheet(args: argparse.Namespace) -> int:
    from .viz import render_sheet

    level = load_level(resolve(args.level))
    seed = args.seed if args.seed is not None else level["seeds"][0]
    trace, _ = run(level, resolve(args.solution), seed)
    render_sheet(trace, resolve(args.out), title=f"{level['id']} — {level['title']}")
    ok, why = evaluate(level, trace)
    print(f"wrote {args.out} ({trace['ops']} ops, {'PASS' if ok else 'FAIL: ' + why})")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gmj", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("run", help="run a solution once (or one seed)")
    p.add_argument("level")
    p.add_argument("solution")
    p.add_argument("--seed", type=int)
    p.add_argument("--cost", action="store_true", help="print per-line op costs")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("test", help="run a solution on every seed")
    p.add_argument("level")
    p.add_argument("solution")
    p.add_argument("--seed", type=int)
    p.add_argument("--cost", action="store_true")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("all", help="run the reference solutions of every level")
    p.set_defaults(func=cmd_all)

    p = sub.add_parser("diff", help="compare C++ and Python traces, frame by frame")
    p.set_defaults(func=cmd_diff)

    p = sub.add_parser("trace", help="dump a trace as JSON")
    p.add_argument("level")
    p.add_argument("solution")
    p.add_argument("--seed", type=int)
    p.add_argument("--out")
    p.set_defaults(func=cmd_trace)

    p = sub.add_parser("sheet", help="render key frames as a still storyboard")
    p.add_argument("level")
    p.add_argument("solution")
    p.add_argument("--seed", type=int)
    p.add_argument("--out", default="graphomata-sheet.png")
    p.set_defaults(func=cmd_sheet)

    p = sub.add_parser("gif", help="render a trace as an animated GIF")
    p.add_argument("level")
    p.add_argument("solution")
    p.add_argument("--seed", type=int)
    p.add_argument("--out", default="graphomata.gif")
    p.set_defaults(func=cmd_gif)

    args = ap.parse_args(argv)
    if not hasattr(args, "out"):
        args.out = None
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
