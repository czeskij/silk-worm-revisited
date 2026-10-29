"""Decode Silkworm's enemy wave scripts.

usage: waves.py CHIPMEM.bin OUT_DIR

Scheduler ($6EEF6): script for level n at long $6EEA0 + (n-1)*4.
Script: pairs of words (clock, action) until clock < 0. When the level
clock -$7FD2(a6) reaches `clock`, the routine at $6D21E + |action| runs
(action < 0: as its own task via sub_6C4E2, else via sub_6C852).

Routines are mostly stubs `moveq #count,d0 / bra common`; the common code
spawns `count` copies of a child behaviour (loc_6FADA: d1 = frames apart).
Each behaviour picks an animation with sub_6C8F6 (a0 = list of sprite
numbers from the 400-object bank, $FFFF = loop), often indexed by level*8.

This script finds those animations by statically walking each routine's
code, so the sprite it shows for a wave is a best guess.
"""
import re
import struct
import sys

import capstone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from extract import write_png  # noqa: E402
from sprites import DEFAULT  # noqa: E402

SCRIPTS = 0x6EEA0
ROUTINE_BASE = 0x6D21E
SET_ANIM = 0x6C8F6          # a0 = animation list
SET_ANIM_INLINE = 0x6C8DA   # animation list follows the bsr; code resumes after $FFFF
SPRITE_PTRS, SPRITE_REC_BIAS, SPRITE_PIX = 0x4A498, 0x5F3B8, 0x4AAD8
PALETTES = 0x67732
LIBRARY = [(0x6C400, 0x6CA00), (0x71000, 0x72000)]   # task/anim/blit helpers

# routines identified by reading their code
NAMES = {
    0x6E03A: "gun emplacement built into the ground layer (columns $5A/$5B)",
    0x6F736: "screen flash: palette colour $448 pulsed 3x (not an enemy)",
    0x705D0: "end-of-level boss A",
    0x6DB1E: "end-of-level boss B",
    0x70512: "final boss (level 11)",
}

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_M68K_000)


def w16(mem, a):
    return struct.unpack_from(">H", mem, a)[0]


def anim_frames(mem, a):
    """Sprite numbers of an animation list at a, or None if it isn't one."""
    frames = []
    for i in range(16):
        v = w16(mem, a + i * 2)
        if v == 0xFFFF:
            return frames or None
        if v & 0x6000:          # jump/loop control words carry a target
            return frames or None
        if v >= 400:
            return None
        frames.append(v)
    return None


def scripts(mem):
    out = {}
    for lv in range(1, 12):
        p = struct.unpack_from(">I", mem, SCRIPTS + (lv - 1) * 4)[0]
        ev = []
        while True:
            t, a = struct.unpack_from(">hh", mem, p)
            if t < 0:
                break
            ev.append((t, ROUTINE_BASE + abs(a), a < 0))
            p += 4
        out[lv] = ev
    return out


def walk(mem, start, level, limit=600):
    """Return (count, frames) found by walking the routine's code."""
    count, frames = None, []
    seen, work, n = set(), [start], 0
    last_lea, level_indexed = None, False
    while work and n < limit:
        pc = work.pop()
        while pc not in seen and n < limit:
            ins = next(md.disasm(mem[pc:pc + 10], pc), None)
            if ins is None:
                break
            seen.add(pc)
            n += 1
            mn, ops = ins.mnemonic, ins.op_str
            # group size: stubs start `moveq #count,d0`
            if pc == start and mn == "moveq" and ops.endswith("d0"):
                count = int(re.search(r"#\$([0-9a-f]+)", ops).group(1), 16)
            m = re.fullmatch(r"#\$([0-9a-f]+), \$32\(a5\)", ops)
            if mn.startswith("move") and m and int(m.group(1), 16) < 400:
                f = [int(m.group(1), 16)]
                if f not in frames:
                    frames.append(f)
            m = re.fullmatch(r"\$([0-9a-f]+)\(pc\), a0", ops)
            if mn.startswith("lea") and m:
                last_lea, level_indexed = int(m.group(1), 16), False
                t = last_lea
                if anim_frames(mem, t) is None and t not in seen:
                    work.append(t)      # child behaviour passed in a0
            if "-$7f20(a6)" in ops:
                level_indexed = True
            m = re.search(r"\$([0-9a-f]+)$", ops)
            tgt = int(m.group(1), 16) if m and (mn.startswith(("b", "db", "jsr", "jmp"))) else None
            if tgt == SET_ANIM_INLINE:
                a, f = pc + ins.size, []
                while w16(mem, a) < 0x8000:
                    if w16(mem, a) < 400:
                        f.append(w16(mem, a))
                    a += 2
                if f and f not in frames:
                    frames.append(f)
                pc = a + 2
                continue
            if tgt == SET_ANIM and last_lea is not None:
                a = last_lea + (level * 8 if level_indexed else 0)
                f = anim_frames(mem, a) or anim_frames(mem, last_lea)
                if f and f not in frames:
                    frames.append(f)
            elif tgt is not None and not any(lo <= tgt < hi for lo, hi in LIBRARY):
                if mn.startswith(("bsr", "jsr")) or mn.startswith("b") and mn not in ("bra", "bra.b", "bra.w"):
                    work.append(tgt)
                elif mn.startswith(("bra", "jmp")):
                    work.append(tgt)
            if mn.split(".")[0] in ("rts", "rte", "bra", "jmp"):
                break
            pc += ins.size
    return count, frames


