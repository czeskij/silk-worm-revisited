"""Compose a full map of each Silkworm level.

usage: maps.py ADF CHIPMEM.bin OUT_DIR

Scroll step sub_69C4A runs once per pixel of ground scroll:
  - level clock -$7FD2 += 1 (the wave clock), so a level is 4704 px long
  - ground layer advances 1 px, backdrop every other step (half-speed parallax)
  - every 32 steps the scenery stream takes one step (sub_69D52)

Layers, top to bottom:
  backdrop  144 px  level block columns (levels.py), drawn here 1:1 and looping
                    (in game it scrolls at half speed)
  ground     24 px  stream -$7FD6: column n = 192 bytes at $62272 + n*$C0
                    (16 x 24, 4 bitplanes interleaved per row)
  scenery           stream -$7E5A: word = sprite number, negative = skip
                    (-w - 1) slots; object at world x = scroll + $150, drawn
                    at y = $90 - $F minus the sprite's hotspot
Under the map: where each enemy wave enters (wave clock + one screen).
"""
import struct
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from extract import tracks, write_png  # noqa: E402
from levels import LEVEL_PTRS, LEVEL_TRACKS, PALETTES, column_pixels, stream  # noqa: E402
from waves import scripts, sprite_image, walk  # noqa: E402

GROUND_BANK = 0x62272
LEVEL_LEN = 4704
SCREEN_W = 320
BACK_H, GROUND_H = 144, 24
SCENERY_Y = 0x90 - 0xF
BAND_H = 44


def ground_stream(mem, level):
    a = struct.unpack_from(">I", mem, LEVEL_PTRS + level * 12 + 4)[0]
    cols = []
    while mem[a] < 0x80 and len(cols) < 5000:
        cols.append(mem[a])
        a += 1
    return cols


def scenery(mem, level, length):
    """[(world_x, sprite)] following sub_69D52."""
    a = struct.unpack_from(">I", mem, LEVEL_PTRS + level * 12 + 8)[0]
    delay, out = 0, []
    for pos in range(0, length, 32):
        delay -= 1
        if delay >= 0:
            continue
        w = struct.unpack_from(">h", mem, a)[0]
        a += 2
        if w < 0:
            delay = -w - 1
        elif w:
            out.append((pos + 0x150, w))
    return out


def sprite_rec(mem, idx):
    rec = (struct.unpack_from(">I", mem, 0x4A498 + idx * 4)[0] + 0x5F3B8) & 0xFFFFFFFF
    return struct.unpack_from(">hh", mem, rec + 6)


def blit(px, img, x0, y0, pal):
    for yy, row in enumerate(img):
        y = y0 + yy
        if not 0 <= y < len(px):
            continue
        for xx, c in enumerate(row):
            x = x0 + xx
            if c and 0 <= x < len(px[0]):
                px[y][x] = pal[c]


def main():
    adf = open(sys.argv[1], "rb").read()
    mem = open(sys.argv[2], "rb").read()
    out = sys.argv[3]
    waves = scripts(mem)
    width = LEVEL_LEN + SCREEN_W
    height = BACK_H + GROUND_H + BAND_H
    for level in range(1, 12):
        pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
               for c in struct.unpack_from(">16H", mem, PALETTES + level * 64)]
        px = [[(16, 16, 22)] * width for _ in range(height)]

        # backdrop
        track = struct.unpack_from(">H", mem, LEVEL_TRACKS + level * 2)[0]
        block = tracks(adf, track, 4)
        back = stream(mem, level)
        for i in range(width // 16 + 1):
            col = column_pixels(block, back[i % len(back)], "planar")
            for y in range(BACK_H):
                for x in range(16):
                    if i * 16 + x < width:
                        px[y][i * 16 + x] = pal[col[y][x]]

        # ground
        ground = ground_stream(mem, level)
        for i in range(width // 16 + 1):
            base = GROUND_BANK + ground[i % len(ground)] * 0xC0
            for y in range(GROUND_H):
                planes = struct.unpack_from(">4H", mem, base + y * 8)
                for x in range(16):
                    if i * 16 + x < width:
                        c = sum((planes[p] >> (15 - x) & 1) << p for p in range(4))
                        px[BACK_H + y][i * 16 + x] = pal[c]

        # scenery objects
        objs = scenery(mem, level, LEVEL_LEN)
        for wx, spr in objs:
            hx, hy = sprite_rec(mem, spr)
            blit(px, sprite_image(mem, spr, pal), wx - hx, SCENERY_Y - hy, pal)

        # enemy waves: icon where the wave enters (clock + one screen)
        band = BACK_H + GROUND_H
        for y in range(band, height):
            for x in range(0, width, 320):
                px[y][x] = (60, 60, 80)
        lane = 0
        for t, addr, _ in waves[level]:
            _, frames = walk(mem, addr, level)
            x = t + SCREEN_W
            for yy in range(band, band + 3):
                for xx in range(x - 1, x + 2):
                    if 0 <= xx < width:
                        px[yy][xx] = (200, 160, 40)
            if frames:
                img = sprite_image(mem, frames[0][0], pal)
                blit(px, [r[:40] for r in img[:BAND_H - 6]],
                     x - min(len(img[0]), 40) // 2, band + 4 + (lane % 2) * 2, pal)
            lane += 1

        path = "%s/map_level_%02d.png" % (out, level)
        write_png(path, width, height, px)
        print("level %2d: %d scenery objects, %d waves -> %s" % (level, len(objs), len(waves[level]), path))


if __name__ == "__main__":
    main()
