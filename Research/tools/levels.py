"""Render Silkworm's per-level background strips.

usage: levels.py ADF CHIPMEM.bin OUT_DIR [--mode planar|mono]

Level loader ($6B93E): level n reads 4 tracks from track number
$6B924[n] into $18E4. The block starts with a table of 20 columns x 9
word offsets (relative to the block), each pointing at a 128-byte cell.
The scroll routine ($69D9A) draws one column per 16 pixels of scroll,
taking column numbers from a byte stream; a negative byte restarts the
stream from the level's first pointer in the table at $69E3C (12 bytes
per level).
"""
import struct
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from extract import tracks, write_png  # noqa: E402

LEVEL_TRACKS = 0x6B924
LEVEL_PTRS = 0x69E3C
PALETTES = 0x67732


def column_pixels(block, col, mode):
    """Return rows of colour indices for one 16-pixel-wide column."""
    offs = struct.unpack_from(">9H", block, col * 18)
    rows = []
    for off in offs:
        cell = block[off:off + 128]
        if mode == "mono":          # 16 x 64, one bitplane
            for y in range(64):
                v = struct.unpack_from(">H", cell, y * 2)[0]
                rows.append([15 if v >> (15 - x) & 1 else 0 for x in range(16)])
        else:                       # 16 x 16, 4 bitplanes interleaved per row
            for y in range(16):
                planes = struct.unpack_from(">4H", cell, y * 8)
                rows.append([sum((planes[p] >> (15 - x) & 1) << p for p in range(4))
                             for x in range(16)])
    return rows


def stream(mem, level):
    """Column numbers for one pass of the level's background stream."""
    a = struct.unpack_from(">I", mem, LEVEL_PTRS + level * 12)[0]
    cols = []
    while mem[a] < 0x80 and len(cols) < 2000:
        cols.append(mem[a])
        a += 1
    return cols


def main():
    adf = open(sys.argv[1], "rb").read()
    mem = open(sys.argv[2], "rb").read()
    out = sys.argv[3]
    mode = sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else "planar"
    for level in range(1, 12):
        track = struct.unpack_from(">H", mem, LEVEL_TRACKS + level * 2)[0]
        block = tracks(adf, track, 4)
        pal = [((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17)
               for c in struct.unpack_from(">16H", mem, PALETTES + level * 64)]
        cols = stream(mem, level)
        strips = [column_pixels(block, c, mode) for c in cols]
        h = len(strips[0])
        px = [[pal[strips[i][y][x]] for i in range(len(cols)) for x in range(16)]
              for y in range(h)]
        path = "%s/level_%02d.png" % (out, level)
        write_png(path, len(cols) * 16, h, px, scale=2)
        print("level %2d: track %3d, %3d columns -> %s" % (level, track, len(cols), path))


if __name__ == "__main__":
    main()
