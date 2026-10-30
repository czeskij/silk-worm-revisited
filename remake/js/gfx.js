// Turn Silkworm's planar graphics into canvases for one level at a time.
"use strict";

SW.gfx = (function () {
  const { be16, bes16, be32, tracks } = SW.adf;
  const SPRITE_PTRS = 0x4A498, SPRITE_REC_BIAS = 0x5F3B8, SPRITE_PIX = 0x4AAD8;
  const PALETTES = 0x67732, LEVEL_TRACKS = 0x6B924, LEVEL_PTRS = 0x69E3C;
  const GROUND_BANK = 0x62272;

  const HW_BANK = 0x61132, HW_COUNT = 69;   // hardware sprites $200-$244 (loc_714AA)
  let mem, adf, level, palette, spriteCache, backCols, groundCache, hwPalette, hwCache;
  const spriteData = [];   // decoded colour indices, palette-independent

  function init(adfBytes, memory) {
    adf = adfBytes; mem = memory;
    for (let i = 0; i < 400; i++) spriteData[i] = decodeSprite(i);
  }

  function decodeSprite(idx) {
    const rec = (be32(mem, SPRITE_PTRS + idx * 4) + SPRITE_REC_BIAS) >>> 0;
    if (rec + 0x12 > mem.length) return null;
    const words = be16(mem, rec), rows = be16(mem, rec + 2);
    const off = be32(mem, rec + 0xE) + SPRITE_PIX;
    if (words < 1 || words > 8 || rows < 1 || rows > 200 || off + rows * words * 8 > mem.length) return null;
    const w = words * 16, px = new Uint8Array(w * rows);
    for (let y = 0; y < rows; y++) {
      const base = off + y * words * 8;
      for (let x = 0; x < w; x++) {
        const word = x >> 4, bit = 15 - (x & 15);
        let c = 0;
        for (let p = 0; p < 4; p++) c |= ((be16(mem, base + (p * words + word) * 2) >> bit) & 1) << p;
        px[y * w + x] = c;
      }
    }
    return { w, h: rows, hx: bes16(mem, rec + 6), hy: bes16(mem, rec + 8), px };
  }

  function amigaColour(c) {
    return [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17];
  }

  function toCanvas(w, h, idx, transparent0) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const c = idx[i];
      if (transparent0 && c === 0) continue;
      const rgb = palette[c];
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Byte stream of column numbers, stopping at the first negative byte (the loop marker).
  function byteStream(a) {
    const out = [];
    while (mem[a] < 0x80 && out.length < 5000) out.push(mem[a++]);
    return out.length ? out : [0];
  }

  function loadLevel(n) {
    level = n;
    palette = [];
    for (let i = 0; i < 16; i++) palette.push(amigaColour(be16(mem, PALETTES + n * 64 + i * 2)));
    spriteCache = new Map();
    groundCache = new Map();
    // hardware sprites use colours 16-19 of the level palette (same in every level)
    hwPalette = [];
    for (let i = 16; i < 20; i++) hwPalette.push(amigaColour(be16(mem, PALETTES + n * 64 + i * 2)));
    hwCache = new Map();

    // backdrop: 20 columns of 9 cells (16x16, 4 bitplanes interleaved per row)
    const block = tracks(adf, be16(mem, LEVEL_TRACKS + n * 2), 4);
    backCols = [];
    for (let col = 0; col < 20; col++) {
      const idx = new Uint8Array(16 * 144);
      for (let cell = 0; cell < 9; cell++) {
        const off = be16(block, col * 18 + cell * 2);
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) {
            let c = 0;
            for (let p = 0; p < 4; p++) c |= ((be16(block, off + y * 8 + p * 2) >> (15 - x)) & 1) << p;
            idx[(cell * 16 + y) * 16 + x] = c;
          }
      }
      backCols.push(toCanvas(16, 144, idx, false));
    }
    const ptr = LEVEL_PTRS + n * 12;
    return {
      backStream: byteStream(be32(mem, ptr)),
      groundStream: byteStream(be32(mem, ptr + 4)),
      sceneryPtr: be32(mem, ptr + 8),
      sky: palette[0],
    };
  }

  function ground(n) {
    let cv = groundCache.get(n);
    if (!cv) {
      const idx = new Uint8Array(16 * 24), base = GROUND_BANK + n * 0xC0;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 16; x++) {
          let c = 0;
          for (let p = 0; p < 4; p++) c |= ((be16(mem, base + y * 8 + p * 2) >> (15 - x)) & 1) << p;
          idx[y * 16 + x] = c;
        }
      cv = toCanvas(16, 24, idx, false);
      groundCache.set(n, cv);
    }
    return cv;
  }

  // Sprite canvas plus hotspot. Draw at (x - hx, y - 15 - hy) like sub_712AA.
  function sprite(i) {
    let s = spriteCache.get(i);
    if (s === undefined) {
      const d = spriteData[i];
      s = d ? { cv: toCanvas(d.w, d.h, d.px, true), w: d.w, h: d.h, hx: d.hx, hy: d.hy } : null;
      spriteCache.set(i, s);
    }
    return s;
  }

  // Hardware sprite n ($200 + n): 16 lines of two words, 2 bitplanes.
  function hw(n) {
    if (n < 0 || n >= HW_COUNT) return null;
    let cv = hwCache.get(n);
    if (!cv) {
      cv = document.createElement("canvas");
      cv.width = 16; cv.height = 16;
      const ctx = cv.getContext("2d"), img = ctx.createImageData(16, 16);
      for (let y = 0; y < 16; y++) {
        const a = be16(mem, HW_BANK + n * 64 + y * 4), b = be16(mem, HW_BANK + n * 64 + y * 4 + 2);
        for (let x = 0; x < 16; x++) {
          const c = ((a >> (15 - x)) & 1) | (((b >> (15 - x)) & 1) << 1);
          if (!c) continue;
          const rgb = hwPalette[c], i = (y * 16 + x) * 4;
          img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      hwCache.set(n, cv);
    }
    return cv;
  }

  function sine() {   // 256-step sine table at $6D01E, 8.8 fixed point
    const t = [];
    for (let i = 0; i < 256; i++) t.push(bes16(mem, 0x6D01E + i * 2));
    return t;
  }

  return { init, loadLevel, ground, sprite, hw, sine, get backCols() { return backCols; }, get mem() { return mem; } };
})();
