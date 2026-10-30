"""Dump Silkworm's hardware sprites (shots, missiles) to a sheet.

usage: hwsprites.py CHIPMEM.bin OUT.png

Sprite numbers with bit 9 set ($2xx) go through loc_714AA in sub_712AA:
data at $61132 + n*64, i.e. 16 lines of two words (Amiga sprite format,
plane 0 then plane 1), drawn with colours 17-19 of the level palette.
"""
import struct
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from extract import write_png  # noqa: E402

BANK, COUNT = 0x61132, 69


def sprite(mem, n):
    rows = []
    for y in range(16):
        a, b = struct.unpack_from(">HH", mem, BANK + n * 64 + y * 4)
        rows.append([((a >> (15 - x)) & 1) | (((b >> (15 - x)) & 1) << 1) for x in range(16)])
    return rows


def main():
    mem = open(sys.argv[1], "rb").read()
    # colours 16-19 of level 1's palette ($67772 + 32)
    pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
           for c in struct.unpack_from(">4H", mem, 0x67772 + 32)]
    cols, cell = 12, 20
    rows_n = (COUNT + cols - 1) // cols
    px = [[(40, 40, 60) if ((x // 4 + y // 4) & 1) else (28, 28, 44)
           for x in range(cols * cell)] for y in range(rows_n * cell)]
    for n in range(COUNT):
        x0, y0 = n % cols * cell + 2, n // cols * cell + 2
        for y, row in enumerate(sprite(mem, n)):
            for x, c in enumerate(row):
                if c:
                    px[y0 + y][x0 + x] = pal[c]
    write_png(sys.argv[2], cols * cell, rows_n * cell, px, scale=4)
    print("sprites", COUNT)


if __name__ == "__main__":
    main()
