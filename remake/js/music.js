// The title music, rendered the way the game's player at $71666 plays it.
//
// Bank at $71D74: long 0 -> table of song headers, long 4 -> table of
// sample lists (offsets from the bank). A song header is a 15-instrument
// SoundTracker header (title, 15 x 30-byte instruments, length at +$1D6,
// order at +$1D8, 64-row patterns from +$258); the samples live wherever
// the list says. Only song 0 is ever played (menu and story screens).
//
// Player rules ($71758 every 50 Hz frame):
//   row every `speed` frames (default 6, F sets it); a note restarts the
//   sample; an instrument sets sample, length and volume (if it has a
//   repeat start, playback starts there and plays only the loop - the old
//   SoundTracker way); C sets the volume, E starts a continuous volume slide.
//   Between rows: 1/6/7/8 slide pitch up (to period $71), 2/9/A/B down
//   (to $358), D slides volume, 0/3/4/5 arpeggio over frames 1-5.
"use strict";

(function (root) {
  const BANK = 0x71D74, ARP_TABLE = 0x71D12, PAL_CLOCK = 3546895;
  const be16 = (m, a) => (m[a] << 8) | m[a + 1];
  const be32 = (m, a) => ((m[a] << 24) | (m[a + 1] << 16) | (m[a + 2] << 8) | m[a + 3]) >>> 0;

  function load(mem, song) {
    const h = BANK + be32(mem, BANK + be32(mem, BANK) + song * 4);
    const list = BANK + be32(mem, BANK + be32(mem, BANK + 4) + song * 4);
    const samples = [null];
    for (let a = list; be32(mem, a) !== 0xffffffff && samples.length < 16; a += 4) samples.push(BANK + be32(mem, a));
    const inst = [null];
    for (let i = 1; i <= 15; i++) {
      const o = h + 20 + (i - 1) * 30 + 22;
      inst.push({ ptr: samples[i] || 0, len: be16(mem, o) * 2, vol: be16(mem, o + 2), rep: be16(mem, o + 4), replen: be16(mem, o + 6) * 2 });
    }
    const songLen = mem[h + 0x1d6], order = Array.from(mem.subarray(h + 0x1d8, h + 0x1d8 + 128));
    const arp = [];
    for (let i = 0; i < 64; i++) { const p = be16(mem, ARP_TABLE + i * 2); arp.push(p); if (!p) break; }
    return { h, inst, songLen, order, arp };
  }

  // Render one pass of the song: returns { left, right, rate } (Float32Arrays).
  function render(mem, song, rate) {
    rate = rate || 44100;
    const s = load(mem, song);
    const sample = (a) => ((mem[a] << 24) >> 24) / 128;
    const ch = [0, 1, 2, 3].map(() => ({
      period: 0, base: 0, vol: 0, hwVol: 0, start: 0, len: 0, loop: 0, loopLen: 0, pos: -1,
      cmd: 0, param: 0, eSlide: 0,
    }));
    let speed = 6, tick = 0, pos = 0, row = 0;
    const perFrame = rate / 50;
    let leftover = 0;
    const L = [], R = [];

    function arp(c, semis) {
      const i = s.arp.indexOf(c.base);
      if (i < 0) return c.base;
      return s.arp[i + semis] || c.base;
    }

    function doRow() {
      const p = s.h + 0x258 + s.order[pos] * 1024 + row * 16;
      for (let k = 0; k < 4; k++) {
        const c = ch[k], a = p + k * 4;
        const period = be16(mem, a) & 0x0fff, b2 = mem[a + 2], b3 = mem[a + 3];
        const ins = b2 >> 4;
        c.cmd = b2 & 15; c.param = b3;
        if (ins && s.inst[ins]) {
          const n = s.inst[ins];
          if (n.rep) { c.start = n.ptr + n.rep; c.len = n.replen; c.loop = n.ptr + n.rep; c.loopLen = n.replen; }
          else { c.start = n.ptr; c.len = n.len; c.loop = n.ptr; c.loopLen = n.replen; }
          c.vol = c.hwVol = n.vol;
        }
        if (period) { c.base = c.period = period; c.pos = 0; c.inLoop = false; }
        if (c.cmd === 0xe) { c.eSlide = b3 | 0x100; continue; }   // slide stays on until a row clears it
        if (!b3) c.eSlide = 0;
        if (c.cmd === 0xf) { if (b3 & 15) { speed = b3 & 15; } }
        else if (c.cmd === 0xc) c.hwVol = Math.min(64, b3);
      }
      row++;
      if (row >= 64) { row = 0; pos++; if (pos >= s.songLen) pos = 0; }
    }

    function doEffects() {
      for (const c of ch) {
        if (c.eSlide) {
          const x = c.eSlide & 0xff;
          if (x >> 4) c.vol = Math.min(64, c.vol + (x >> 4)); else c.vol = Math.max(0, c.vol - (x & 15));
          c.hwVol = c.vol;
        }
        const q = c.cmd, x = c.param;
        if (q === 1 || (q >= 6 && q <= 8)) { c.period = Math.max(0x71, c.period - x); }
        else if (q === 2 || (q >= 9 && q <= 0xb)) { c.period = Math.min(0x358, c.period + x); }
        else if (q === 0xd) {
          if (x >> 4) c.vol = Math.min(64, c.vol + (x >> 4)); else c.vol = Math.max(0, c.vol - (x & 15));
          c.hwVol = c.vol;
        } else if (q === 0 || (q >= 3 && q <= 5)) {
          if (tick === 1 || tick === 4) c.period = arp(c, x >> 4);
          else if (tick === 2 || tick === 5) c.period = arp(c, x & 15);
          else if (tick === 3) c.period = c.base;
        }
      }
    }

    // one pass: until the order wraps back to 0
    let started = false, guard = 0;
    while (guard++ < 50 * 60 * 10) {
      if (tick === 0) {
        if (started && pos === 0 && row === 0) break;
        started = true;
        doRow();
      } else doEffects();
      // mix this frame
      const n = perFrame + leftover;
      const count = Math.floor(n); leftover = n - count;
      for (let i = 0; i < count; i++) {
        let l = 0, r = 0;
        for (let k = 0; k < 4; k++) {
          const c = ch[k];
          if (c.pos < 0 || !c.period) continue;
          let v = 0;
          const idx = Math.floor(c.pos);
          if (!c.inLoop) {
            if (idx < c.len) v = sample(c.start + idx);
            else { c.inLoop = true; c.pos = 0; continue; }
          } else {
            if (c.loopLen <= 2) { c.pos = -1; continue; }
            v = sample(c.loop + (idx % c.loopLen));
          }
          v *= c.hwVol / 64;
          if (k === 0 || k === 3) l += v; else r += v;   // Paula: 0/3 left, 1/2 right
          c.pos += (PAL_CLOCK / c.period) / rate;
        }
        // soften the hard Amiga panning a little
        L.push((l * 0.75 + r * 0.25) * 0.5);
        R.push((r * 0.75 + l * 0.25) * 0.5);
      }
      tick++;
      if (tick >= speed) tick = 0;
    }
    return { left: Float32Array.from(L), right: Float32Array.from(R), rate };
  }

  // Browser side: render once, loop it.
  let ctx = null, buffer = null, source = null, gain = null, memory = null, wanted = false;
  function init(mem) { memory = mem; }
  function ensure(audioCtx) {
    if (buffer || !memory) return;
    ctx = audioCtx;
    const r = render(memory, 0, ctx.sampleRate);
    buffer = ctx.createBuffer(2, r.left.length, r.rate);
    buffer.getChannelData(0).set(r.left);
    buffer.getChannelData(1).set(r.right);
    gain = ctx.createGain(); gain.gain.value = 0.8; gain.connect(ctx.destination);
  }
  function play(audioCtx) {
    wanted = true;
    if (!audioCtx) return;
    ensure(audioCtx);
    if (source || !buffer) return;
    source = ctx.createBufferSource();
    source.buffer = buffer; source.loop = true;
    source.connect(gain); source.start();
  }
  function stop() {
    wanted = false;
    if (source) { try { source.stop(); } catch (e) { /* ended */ } source = null; }
  }

  const api = { load, render, init, play, stop, get wanted() { return wanted; }, get playing() { return !!source; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.SW = root.SW || {}; root.SW.music = api; }
})(typeof window !== "undefined" ? window : this);
