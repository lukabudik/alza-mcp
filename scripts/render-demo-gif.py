#!/usr/bin/env python3
"""Render docs/demo.gif from a real `claude -p --output-format stream-json` transcript.

Usage: python3 scripts/render-demo-gif.py <session.jsonl> <out.gif>
Requires Pillow. Every tool call, argument, result summary and answer line is derived from the
transcript; nothing is invented. Claude Code's own ToolSearch bootstrap and tool calls that were
denied by the permission mode (outside the catalog allow-list) are skipped.
"""
import json, re, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

W, H = 780, 470
BG, BAR = (28, 31, 37), (58, 62, 71)
FG, DIM = (230, 232, 236), (150, 155, 165)
BLUE, PURPLE, GREEN, YEL = (122, 162, 247), (187, 154, 247), (115, 218, 138), (224, 175, 104)
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 13)
BOLD = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 13)
CW, LH, X0, Y0, COLS = 7.83, 19, 18, 50, 94
MAX_LINES = (H - Y0 - 10) // LH


def load(path):
    calls, results, answer = [], {}, ""
    # -p mode does not echo the prompt: read it from the recording script.
    prompt = re.search(r"^PROMPT='(.*)'$", open(__file__.replace("render-demo-gif.py", "record-demo-session.sh")).read(), re.M).group(1)
    for raw in open(path):
        d = json.loads(raw)
        msg = d.get("message")
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for c in content:
            if c.get("type") == "tool_use" and c["name"].startswith("mcp__alza__"):
                calls.append(c)
            elif c.get("type") == "tool_result":
                x = c["content"]
                results[c["tool_use_id"]] = x if isinstance(x, str) else "".join(p.get("text", "") for p in x)
            elif c.get("type") == "text" and d["type"] == "assistant":
                answer = c["text"]
    return prompt, calls, results, answer


def clip(t, n):
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def summarize(name, data):
    if name == "search_products":
        p = data["products"][0]
        return f"{data['total']} results · top: {clip(p['name'], 40)} · {p['price']:.0f} Kč · ★{p['rating']}"
    if name == "get_product":
        p = data["product"]
        return f"{clip(p['name'], 40)} · {p['price']:.0f} Kč · {p['availability']} · ★{p['rating']}"
    if name == "find_pickup_points":
        pts = data["points"]
        return f"{len(pts)} showrooms · nearest: {pts[0]['name']} ({pts[0]['distanceKm']} km)"
    return ""


def main(src, out):
    prompt, calls, results, answer = load(src)
    # Keep only calls that returned real data (skip permission-denied ones).
    steps = []
    for c in calls:
        r = results.get(c["id"], "")
        if not r.startswith("{"):
            continue
        name = c["name"].removeprefix("mcp__alza__")
        args = "  ".join(f'{k}={json.dumps(v, ensure_ascii=False)}' for k, v in c["input"].items())
        steps.append((name, args, summarize(name, json.loads(r))))
    # Answer: strip markdown, keep the recommendation + pickup paragraphs.
    paras = [re.sub(r"\*\*|`", "", p).strip() for p in answer.split("\n\n")]
    paras = [p for p in paras if p and not p.startswith("I couldn't")]

    # Build logical lines: (text, colour, kind). kind "type" = typed char by char, "pend" = call awaiting result.
    frames = []  # (lines, duration_ms)

    def render(lines, cursor=True):
        im = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, W, 32], fill=BAR)
        for i, col in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse([16 + i * 20, 11, 28 + i * 20, 23], fill=col)
        d.text((W / 2, 16), "claude code — alza-mcp-community (catalog toolset)", font=FONT, fill=DIM, anchor="mm")
        vis = lines[-MAX_LINES:]
        for i, (t, col, bold) in enumerate(vis):
            d.text((X0, Y0 + i * LH), t, font=BOLD if bold else FONT, fill=col)
        if cursor and vis:
            t = vis[-1][0]
            x = X0 + CW * len(t) + 2
            d.rectangle([x, Y0 + (len(vis) - 1) * LH + 2, x + 7, Y0 + (len(vis) - 1) * LH + 16], fill=FG)
        return im

    def push(lines, ms, cursor=True):
        frames.append((render(lines, cursor), ms))

    lines = []
    wrapped = textwrap.wrap(prompt, COLS - 2)
    # type the prompt (3 chars per frame)
    typed = ""
    full = " ".join(wrapped)
    for i in range(0, len(full) + 1, 4):
        cur = textwrap.wrap(full[:i], COLS - 2) or [""]
        push([("› " + cur[0], BLUE, True)] + [("  " + x, FG, False) for x in cur[1:]], 55)
    prompt_lines = [("› " + wrapped[0], BLUE, True)] + [("  " + x, FG, False) for x in wrapped[1:]]
    lines = prompt_lines + [("", FG, False)]
    push(lines, 700, False)
    for name, args, summ in steps:
        head = f"⚙ {name}  {args}"
        lines.append((head[: COLS], PURPLE, False))
        push(lines, 900)
        lines.append(("  ↳ " + summ[: COLS - 4], GREEN, False))
        push(lines, 1500, False)
    lines.append(("", FG, False))
    for p in paras:
        for ln in textwrap.wrap(p, COLS):
            base = len(lines)
            lines.append(("", FG, False))
            for i in range(0, len(ln) + 1, 6):
                lines[base] = (ln[:i], FG, False)
                push(lines, 40)
            lines[base] = (ln, FG, False)
        lines.append(("", FG, False))
        push(lines, 900, False)
    push(lines, 3500, False)

    total = sum(ms for _, ms in frames)
    print(f"frames={len(frames)} duration={total / 1000:.1f}s", file=sys.stderr)
    imgs = [f.convert("P", palette=Image.ADAPTIVE, colors=32) for f, _ in frames]
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=[ms for _, ms in frames], loop=0, optimize=True, disposal=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
