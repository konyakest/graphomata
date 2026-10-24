"""Turn a trace into something you can watch.

The graph UI is not the input method any more — it is the debugger: replay,
scrub, and see which edge moved because of which line.
"""

from __future__ import annotations

import math
from typing import Any

from PIL import Image, ImageDraw, ImageFont

W, H = 1100, 700
BG = (13, 17, 26)
INK = (201, 213, 234)
DIM = (94, 111, 138)
NODE_FILL = (26, 35, 52)
NODE_EDGE = (62, 79, 105)
EDGE = (74, 95, 128)
ADDED = (81, 207, 102)
REMOVED = (255, 107, 107)
ACCENT = (255, 212, 59)

WORKER_COLORS = {
    1: (255, 107, 107),  # a
    2: (77, 171, 247),   # b
    3: (81, 207, 102),   # c
    4: (255, 212, 59),   # d
    5: (204, 93, 232),   # e
    6: (34, 184, 207),   # f
    7: (255, 146, 43),   # g
}
NAMES = "habcdefg"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
MONO_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def _font(size: int, mono: bool = False) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(MONO_PATH if mono else FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def layout(frames: list[dict[str, Any]]) -> dict[int, tuple[float, float]]:
    """One fixed layout for the whole animation: force-directed on the union."""
    ids = sorted({n for f in frames for n in f["nodes"]})
    edges = {(u, v) for f in frames for u, v in f["edges"]}
    idx = {n: i for i, n in enumerate(ids)}
    n = len(ids)
    if n == 0:
        return {}
    cx, cy, radius = W / 2, H / 2 - 30, min(W, H) * 0.30
    pos = [
        (cx + radius * math.cos(2 * math.pi * i / n), cy + radius * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]
    ideal = 170.0
    for _ in range(220):
        disp = [[0.0, 0.0] for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                dx, dy = pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]
                d2 = dx * dx + dy * dy + 1e-3
                d = math.sqrt(d2)
                f = 9000.0 / d2
                disp[i][0] += f * dx / d
                disp[i][1] += f * dy / d
                disp[j][0] -= f * dx / d
                disp[j][1] -= f * dy / d
        for u, v in edges:
            i, j = idx[u], idx[v]
            dx, dy = pos[j][0] - pos[i][0], pos[j][1] - pos[i][1]
            d = math.hypot(dx, dy) + 1e-6
            f = 0.012 * (d - ideal)
            disp[i][0] += f * dx / d
            disp[i][1] += f * dy / d
            disp[j][0] -= f * dx / d
            disp[j][1] -= f * dy / d
        for i in range(n):
            pos[i] = (
                min(W - 90, max(90, pos[i][0] + max(-25, min(25, disp[i][0])))),
                min(H - 150, max(90, pos[i][1] + max(-25, min(25, disp[i][1])))),
            )
    return {nid: pos[i] for nid, i in idx.items()}


def _arrow(draw: ImageDraw.ImageDraw, p, q, r: float, color, width: int = 2, offset: float = 0.0):
    dx, dy = q[0] - p[0], q[1] - p[1]
    d = math.hypot(dx, dy)
    if d < 1:
        return
    nx, ny = -dy / d * offset, dx / d * offset
    ux, uy = dx / d, dy / d
    ax, ay = p[0] + ux * r + nx, p[1] + uy * r + ny
    bx, by = q[0] - ux * (r + 9) + nx, q[1] - uy * (r + 9) + ny
    draw.line([(ax, ay), (bx, by)], fill=color, width=width)
    size = 9
    left = (bx - ux * size - uy * size * 0.6, by - uy * size + ux * size * 0.6)
    right = (bx - ux * size + uy * size * 0.6, by - uy * size - ux * size * 0.6)
    draw.polygon([(bx, by), left, right], fill=color)


def draw_frame(frame: dict[str, Any], prev: dict[str, Any] | None, pos, title: str,
               index: int, total: int, duration_note: str = "") -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    small, mono, tiny = _font(15), _font(17, True), _font(13)
    big = _font(24)

    d.text((36, 26), title, font=big, fill=INK)
    d.text((36, 58), "graphomata · graph machine", font=tiny, fill=DIM)

    edges = {tuple(e) for e in frame["edges"]}
    prev_edges = {tuple(e) for e in prev["edges"]} if prev else set(edges)
    added = (edges - prev_edges) if prev else set()
    removed = (prev_edges - edges) if prev else set()
    r = 30.0

    for u, v in sorted(edges | removed):
        if u not in pos or v not in pos:
            continue
        offset = 7.0 if (v, u) in (edges | removed) and u < v else 0.0
        color = EDGE
        width = 3
        if (u, v) in added:
            color, width = ADDED, 4
        elif (u, v) in removed:
            color, width = REMOVED, 3
        _arrow(d, pos[u], pos[v], r, color, width, offset)

    for nid in frame["nodes"]:
        x, y = pos[nid]
        d.ellipse([x - r, y - r, x + r, y + r], fill=NODE_FILL, outline=NODE_EDGE, width=2)
        label = f"n{nid}"
        tw = d.textlength(label, font=small)
        d.text((x - tw / 2, y - 10), label, font=small, fill=INK)

    # workers standing on nodes
    on_node: dict[int, list[int]] = {}
    for c in range(1, 8):
        node = frame["workers"][c]
        if node >= 0:
            on_node.setdefault(node, []).append(c)
    for node, cursors in on_node.items():
        if node not in pos:
            continue
        x, y = pos[node]
        for k, c in enumerate(cursors):
            angle = -math.pi / 2 + (k - (len(cursors) - 1) / 2) * 0.55
            wx, wy = x + math.cos(angle) * (r + 17), y + math.sin(angle) * (r + 17)
            d.ellipse([wx - 11, wy - 11, wx + 11, wy + 11],
                      fill=WORKER_COLORS[c], outline=(0, 0, 0))
            letter = NAMES[c]
            tw = d.textlength(letter, font=tiny)
            d.text((wx - tw / 2, wy - 7), letter, font=tiny, fill=(8, 12, 20))

    # home strip
    hy = H - 96
    d.text((36, hy), "HOME", font=tiny, fill=DIM)
    hx = 96
    for c in range(1, 8):
        if frame["workers"][c] < 0:
            d.ellipse([hx, hy - 2, hx + 26, hy + 24], fill=WORKER_COLORS[c])
            letter = NAMES[c]
            tw = d.textlength(letter, font=tiny)
            d.text((hx + 13 - tw / 2, hy + 5), letter, font=tiny, fill=(8, 12, 20))
            hx += 34

    op = frame["op"]
    args = frame["args"]
    if op == "init":
        caption = "initial graph"
    else:
        caption = f"{op}(" + ", ".join(NAMES[a] for a in args) + ")"
    d.text((36, H - 132), f"op {index:>2}/{total}   {caption}", font=mono, fill=ACCENT)

    # budget bar
    done = index / total if total else 0
    d.rectangle([36, H - 56, W - 36, H - 46], outline=NODE_EDGE, fill=(20, 26, 38))
    d.rectangle([36, H - 56, 36 + (W - 72) * done, H - 46], fill=ACCENT)
    if duration_note:
        d.text((W - 300, H - 80), duration_note, font=tiny, fill=DIM)
    return img


def render_gif(trace: dict[str, Any], path: str, title: str = "graphomata",
               duration: int = 320, hold: int = 1200) -> None:
    frames = trace["frames"]
    pos = layout(frames)
    total = len(frames) - 1
    images = []
    for i, f in enumerate(frames):
        prev = frames[i - 1] if i else None
        images.append(
            draw_frame(f, prev, pos, title, i, total,
                       f"{trace['ops']} ops · peak {trace['peak_registers']}")
        )
    images[0].save(
        path,
        save_all=True,
        append_images=images[1:],
        duration=[duration] * (len(images) - 1) + [hold],
        loop=0,
        optimize=True,
    )


def render_sheet(trace: dict[str, Any], path: str, title: str, cols: int = 3,
                 picks: int = 6) -> None:
    """A still storyboard: key frames in a grid, for READMEs and chat."""
    frames = trace["frames"]
    pos = layout(frames)
    total = len(frames) - 1
    if len(frames) <= picks:
        chosen = list(range(len(frames)))
    else:
        chosen = sorted({round(i * (len(frames) - 1) / (picks - 1)) for i in range(picks)})
    thumbs = [
        draw_frame(frames[i], frames[i - 1] if i else None, pos, title, i, total)
        for i in chosen
    ]
    tw, th = W // 2, H // 2
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, th * rows), BG)
    for k, im in enumerate(thumbs):
        sheet.paste(im.resize((tw, th), Image.LANCZOS), ((k % cols) * tw, (k // cols) * th))
    sheet.save(path)