def sprite_image(mem, idx, pal):
    rec = (struct.unpack_from(">I", mem, SPRITE_PTRS + idx * 4)[0] + SPRITE_REC_BIAS) & 0xFFFFFFFF
    w, rows = struct.unpack_from(">HH", mem, rec)
    off = struct.unpack_from(">I", mem, rec + 0xE)[0] + SPRITE_PIX
    img = []
    for y in range(rows):
        base = off + y * w * 8
        img.append([sum(((w16(mem, base + (p * w + x // 16) * 2) >> (15 - x % 16)) & 1) << p
                        for p in range(4)) for x in range(w * 16)])
    return img


def timeline(mem, lv, events, path):
    """One row per wave: clock bar on the left, sprite on the right."""
    pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
           for c in struct.unpack_from(">16H", mem, PALETTES + lv * 64)]
    end = max(t for t, *_ in events) or 1
    row_h, bar_w, width = 36, 300, 300 + 12 + 200
    h = row_h * len(events)
    px = [[(20, 20, 28)] * width for _ in range(h)]
    for i, (t, count, frames) in enumerate(events):
        y0 = i * row_h
        x = int(t / end * (bar_w - 4))
        for yy in range(y0 + 14, y0 + 22):
            for xx in range(0, bar_w):
                px[yy][xx] = (60, 60, 80) if xx > x else (200, 160, 40)
        x0 = bar_w + 12
        for k in range(min(count or 1, 6)):
            if not frames:
                break
            img = sprite_image(mem, frames[0][0], pal)
            for yy, row in enumerate(img[:row_h - 2]):
                for xx, c in enumerate(row):
                    if c and x0 + xx < width:
                        px[y0 + 1 + yy][x0 + xx] = pal[c]
            x0 += len(img[0]) + 2
            if x0 >= width:
                break
    write_png(path, width, h, px)


def legend(mem, uses, path):
    """Every routine with its main sprite (level-1 palette), sorted by use."""
    pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
           for c in struct.unpack_from(">16H", mem, PALETTES + 64)]
    cell_w, cell_h, cols = 80, 56, 10
    items = sorted(uses.items(), key=lambda kv: -kv[1][0])
    rows = (len(items) + cols - 1) // cols
    px = [[(20, 20, 28)] * (cell_w * cols) for _ in range(cell_h * rows)]
    for i, (addr, (n, frames)) in enumerate(items):
        x0, y0 = i % cols * cell_w, i // cols * cell_h
        if not frames:
            for yy in range(y0 + 20, y0 + 28):
                for xx in range(x0 + 30, x0 + 50):
                    px[yy][xx] = (90, 30, 30)
            continue
        img = sprite_image(mem, frames[0][0], pal)
        for yy, row in enumerate(img[:cell_h - 2]):
            for xx, c in enumerate(row[:cell_w - 2]):
                if c:
                    px[y0 + 1 + yy][x0 + 1 + xx] = pal[c]
    write_png(path, cell_w * cols, cell_h * rows, px, scale=2)
    return items


def main():
    mem = open(sys.argv[1], "rb").read()
    out = sys.argv[2]
    lines, uses = [], {}
    for lv, ev in scripts(mem).items():
        lines.append("Level %d — %d waves" % (lv, len(ev)))
        rows = []
        for t, addr, own_task in ev:
            count, frames = walk(mem, addr, lv)
            sprites = " / ".join(",".join(str(f) for f in fr) for fr in frames[:3]) or "?"
            lines.append("  clock %4d  routine $%05X  %-4s  x%-2s  sprites %-28s %s" % (
                t, addr, "task" if own_task else "call", count if count is not None else "?",
                sprites, NAMES.get(addr, "")))
            rows.append((t, count, frames))
            n, f0 = uses.get(addr, (0, frames))
            uses[addr] = (n + 1, f0 or frames)
        lines.append("")
        timeline(mem, lv, rows, "%s/waves_level_%02d.png" % (out, lv))
    items = legend(mem, uses, out + "/legend.png")
    lines.append("Legend (legend.png, left to right, top to bottom; most used first)")
    for i, (addr, (n, frames)) in enumerate(items):
        lines.append("  %3d  $%05X  used %2dx  sprite %-4s %s" % (
            i, addr, n, frames[0][0] if frames else "?", NAMES.get(addr, "")))
    open(out + "/waves.txt", "w").write("\n".join(lines))
    print("routines:", len(items))


if __name__ == "__main__":
    main()
