"""Dump Silkworm's 400 sprite/bob objects to a contact sheet.

usage: sprites.py CHIPMEM.bin OUT.png [PALETTE_ADDR]
Format (from the setup routine at $715C0):
  $4A498: 400 longs, object record = value + $5F3B8
  record: +0 width in words, +2 rows, +6/+8 hotspot, +$E pixel offset from $4AAD8
  pixels: per row, 4 bitplanes of `width` words each
"""
import struct
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from extract import write_png  # noqa: E402

# stand-in palette until the in-game one is located
DEFAULT = [(0, 0, 0), (34, 34, 51), (68, 68, 85), (102, 102, 119),
           (136, 136, 153), (187, 187, 204), (238, 238, 255), (255, 255, 255),
           (136, 51, 17), (204, 102, 34), (255, 170, 51), (255, 238, 102),
           (34, 102, 34), (68, 170, 68), (34, 68, 153), (85, 136, 238)]


def main():
    mem = open(sys.argv[1], "rb").read()
    pal = DEFAULT
    if len(sys.argv) > 3:
        a = int(sys.argv[3], 0)
        pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
               for c in struct.unpack_from(">16H", mem, a)]
    objs = []
    for i in range(400):
        rec = (struct.unpack_from(">I", mem, 0x4A498 + i * 4)[0] + 0x5F3B8) & 0xFFFFFFFF
        w, rows = struct.unpack_from(">HH", mem, rec)
        off = struct.unpack_from(">I", mem, rec + 0xE)[0] + 0x4AAD8
        if not (1 <= w <= 8 and 1 <= rows <= 200 and off + rows * w * 8 <= len(mem)):
            continue
        img = []
        for y in range(rows):
            row = []
            base = off + y * w * 8
            for x in range(w * 16):
                word, bit = x // 16, 15 - x % 16
                idx = 0
                for p in range(4):
                    v = struct.unpack_from(">H", mem, base + (p * w + word) * 2)[0]
                    idx |= (v >> bit & 1) << p
                row.append(idx)
            img.append(row)
        objs.append((i, w * 16, rows, img))

    # shelf-pack onto a 640-wide sheet, colour 0 shown as dark checker
    sheet_w, x, y, shelf, place = 640, 0, 0, 0, []
    for i, w, h, img in objs:
        if x + w + 2 > sheet_w:
            x, y, shelf = 0, y + shelf + 2, 0
        place.append((x, y, img))
        x += w + 2
        shelf = max(shelf, h)
    sheet_h = y + shelf
    px = [[(24, 24, 32) if (xx // 4 + yy // 4) % 2 else (16, 16, 22)
           for xx in range(sheet_w)] for yy in range(sheet_h)]
    for x0, y0, img in place:
        for yy, row in enumerate(img):
            for xx, c in enumerate(row):
                if c:
                    px[y0 + yy][x0 + xx] = pal[c]
    write_png(sys.argv[2], sheet_w, sheet_h, px, scale=2)
    print("objects drawn:", len(objs), "sheet", sheet_w, "x", sheet_h)


if __name__ == "__main__":
    main()
