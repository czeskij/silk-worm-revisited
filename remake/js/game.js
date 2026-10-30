// Silkworm revisited: game logic at the original 50 Hz.
// "From the disassembly" comments mark behaviour taken from the 68000 code;
// enemy behaviour lives in enemies.js.
"use strict";

SW.game = (function () {
  const { be16, bes16, be32 } = SW.adf;
  const I = SW.input, E = SW.enemies;
  const W = 320, H = 200;
  const LEVEL_LEN = 4704;          // wave clock = ground pixels scrolled
  const GROUND_Y = 0x98;           // jeep's ground level
  const SHOT_FLOOR = 0x9E;         // shots die here
  const SCRIPTS = 0x6EEA0, ROUTINE_BASE = 0x6D21E;

  let ctx, mem, sin, dirTable;
  let state = "title", level = 1, lv, scroll, clock, waves, waveIdx, scenery;
  let players, shots, enemies, booms, rng = 12345, frame = 0, banner = 0, endTimer = 0;
  let paused = false, pauseLatch = false, first = 1;
  let lastInputs = [0, 0], lastState = "", stateTimer = 0;
  const world = {};   // what enemies.js sees

  function rand(n) { rng = (rng * 1103515245 + 12345) >>> 0; return (rng >>> 8) % n; }

  function animAt(a) {   // animation list in memory: frame words up to the first negative
    const out = [];
    for (let i = 0; i < 16; i++) {
      const v = be16(mem, a + i * 2);
      if (v & 0x8000) break;
      if (!(v & 0x6000) && v < 400) out.push(v);
    }
    return out.length ? out : [0];
  }

  function init(canvas, firstLevel, startClock, invulnerable) {
    god = !!invulnerable;
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    mem = SW.gfx.mem;
    sin = SW.gfx.sine();
    // direction table $6F244: (dx, dy) for each direction byte 0..15
    dirTable = [];
    for (let i = 0; i < 16; i++) dirTable.push([bes16(mem, 0x6F244 + i * 4), bes16(mem, 0x6F246 + i * 4)]);
    players = [newHeli(), newJeep()];
    first = Math.min(11, Math.max(1, firstLevel || 1));
    startLevel(first);
    // ?t= (testing): start partway in; skipped waves don't spawn
    if (startClock > 0) {
      scroll = clock = Math.min(startClock, LEVEL_LEN);
      while (waveIdx < waves.length && waves[waveIdx].t < clock) waveIdx++;
    }
    state = "title";
  }

  // ---------------------------------------------------------------- level

  function startLevel(n) {
    level = n;
    lv = SW.gfx.loadLevel(n);
    scroll = 0; clock = 0; waveIdx = 0; banner = 150; endTimer = 0;
    waves = [];
    let p = be32(mem, SCRIPTS + (n - 1) * 4);
    while (bes16(mem, p) >= 0) {
      const a = bes16(mem, p + 2);
      waves.push({ t: bes16(mem, p), addr: (ROUTINE_BASE + Math.abs(a)).toString(16).toUpperCase() });
      p += 4;
    }
    scenery = { ptr: lv.sceneryPtr, delay: 0, objs: [] };
    shots = []; enemies = []; booms = [];
    Object.assign(world, { enemies, players, sin, rand, animAt, level: n, scrollDelta: 0, flash: 0,
                           stopScroll: 0, gameWon: false,
                           boom: (x, y, delay) => booms.push({ x, y, f: delay || 0 }) });
    E.attach(world);
    for (const pl of players) { pl.x = pl.startX; pl.y = pl.startY; pl.vy = 0; pl.inv = 100; }
  }

  // ---------------------------------------------------------------- players

  function newHeli() {
    return { kind: "heli", joined: false, startX: 0x40, startY: 0x40, x: 0x40, y: 0x40, vy: 0,
             lives: 3, score: 0, fireDelay: 0, rate: 10, tilt: 0, dead: 0, inv: 0, power: 0 };
  }
  function newJeep() {
    return { kind: "jeep", joined: false, startX: 0x40, startY: GROUND_Y, x: 0x40, y: GROUND_Y, vy: 0,
             lives: 3, score: 0, fireDelay: 0, rate: 10, angle: 1, angleDelay: 0, dead: 0, inv: 0, power: 0 };
  }

  function fire(x, y, angle, from) {
    // from the disassembly: speed $E00 = 14 px/frame, angle in 256 steps
    const s = 14 / 256;
    shots.push({ x, y, vx: sin[(angle + 64) & 255] * s, vy: sin[angle & 255] * s, from });
  }

  function updateHeli(p, input) {
    // from the disassembly ($6F148): 8 directions at 2x the table, bounds 30..300 / 24..122
    let d = input & 15;
    if (p.y < 0x18) d &= ~I.UP;
    if (p.y > 0x7a) d &= ~I.DOWN;
    if (p.x < 0x1e) d &= ~I.LEFT;
    if (p.x > 0x12c) d &= ~I.RIGHT;
    p.x += dirTable[d][0] * 2;
    p.y += dirTable[d][1] * 2;
    p.tilt = d & I.LEFT ? -1 : d & I.RIGHT ? 1 : 0;
    // fire: auto-repeat every `rate` frames; main shot right + 45 degree shot down
    if (input & I.FIRE) {
      if (--p.fireDelay < 0) {
        p.fireDelay = p.rate;
        fire(p.x + 8, p.y + 2, 0, p);
        if (p.power) fire(p.x + 8, p.y - 4, 0, p);           // power-up: second shot ($6F44A)
        fire(p.x + 3, p.y - 1, 32, p);
      }
    } else p.fireDelay = 0;
  }

  function updateJeep(p, input) {
    // from the disassembly ($6EFB8, $6F386): up without fire = jump,
    // fire + up/down = turn the gun (0..16) while on the ground
    if (!(input & I.FIRE) && (input & I.UP)) input = (input | I.JUMP) & ~(I.UP | I.DOWN);
    const onGround = p.y >= GROUND_Y;
    if (onGround && (input & (I.UP | I.DOWN))) {
      if (--p.angleDelay < 0) {
        p.angleDelay = 1;
        if (input & I.UP && p.angle < 16) { if (p.angle === 7) p.angleDelay += 8; p.angle++; }
        else if (input & I.DOWN && p.angle > 0) p.angle--;
      }
    } else p.angleDelay = 0;
    if (input & I.JUMP && onGround) p.vy = -3;            // $FFFD0000
    p.vy += 0.125;                                        // $2000 per frame
    p.y += p.vy;
    if (p.y > 0x99) { p.y = GROUND_Y; p.vy = 0; }
    let d = input & 15;
    if (p.x < 0x1e) d &= ~I.LEFT;
    if (p.x > 0x12c) d &= ~I.RIGHT;
    p.x += dirTable[d][0] * 2;
    if (input & I.FIRE) {
      if (--p.fireDelay < 0) {
        p.fireDelay = p.rate;
        fire(p.x - 8, p.y - 5, -p.angle * 8, p);
        if (p.power) fire(p.x - 8, p.y - 5, -(p.angle - 1) * 8, p);   // power-up ($6F3F6)
        if (p.y < 0x96) fire(p.x + 3, p.y - 1, 32, p);    // extra shot while airborne
      }
    } else p.fireDelay = 0;
  }

  function jeepSprite(p) {
    if (p.y < GROUND_Y) return p.vy < 0 ? 20 : 21;
    return 10 + ((p.angle + 1) >> 1);
  }
  function heliSprite(p) {
    const base = p.tilt < 0 ? 3 : p.tilt > 0 ? 1 : 0;
    return base + ((frame >> 1) & 1 ? 4 : 0);              // rotor: poses 0-3 / 4-7
  }
  const playerSprite = (p) => (p.kind === "heli" ? heliSprite(p) : jeepSprite(p));

  let god = false;   // ?god=1 (testing): players can't be hit
  function killPlayer(p) {
    if (god || p.dead || p.inv > 0) return;
    booms.push({ x: p.x, y: p.y, f: 0 });
    p.dead = 1; p.lives--; p.power = 0;
  }

  // ---------------------------------------------------------------- scenery

  function stepScenery() {
    // from the disassembly (sub_69D52): one slot per 32 px, negative = skip
    if (--scenery.delay >= 0) return;
    const w = bes16(mem, scenery.ptr);
    scenery.ptr += 2;
    if (w < 0) scenery.delay = -w - 1;
    else if (w) scenery.objs.push({ wx: scroll + 0x150, spr: w });
  }

  // ---------------------------------------------------------------- collisions

  // Boxes in object coordinates (sprites are drawn 15 px higher, like sub_712AA).
  function spriteBox(i, x, y) {
    const s = SW.gfx.sprite(i);
    if (!s) return { l: x - 8, r: x + 8, t: y - 8, b: y + 8 };
    const l = x - s.hx, t = y - s.hy;
    return { l: l + 3, r: l + s.w - 3, t: t + 2, b: t + s.h - 2 };
  }
  function enemyBox(e) {
    if (e.hw && e.hh) return { l: e.x - e.hw, r: e.x + e.hw, t: e.y - e.hh, b: e.y + e.hh };
    if (e.spr < 0 || e.spr >= 400) return { l: e.x - 4, r: e.x + 4, t: e.y - 4, b: e.y + 4 };
    const b = spriteBox(e.spr, e.x, e.y);
    if (e.hh) { b.t = e.y - e.hh; b.b = e.y + e.hh; }
    return b;
  }
  const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  function destroy(e, shooter) {
    if (shooter) shooter.score += e.score * 100;
    booms.push({ x: e.x, y: e.y, f: 0 });
    if (e.kind === "boss") for (let k = 0; k < 6; k++) booms.push({ x: e.x + rand(40) - 20, y: e.y + rand(30) - 15, f: -k * 5 });
    if (e.onDeath) e.onDeath(e);
    if (e.wreck != null) {
      // $6FA58: becomes a wreck that keeps moving with the ground
      e.kind = "wreck"; e.shootable = false; e.touchKills = false; e.turret = null;
      e.vx = e.ax = e.ay = e.vy = 0; e.ground = true;
      E.setAnim(e, [e.wreck], 2, true);
      e.script = (function* (o) {
        while (o.x > -64) { o.x -= world.scrollDelta; yield; }
      })(e);
    } else e.alive = false;
  }

  // ---------------------------------------------------------------- frame

  function step() {
    frame++;
    const pauseKey = I.pressed("KeyP") || I.pressed("Escape") || I.anyPadButton(9);
    if (pauseKey && !pauseLatch && state === "play") paused = !paused;
    pauseLatch = pauseKey;
    if (paused) return;

    const inputs = players.map((p, i) => I.read(i));
    const fresh = inputs.map((v, i) => (v & I.FIRE) && !(lastInputs[i] & I.FIRE));
    lastInputs = inputs;
    if (state !== lastState) { lastState = state; stateTimer = 0; }
    stateTimer++;
    if (state === "title" || state === "over" || state === "end") {
      // after the end/game over, wait a second and want a new press of fire
      if (state !== "title" && stateTimer < 50) return;
      players.forEach((p, i) => {
        if (state === "title" ? inputs[i] & I.FIRE : fresh[i]) {
          if (state !== "title") { players = [newHeli(), newJeep()]; startLevel(first); }
          players[i].joined = true; state = "play";
        }
      });
      return;
    }

    // late joiners
    players.forEach((p, i) => { if (!p.joined && inputs[i] & I.FIRE && p.lives > 0) { p.joined = true; p.inv = 100; } });

    const lastT = waves.length ? waves[waves.length - 1].t : LEVEL_LEN;
    // a boss sets -$7E76 (1 = fighting, 2 = destroyed): either stops the scroll
    const scrolling = !world.stopScroll && clock < lastT + 400;
    world.scrollDelta = scrolling ? 1 : 0;
    world.players = players;
    if (scrolling) {
      scroll++; clock++;
      if (scroll % 32 === 0) stepScenery();
    }
    while (waveIdx < waves.length && waves[waveIdx].t <= clock) E.wave(waves[waveIdx++].addr);

    players.forEach((p, i) => {
      if (!p.joined) return;
      if (p.dead) {
        if (++p.dead > 90) {
          if (p.lives > 0) { p.dead = 0; p.inv = 120; p.x = p.startX; p.y = p.startY; p.vy = 0; }
          else p.joined = false;
        }
        return;
      }
      if (p.inv > 0) p.inv--;
      if (p.kind === "heli") updateHeli(p, inputs[i]); else updateJeep(p, inputs[i]);
    });

    shots = shots.filter((s) => {
      s.x += s.vx; s.y += s.vy;
      return s.y < SHOT_FLOOR && s.x > -16 && s.x < 336 && s.y > -16;
    });

    // run every enemy task one frame (new ones spawned this frame run next frame)
    for (const e of enemies.slice()) {
      if (!e.alive) continue;
      if (e.script.next().done) e.alive = false;
    }

    // player shots vs enemies
    for (const e of enemies) {
      if (!e.alive || !e.shootable) continue;
      const eb = enemyBox(e);
      const tb = e.turret ? { l: e.x - 8, r: e.x + 8, t: 0x82 - 8, b: 0x82 + 4 } : null;
      for (const s of shots) {
        if (s.dead) continue;
        const sb = { l: s.x - 2, r: s.x + 2, t: s.y - 2, b: s.y + 2 };
        if (!hit(eb, sb) && !(tb && hit(tb, sb))) continue;
        s.dead = true;
        e.hp--;
        if (e.kind === "boss") e.blink = 3;                   // $6F8E0: flash on each hit
        if (e.onHit) e.onHit(e);
        if (e.hp <= 0) { destroy(e, s.from); break; }
      }
    }
    shots = shots.filter((s) => !s.dead);

    // enemies and their shots vs players
    for (const p of players) {
      if (!p.joined || p.dead) continue;
      const pb = spriteBox(playerSprite(p), p.x, p.y);
      for (const e of enemies) {
        if (!e.alive || e.hidden || e.kind === "controller" || e.kind === "wreck") continue;
        if (!hit(pb, enemyBox(e))) continue;
        if (e.kind === "powerup") {
          e.alive = false; p.power = 1; p.inv = Math.max(p.inv, 500); p.score += 1000;
        } else if (e.touchKills) {
          killPlayer(p);
          if (e.kind === "shot" || e.kind === "missile" || e.kind === "bomb") e.alive = false;
        }
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);
    booms = booms.filter((b) => ++b.f < 40);
    if (world.flash > 0) world.flash--;

    if (banner > 0) banner--;
    if (!players.some((p) => p.joined || p.dead)) { state = "over"; return; }
    const bossBeaten = world.stopScroll === 2;
    const noBoss = !world.stopScroll && clock >= lastT && waveIdx >= waves.length;
    if (bossBeaten || noBoss) {
      if (++endTimer > 200) {
        if (world.gameWon || level >= 11) state = "end";
        else startLevel(level + 1);
      }
    }
  }

  // ---------------------------------------------------------------- draw

  function drawSprite(i, x, y) {
    const s = SW.gfx.sprite(i);
    if (s) ctx.drawImage(s.cv, Math.round(x - s.hx), Math.round(y - 15 - s.hy));
  }

  function text(str, x, y, colour, align) {
    ctx.font = "8px monospace";
    ctx.textAlign = align || "left";
    ctx.fillStyle = "#000"; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = colour || "#fff"; ctx.fillText(str, x, y);
  }

  function drawEnemy(e) {
    if (e.kind === "controller" || e.hidden) return;
    if (e.blink > 0) { e.blink--; if (frame & 1) return; }
    if (e.kind === "shot") {
      ctx.fillStyle = "#ff5040";
      ctx.fillRect(Math.round(e.x) - 1, Math.round(e.y) - 16, 3, 3);
      return;
    }
    if (e.kind === "missile") {   // hardware sprite $210+: drawn as a line along its heading
      const a = (e.angle || 0) * Math.PI / 128, x = e.x, y = e.y - 15;
      ctx.strokeStyle = "#ffd0a0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 4, y - Math.sin(a) * 4); ctx.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); ctx.stroke();
      ctx.fillStyle = "#ff8030"; ctx.fillRect(Math.round(x - Math.cos(a) * 5) - 1, Math.round(y - Math.sin(a) * 5) - 1, 2, 2);
      return;
    }
    if (e.turret) drawSprite(e.turret, e.x, 0x82);
    if (e.spr >= 0 && e.spr < 400) drawSprite(e.spr, e.x, e.y);
  }

  function draw() {
    const [r, g, b] = lv.sky;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, W, H);

    // backdrop at half speed, ground at full speed (from the disassembly)
    const back = scroll >> 1, cols = SW.gfx.backCols;
    for (let i = back >> 4; i <= (back >> 4) + 21; i++)
      ctx.drawImage(cols[lv.backStream[i % lv.backStream.length] % 20], i * 16 - back, 0);
    for (let i = scroll >> 4; i <= (scroll >> 4) + 21; i++)
      ctx.drawImage(SW.gfx.ground(lv.groundStream[i % lv.groundStream.length]), i * 16 - scroll, 144);

    scenery.objs = scenery.objs.filter((o) => o.wx - scroll > -64);
    for (const o of scenery.objs) drawSprite(o.spr, o.wx - scroll, 0x90);

    for (const e of enemies) if (e.ground && e.kind !== "missile") drawEnemy(e);
    for (const p of players) {
      if (!p.joined || p.dead || (p.inv > 0 && frame & 4)) continue;
      drawSprite(playerSprite(p), p.x, p.y);
    }
    for (const e of enemies) if (!e.ground || e.kind === "missile") drawEnemy(e);

    ctx.fillStyle = "#ffe066";
    for (const s of shots) ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 16, 4, 2);
    for (const bm of booms) if (bm.f >= 0) drawSprite(E.EXPLOSION[Math.min(4, bm.f >> 3)], bm.x, bm.y);
    if (world.flash > 0) { ctx.fillStyle = `rgba(255,255,220,${world.flash / 40})`; ctx.fillRect(0, 0, W, 168); }

    // HUD
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 168, W, 32);
    players.forEach((p, i) => {
      const x = i ? 316 : 4, al = i ? "right" : "left";
      const name = p.kind === "heli" ? "HELI" : "JEEP";
      if (p.joined || p.dead) {
        text(`${name}  ${String(p.score).padStart(7, "0")}`, x, 180, i ? "#9fe0ff" : "#ffd27f", al);
        text("♥".repeat(Math.max(0, p.lives)) + (p.power ? "  ★" : ""), x, 192, "#ff7070", al);
      } else if (p.lives > 0) {
        text(`${name}: PRESS FIRE`, x, 186, frame & 32 ? "#888" : "#ccc", al);
      }
    });
    text(`LEVEL ${level}`, 160, 186, "#fff", "center");
    const boss = enemies.find((e) => e.kind === "boss");
    if (boss) {
      ctx.fillStyle = "#400"; ctx.fillRect(110, 192, 100, 4);
      ctx.fillStyle = "#f44"; ctx.fillRect(110, 192, 100 * boss.hp / boss.maxHp, 4);
    }

    if (state === "title") {
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 30, W, 100);
      text("SILKWORM REVISITED", 160, 52, "#ffe066", "center");
      text("HELI: arrows + Space  /  pad 1", 160, 72, "#ffd27f", "center");
      text("JEEP: WASD + Shift, Q jump  /  pad 2", 160, 84, "#9fe0ff", "center");
      text("Jeep: up = jump, fire+up/down = aim", 160, 96, "#ccc", "center");
      text("Press FIRE to join  P pause  double-click fullscreen", 160, 116, frame & 32 ? "#fff" : "#aaa", "center");
    } else if (state === "over") {
      text("GAME OVER", 160, 80, "#ff7070", "center");
      text("Press FIRE to play again", 160, 96, "#fff", "center");
    } else if (state === "end") {
      text("WELL DONE!", 160, 80, "#ffe066", "center");
      text("Press FIRE to play again", 160, 96, "#fff", "center");
    } else if (banner > 0) {
      text(`LEVEL ${level}`, 160, 70, "#ffe066", "center");
    }
    if (paused) text("PAUSED", 160, 80, "#fff", "center");
  }

  // debugging: counts of waves by whether their behaviour is decoded
  function stats() {
    let d = 0;
    for (const w of waves) if (E.decoded(w.addr)) d++;
    const b = enemies.find((e) => e.kind === "boss");
    return { level, waves: waves.length, decoded: d, enemies: enemies.length, clock, state,
             stopScroll: world.stopScroll,
             players: players.map((p) => ({ kind: p.kind, joined: p.joined, x: Math.round(p.x), y: Math.round(p.y), dead: p.dead, lives: p.lives })),
             boss: b && { x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, spr: b.spr, shootable: b.shootable } };
  }

  return { init, step, draw, stats, W, H };
})();
