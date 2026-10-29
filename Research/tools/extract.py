"""Rebuild what the Silkworm boot block loads into chip RAM.

usage: extract.py ADF OUT_DIR
writes OUT_DIR/chipmem.bin (512 KB, as RAM looks when the game starts)
       OUT_DIR/loading_screen.png
"""
import struct
import sys
import zlib

TRACK = 0x1600  # 11 sectors x 512 bytes


def track_order(first, count):
    """ADF tracks the loaders actually read, starting from track number `first`.

    Both loaders (boot block $1B6/$300, game $6BA30/$6BBB4) select the head
    from bit 0 of their track counter, inverted: an even number selects
    head 1. The next-track routine toggles that bit and steps the drive only
    when it was 0. Simulating the drive, track number 2 reads ADF tracks
    3, 5, 4, 7, 6, 9 ...
    """
    cyl, head = first >> 1, 0 if first & 1 else 1
    order, w = [], first
    for _ in range(count):
        order.append(cyl * 2 + head)
        if w & 1:          # old bit 1: back to head 0, same cylinder
            head = 0
            w ^= 1
        else:              # old bit 0: head 1, step one cylinder
            head = 1
            cyl += 1
            w = (w ^ 1) + 2
    return order


def tracks(adf, first, count):
    return b"".join(adf[t * TRACK:(t + 1) * TRACK] for t in track_order(first, count))


def write_png(path, w, h, px, scale=1):
    """px: rows of (r, g, b) tuples."""
    rows = bytearray()
    for y in range(h * scale):
        rows.append(0)
        for x in range(w * scale):
            rows += bytes(px[y // scale][x // scale])

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w * scale, h * scale, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


def planar_to_png(mem, base, w, h, planes, pal_addr, path):
    plane_size = w // 8 * h
    pal = []
    for i in range(1 << planes):
        c = struct.unpack_from(">H", mem, pal_addr + i * 2)[0]
        pal.append(((c >> 8 & 15) * 17, (c >> 4 & 15) * 17, (c & 15) * 17))
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            byte, bit = (y * w + x) // 8, 7 - x % 8
            idx = 0
            for p in range(planes):
                idx |= (mem[base + p * plane_size + byte] >> bit & 1) << p
            rows += bytes(pal[idx])

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


def main():
    adf, out = open(sys.argv[1], "rb").read(), sys.argv[2]
    mem = bytearray(0x80000)
    # boot block: 6 tracks from track 2 -> $20000, 46 tracks from track 10 -> $3FFE0
    pic = tracks(adf, 2, 6)
    mem[0x20000:0x20000 + len(pic)] = pic
    game = tracks(adf, 10, 46)
    mem[0x3FFE0:0x3FFE0 + len(game)] = game[:0x80000 - 0x3FFE0]
    # the crack's patch over the original protection check
    mem[0x6ACB0:0x6ACB4] = bytes.fromhex("70004e75")
    open(out + "/chipmem.bin", "wb").write(mem)
    # copper list in the boot block: 4 bitplanes at $20000 + n*$1F40, palette at $27D00
    planar_to_png(mem, 0x20000, 320, 200, 4, 0x27D00, out + "/loading_screen.png")
    print("game image: $3FFE0-$%05X (%d bytes), entry $68488"
          % (0x3FFE0 + len(game), len(game)))


if __name__ == "__main__":
    main()
