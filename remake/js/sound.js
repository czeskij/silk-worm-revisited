// Sound effects as sub_6B1E0 plays them: 7 samples from the table at $6B1A8
// (address, length in bytes, loop offset; -1 = play once), 4 Paula channels
// where a new sound cuts the old one, volume 0-64. The "period" the game passes
// is an index into the pitch table at $6B306 (785 entries): the frame routine
// sub_6B2C2 writes table[index] to AUDxPER, so rate = PAL clock / table[index].
"use strict";

SW.sound = (function () {
  const TABLE = 0x6B1A8, COUNT = 7, PAL_CLOCK = 3546895, PITCH = 0x6B306, PITCHES = 785;
  let ctx = null, master = null, buffers = [], mem = null, enabled = true, pitch = [];
  const channels = [null, null, null, null];

  function init(memory) {
    mem = memory;
    pitch = [];
    for (let i = 0; i < PITCHES; i++) pitch.push(SW.adf.be16(mem, PITCH + i * 2));
  }

  // Browsers only allow audio after a user gesture: called on key/pad input.
  function unlock() {
    if (ctx || !mem) { if (ctx && ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    for (let i = 0; i < COUNT; i++) {
      const a = SW.adf.be32(mem, TABLE + i * 8), len = SW.adf.be16(mem, TABLE + i * 8 + 4);
      // stored at 8000 Hz nominal; the real rate is set per play from the period
      const buf = ctx.createBuffer(1, len, 8000), data = buf.getChannelData(0);
      for (let j = 0; j < len; j++) data[j] = ((mem[a + j] << 24) >> 24) / 128;   // signed 8-bit
      buffers.push(buf);
    }
  }

  function play(sample, index, volume, channel) {
    if (!ctx || !enabled || !buffers[sample]) return;
    const ch = channel & 3;
    if (channels[ch]) { try { channels[ch].stop(); } catch (e) { /* already ended */ } }
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffers[sample];
    const period = pitch[Math.max(0, Math.min(PITCHES - 1, index))];
    src.playbackRate.value = (PAL_CLOCK / period) / 8000;
    gain.gain.value = Math.min(64, volume) / 64;
    // Paula: channels 0 and 3 left, 1 and 2 right (softened, as in music.js)
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = ch === 0 || ch === 3 ? -0.5 : 0.5; src.connect(gain).connect(pan).connect(master); }
    else src.connect(gain).connect(master);
    src.onended = () => { if (channels[ch] === src) channels[ch] = null; };
    src.start();
    channels[ch] = src;
  }

  // The game's own calls (addresses of the sub_6B1E0 call sites)
  const fx = {
    shot: () => play(6, 0x180, 0x20, 0),                          // loc_6F472: player shot fired
    hit: () => play(1, 0x200, 0x40, 2),                           // $6F4DE: shot hit, target survives
    explode: (pitch) => {                                         // sub_6F9E4: enemy destroyed
      const p = 0x140 + Math.floor(Math.random() * 32) + (pitch || 0);
      play(0, p, 0x40, 1); play(0, p, 0x40, 2);
    },
    playerDeath: () => { [0xc0, 0xc4, 0xc8, 0xcc].forEach((p, c) => play(0, p, 0x40, c)); },   // $6F584
    smartBomb: () => { [0xc0, 0xc4, 0xc8, 0xcc].forEach((p, c) => play(4, p, 0x40, c)); },     // $6F6DA
    bossHit: () => { play(5, 0x1e0, 0x40, 2); play(5, 0x1e4, 0x40, 3); },                       // $6F8E0
    finalBossHit: () => { play(5, 0xc0, 0x40, 2); play(5, 0xc4, 0x40, 3); },                    // $6E224
    carrierHit: () => { play(5, 0x240, 0x40, 2); play(5, 0x244, 0x40, 3); },                    // $6FF54
    reward: () => play(2, 0x2c0, 0x40, 3),                        // sub_6E3A8: icon collected
    launch: () => play(3, 0x200, 0x40, 3),                        // loc_707C0: missile/shell launched
    rumble: () => {                                               // sub_703AA: the final boss's end
      rumbleSide = !rumbleSide;                                   // alternates channels 0+1 / 2+3
      const c = rumbleSide ? 0 : 2;
      play(0, Math.floor(Math.random() * 32), 0x40, c); play(0, Math.floor(Math.random() * 32), 0x40, c + 1);
    },
  };
  let rumbleSide = false;

  return { init, unlock, play, fx, toggle() { enabled = !enabled; return enabled; }, get enabled() { return enabled; }, get context() { return ctx; } };
})();
