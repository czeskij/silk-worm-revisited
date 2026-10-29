// Silkworm revisited: game logic at the original 50 Hz.
// "From the disassembly" comments mark behaviour taken from the 68000 code;
// everything else (enemy movement, hit points, scoring) is approximated
// until those routines are decoded.
"use strict";

SW.game = (function () {
  const { be16, bes16, be32 } = SW.adf;
  const I = SW.input;
  const W = 320, H = 200;
  const LEVEL_LEN = 4704;          // wave clock = ground pixels scrolled
  const GROUND_Y = 0x98;           // jeep's ground level
  const SHOT_FLOOR = 0x9E;         // shots die here
  const SCRIPTS = 0x6EEA0, ROUTINE_BASE = 0x6D21E;
  const BOSSES = new Set(["705D0", "6DB1E", "70512"]);
  const EXPLOSION = [320, 321, 322, 323, 324];

  let ctx, mem, sin, dirTable;
  let state = "title", level = 1, lv, scroll, clock, waves, waveIdx, scenery;
  let players, shots, enemies, enemyShots, booms, rng = 12345, frame = 0, banner = 0, endTimer = 0;
  let paused = false, pauseLatch = false;

  function rand(n) { rng = (rng * 1103515245 + 12345) >>> 0; return (rng >>> 8) % n; }

  function init(canvas, firstLevel, startClock) {
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
  let first = 1;

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
    shots = []; enemies = []; enemyShots = []; booms = [];
    for (const pl of players) { pl.x = pl.startX; pl.y = pl.startY; pl.vy = 0; pl.inv = 100; }
  }

  // ---------------------------------------------------------------- players

  function newHeli() {
    return { kind: "heli", joined: false, startX: 0x40, startY: 0x40, x: 0x40, y: 0x40, vy: 0,
             lives: 3, score: 0, fireDelay: 0, rate: 10, tilt: 0, dead: 0, inv: 0, w: 28, h: 10 };
  }
  function newJeep() {
    return { kind: "jeep", joined: false, startX: 0x40, startY: GROUND_Y, x: 0x40, y: GROUND_Y, vy: 0,
             lives: 3, score: 0, fireDelay: 0, rate: 10, angle: 1, angleDelay: 0, dead: 0, inv: 0, w: 28, h: 12 };
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
        fire(p.x + 3, p.y - 1, 32, p);
      }
    } else p.fireDelay = 0;
  }

  function updateJeep(p, input) {
    // from the disassembly ($6EFB8, $6F386): up without fire = jump,
    // fire + up/down = turn the gun (1..16) while on the ground
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

  function killPlayer(p) {
    if (p.dead || p.inv > 0) return;
    booms.push({ x: p.x, y: p.y, f: 0 });
    p.dead = 1; p.lives--;
  }

  // ---------------------------------------------------------------- enemies

  function hint(addr) {
    const h = HINTS[addr];
    if (!h) return null;
    let frames = h.frames[level];
    if (!frames) { const any = Object.values(h.frames)[0]; frames = any || null; }
    return { ...h, frames };
  }

  function spawnWave(w) {
    const h = hint(w.addr);
    if (!h || !h.frames) return;
    if (BOSSES.has(w.addr)) {
      enemies.push({ boss: true, x: 380, y: 70, vx: -1, vy: 0, frames: h.frames, hp: 60, maxHp: 60, t: 0, score: 5000 });
      return;
    }
    const ground = h.y !== null && h.y >= 0x78;
    for (let i = 0; i < Math.min(h.count, 16); i++) {
      if (ground) {
        enemies.push({ ground: true, x: (h.x || 336) + i * 40, y: h.y, vx: -0.5, vy: 0, frames: h.frames,
                       hp: 3, t: -i * 30, score: 300 });
      } else {
        // like $6E5AA: come in from the side away from the players
        const fromLeft = avgPlayerX() > 0xa0;
        enemies.push({ x: fromLeft ? -20 - i * 24 : 340 + i * 24, y: 32 + rand(80),
                       vx: (fromLeft ? 1 : -1) * (1.5 + rand(10) / 10), vy: 0, frames: h.frames,
                       hp: 1, t: rand(64), score: 100, wob: 0.5 + rand(10) / 10 });
      }
    }
  }

  function avgPlayerX() {
    const live = players.filter((p) => p.joined && !p.dead);
    return live.length ? live.reduce((s, p) => s + p.x, 0) / live.length : 160;
  }
  function nearestPlayer(x, y) {
    let best = null, bd = 1e9;
    for (const p of players) {
      if (!p.joined || p.dead) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function enemyFire(e, speed) {
    const p = nearestPlayer(e.x, e.y);
    if (!p) return;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    enemyShots.push({ x: e.x, y: e.y, vx: dx / d * speed, vy: dy / d * speed });
  }

  function updateEnemy(e, scrolling) {
    e.t++;
    if (e.boss) {
      if (e.x > 250) e.x += e.vx; else e.y = 70 + Math.sin(e.t / 40) * 35;
      if (e.t % 50 === 0) for (let k = -1; k <= 1; k++) {
        enemyFire(e, 2.2);
        const s = enemyShots[enemyShots.length - 1];
        if (s) { s.vy += k * 0.6; }
      }
      return true;
    }
    if (e.ground) {
      if (e.t < 0) return true;
      // units placed above the road drop onto it (approximation)
      if (e.y < 0x9A) { e.vy += 0.15; e.y = Math.min(0x9A, e.y + e.vy); }
      e.x += e.vx - (scrolling ? 1 : 0);
      if (e.t % 90 === 45 && e.x < 320) enemyFire(e, 1.6);
      return e.x > -48;
    }
    e.x += e.vx;
    e.y += Math.sin(e.t / 12) * e.wob;
    if (e.t % 110 === 60 && e.x > 0 && e.x < 320) enemyFire(e, 1.8);
    return e.x > -60 && e.x < 380;
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

  // ---------------------------------------------------------------- frame

  function box(spriteIdx, x, y) {
    const s = SW.gfx.sprite(spriteIdx);
    if (!s) return { l: x - 8, r: x + 8, t: y - 8, b: y + 8 };
    const l = x - s.hx, t = y - 15 - s.hy;
    return { l: l + 3, r: l + s.w - 3, t: t + 2, b: t + s.h - 2 };
  }
  const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  function enemySprite(e) { return e.frames[(e.t >> 3) % e.frames.length]; }

  function step() {
    frame++;
    const pauseKey = I.pressed("KeyP") || I.pressed("Escape") || I.anyPadButton(9);
    if (pauseKey && !pauseLatch && state === "play") paused = !paused;
    pauseLatch = pauseKey;
    if (paused) return;

    const inputs = players.map((p, i) => I.read(i));
    if (state === "title" || state === "over" || state === "end") {
      players.forEach((p, i) => {
        if (inputs[i] & I.FIRE) {
          if (state !== "title") { players = [newHeli(), newJeep()]; startLevel(first); }
          players[i].joined = true; state = "play";
        }
      });
      return;
    }

    // late joiners
    players.forEach((p, i) => { if (!p.joined && inputs[i] & I.FIRE && p.lives > 0) { p.joined = true; p.inv = 100; } });

    const bossAlive = enemies.some((e) => e.boss);
    const lastT = waves.length ? waves[waves.length - 1].t : LEVEL_LEN;
    const scrolling = !(clock >= lastT && bossAlive) && clock < lastT + 400;
    if (scrolling) {
      scroll++; clock++;
      if (scroll % 32 === 0) stepScenery();
    }
    while (waveIdx < waves.length && waves[waveIdx].t <= clock) spawnWave(waves[waveIdx++]);

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
    enemyShots = enemyShots.filter((s) => {
      s.x += s.vx; s.y += s.vy;
      return s.y < 170 && s.x > -16 && s.x < 336 && s.y > -16;
    });
    enemies = enemies.filter((e) => updateEnemy(e, scrolling));

    // collisions
    for (const e of enemies) {
      if (e.t < 0) continue;
      const eb = box(enemySprite(e), e.x, e.y);
      for (const s of shots) {
        if (s.dead || !hit(eb, { l: s.x - 2, r: s.x + 2, t: s.y - 2, b: s.y + 2 })) continue;
        s.dead = true;
        if (--e.hp <= 0 && !e.dead) {
          e.dead = true; s.from.score += e.score;
          booms.push({ x: e.x, y: e.y, f: 0 });
          if (e.boss) for (let k = 0; k < 6; k++) booms.push({ x: e.x + rand(40) - 20, y: e.y + rand(30) - 15, f: -k * 5 });
        }
      }
      for (const p of players) {
        if (!p.joined || p.dead || e.dead) continue;
        const pb = box(p.kind === "heli" ? heliSprite(p) : jeepSprite(p), p.x, p.y);
        if ((p.kind === "heli") !== !!e.ground || e.boss) if (hit(pb, eb)) killPlayer(p);
      }
    }
    shots = shots.filter((s) => !s.dead);
    enemies = enemies.filter((e) => !e.dead);
    for (const s of enemyShots) for (const p of players) {
      if (!p.joined || p.dead) continue;
      const pb = box(p.kind === "heli" ? heliSprite(p) : jeepSprite(p), p.x, p.y);
      if (hit(pb, { l: s.x - 2, r: s.x + 2, t: s.y - 2, b: s.y + 2 })) { s.dead = true; killPlayer(p); }
    }
    enemyShots = enemyShots.filter((s) => !s.dead);
    booms = booms.filter((b) => ++b.f < 40);

    if (banner > 0) banner--;
    if (!players.some((p) => p.joined || p.dead)) { state = "over"; return; }
    if (clock >= lastT && !enemies.some((e) => e.boss) && waveIdx >= waves.length) {
      if (++endTimer > 200) {
        if (level >= 11) state = "end";
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

    for (const e of enemies) if (e.ground && e.t >= 0) drawSprite(enemySprite(e), e.x, e.y);
    for (const p of players) {
      if (!p.joined || p.dead || (p.inv > 0 && frame & 4)) continue;
      drawSprite(p.kind === "heli" ? heliSprite(p) : jeepSprite(p), p.x, p.y);
    }
    for (const e of enemies) if (!e.ground) drawSprite(enemySprite(e), e.x, e.y);

    ctx.fillStyle = "#ffe066";
    for (const s of shots) ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 15 - 1, 4, 2);
    ctx.fillStyle = "#ff5040";
    for (const s of enemyShots) ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 15 - 1, 3, 3);
    for (const bm of booms) if (bm.f >= 0) drawSprite(EXPLOSION[Math.min(4, bm.f >> 3)], bm.x, bm.y);

    // HUD
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 168, W, 32);
    players.forEach((p, i) => {
      const x = i ? 316 : 4, al = i ? "right" : "left";
      const name = p.kind === "heli" ? "HELI" : "JEEP";
      if (p.joined || p.dead) {
        text(`${name}  ${String(p.score).padStart(7, "0")}`, x, 180, i ? "#9fe0ff" : "#ffd27f", al);
        text("♥".repeat(Math.max(0, p.lives)), x, 192, "#ff7070", al);
      } else if (p.lives > 0) {
        text(`${name}: PRESS FIRE`, x, 186, frame & 32 ? "#888" : "#ccc", al);
      }
    });
    text(`LEVEL ${level}`, 160, 186, "#fff", "center");
    const boss = enemies.find((e) => e.boss);
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

  return { init, step, draw, W, H };
})();
