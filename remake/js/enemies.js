// Enemy behaviour, decoded from the wave routines (see Research/NOTES.md,
// "Enemy behaviour"). Each enemy is a generator script, like the original's
// cooperative tasks: one `yield` = one 50 Hz frame.
//
// Object model (from the disassembly): position (x, y), velocity, acceleration,
// `ground` = moves with the ground scroll ($38 bit 0), an animation list,
// a hitbox, a score ($24, shown x100) and what happens when it's shot:
// explode ($6FA40) or leave a wreck ($6FA58, sprite $72).
"use strict";

SW.enemies = (function () {
  let W;   // world interface, set by attach()
  const EXPLOSION = [320, 321, 322, 323, 324];
  let heliGroupCounter = 0;   // -$7FE6: every 4th helicopter group scatters

  function attach(world) { W = world; heliGroupCounter = 0; }

  // ---------------------------------------------------------------- objects

  function obj(props) {
    return Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, ground: false,
      anim: null, spr: -1, hw: 0, hh: 0, score: 0, hp: 1,
      wreck: null, shootable: true, touchKills: true, kind: "enemy", alive: true,
    }, props);
  }

  // Animation list as in sub_6C8DA/sub_6C90C: frames advance every `delay`
  // frames (2 by default, $20nn sets it); `hold` = stop on the last frame ($FFFE).
  function setAnim(e, frames, delay, hold) {
    e.anim = { frames, delay: delay || 2, i: 0, t: delay || 2, hold: !!hold };
    e.spr = frames[0];
  }
  function stepAnim(e) {
    const a = e.anim;
    if (!a || --a.t > 0) return;
    a.t = a.delay;
    if (a.i < a.frames.length - 1) a.i++;
    else if (!a.hold) a.i = 0;
    e.spr = a.frames[a.i];
  }

  // sub_6C96A: one frame of movement
  function physics(e) {
    e.vx += e.ax; e.vy += e.ay;
    e.x += e.vx; e.y += e.vy;
    if (e.ground) e.x -= W.scrollDelta;
    stepAnim(e);
  }
  function* move(e, n) { for (let i = 0; i < n; i++) { physics(e); yield; } }   // sub_6C810
  function* wait(n) { for (let i = 0; i < n; i++) yield; }                      // sub_6C7D4
  function offscreen(e) { return e.x < -64 || e.x > 420 || e.y > 230 || e.y < -80; }
  function* drift(e) { while (!offscreen(e)) { physics(e); yield; } }           // sub_6C7FC

  function spawn(e, script) {
    e.script = script(e);
    W.enemies.push(e);
    return e;
  }

  // ---------------------------------------------------------------- aiming

  const S = () => W.sin;
  function velocity(e, angle, speed) {   // sub_6C8BC: speed in px/frame
    e.vx = S()[(angle + 64) & 255] * speed / 256;
    e.vy = S()[angle & 255] * speed / 256;
  }
  function angleTo(x, y, tx, ty) {        // sub_6CBB8 (atan2, 256 steps)
    return Math.round(Math.atan2(ty - y, tx - x) / (2 * Math.PI) * 256) & 255;
  }
  function target(prefer) {               // sub_6FC32: a live player, else (160, 150)
    const live = W.players.filter((p) => p.joined && !p.dead);
    if (prefer) { const p = live.find((q) => q.kind === prefer); if (p) return p; }
    if (!live.length) return { x: 0xa0, y: 0x96 };
    return live[W.rand(live.length)];
  }

  // ---------------------------------------------------------------- projectiles

  // $6FB6C: aimed shot, 3 px/frame, can't be shot down
  function aimedShot(x, y, prefer) {
    const t = target(prefer);
    const e = obj({ kind: "shot", x, y, hw: 3, hh: 3, shootable: false });
    velocity(e, angleTo(x, y, t.x, t.y), 3);
    return spawn(e, function* (e) {
      while (!offscreen(e) && e.y < 0x9e) { physics(e); yield; }
    });
  }

  // loc_707C0: missile. Flies `launch` frames as fired, then homes:
  // re-aims `steps` times every 5 frames, turning up to 12 units each time.
  // `opts` overrides the launch: { vx, vy, ax, ay, speed }
  function missile(x, y, angle, launch, steps, ay, opts) {
    const o = opts || {};
    const speed = o.speed || 2.5;
    const e = obj({ kind: "missile", x, y, ground: true, hw: 4, hh: 4, score: 1, angle });
    velocity(e, angle, speed);
    e.ay = ay || 0;
    if (o.vx !== undefined) e.vx = o.vx;
    if (o.vy !== undefined) e.vy = o.vy;
    if (o.ax !== undefined) e.ax = o.ax;
    if (o.ay !== undefined) e.ay = o.ay;
    return spawn(e, function* (e) {
      for (let i = 0; i < launch && e.y < 0x9e; i++) { if (offscreen(e)) return; physics(e); yield; }
      if (o.fixed) return;                      // loc_7078C: keeps its direction
      const t = target();
      e.ax = e.ay = 0;
      e.angle = angleTo(e.x, e.y, t.x, t.y);
      velocity(e, e.angle, speed);
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < 5; i++) { if (e.y >= 0x9e || offscreen(e)) return; physics(e); yield; }
        let d = ((angleTo(e.x, e.y, t.x, t.y) - e.angle + 128) & 255) - 128;
        d = Math.max(-12, Math.min(12, d));
        e.angle = (e.angle + d) & 255;
        velocity(e, e.angle, speed);
      }
      while (!offscreen(e) && e.y < 0x9e) { physics(e); yield; }
    });
  }

  // ---------------------------------------------------------------- families

  // $6D672: mine/dome on the road. Shot: explodes and releases a power-up.
  function mine() {
    const e = obj({ x: 0x14f, y: 0x9e, ground: true, hh: 10, onDeath: (e) => powerUp(e.x, e.y - 24) });
    setAnim(e, [168, 169]);
    return spawn(e, drift);
  }

  // $6D6C8 / $6D6C0 / $6D6AC: tank. Level 1: passive. Later: fires a shell at
  // intervals of (11 - level) * 8 + 10 frames while it's right of x = 50.
  function tank(y) {
    const e = obj({ x: 0x15e, y, ground: true, hw: 18, hh: 10, score: 6, wreck: 166 });
    setAnim(e, [162]);
    return spawn(e, function* (e) {
      if (W.level === 1) { yield* drift(e); return; }
      const gap = (11 - W.level) * 8 + 10;
      while (true) {
        yield* move(e, gap);
        if (e.x <= 0x32) { yield* drift(e); return; }
        setAnim(e, [164, 162], 0x14, true);
        yield* move(e, 5);
        missile(e.x, e.y - 8, 0xc0, 15, 12, -0x2222 / 65536);   // $7071E
        yield* move(e, 15);
      }
    });
  }

  // $6D7A2 / $6D79A / $6D78C: missile launcher: 4 missiles `gap` frames apart, rest 50.
  function launcher(y, gap) {
    const e = obj({ x: 0x14f, y, ground: true, score: 3, wreck: 172 });
    setAnim(e, [170]);
    return spawn(e, function* (e) {
      while (true) {
        for (let k = 0; k < 4; k++) {
          yield* move(e, gap);
          if (offscreen(e)) return;
          setAnim(e, [171, 170], 5, true);
          missile(e.x, e.y - 8, 0xc0, 0, 12);                    // $70754
        }
        yield* move(e, 50);
        if (offscreen(e)) return;
      }
    });
  }

  // $6E570 / $6E54C: helicopter group (count from the stub, 12 frames apart).
  function heliGroup(count, fires) {
    heliGroupCounter = (heliGroupCounter + 1) & 3;
    const scatter = heliGroupCounter === 0;
    const base = randomHeight();
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    return spawn(ctrl, function* () {
      for (let i = 0; i < count; i++) {
        heli(scatter ? randomHeight() : base, fires);
        yield* wait(12);
      }
    });
  }
  function randomHeight() {        // sub_6E4EA
    let y;
    do { y = (W.rand(128)) + 0x20; } while (y >= 0x76);
    let drift = W.rand(1024) / 65536;
    if (y >= 0x64) drift = -drift;
    return { y, drift };
  }
  function heli(h, fires) {        // $6E5AA
    const p = target("heli");
    const fromLeft = p.x > 0xa0;
    const e = obj({ x: fromLeft ? -31 : 351, y: h.y, ax: fromLeft ? 0x900 / 65536 : -0x900 / 65536,
                    ay: h.drift, score: 1 });
    const table = (fromLeft ? 0x6e6a4 : 0x6e644) + W.level * 8;
    setAnim(e, W.animAt(table));
    e.fireTimer = fires ? W.rand(64) : 0;
    return spawn(e, function* (e) {
      while (!(e.x > 400 || e.x < -80)) {
        if (e.y >= 0x84 || e.y <= 0x30) { e.ay = 0; e.vy -= e.vy / 16; }
        physics(e);
        if (fires) {                                             // sub_6E70C
          e.fireTimer = (e.fireTimer - 1) & 255;
          if (e.fireTimer === 0) {
            aimedShot(e.x, e.y);
            if (W.rand(16) === 0) bomb(e.x, e.y);
          }
        }
        yield;
      }
    });
  }

  // $6DD16: bomb: falls, then rolls toward the jeep.
  // $6DCB4 (boss B): waits 0-31 frames, then is thrown up (vy -2) and left.
  function bomb(x, y, thrown) {
    const e = obj({ kind: "bomb", x, y, ay: 0xa00 / 65536, hw: 5, hh: 5, score: 1 });
    setAnim(e, [60, 60, 61], 12);
    return spawn(e, function* (e) {
      if (thrown) {
        e.ay = 0; e.hidden = true;
        yield* wait(W.rand(32));
        e.hidden = false; e.ay = 0xa00 / 65536;
        e.vy = -2; e.vx = -W.rand(0x40000) / 65536;
      }
      while (e.y < 0x96) { physics(e); if (offscreen(e)) return; yield; }
      e.y = 0x96; e.vy = e.ay = 0; e.ground = true;
      const j = target("jeep");
      e.vx = j.x < e.x ? -1 : 1;
      setAnim(e, [63, 62], 4);
      yield* drift(e);
    });
  }

  // $6FD0E / $6FD10: walker with a gun turret (count from the stub, 32 frames apart).
  function walkerGroup(count) {
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    return spawn(ctrl, function* () {
      for (let i = 0; i < count; i++) { walker(); yield* wait(32); }
    });
  }
  function walker() {
    const e = obj({ x: 0x14f, y: 0x8e, ground: true, score: 3, wreck: 128, turret: 123 });
    setAnim(e, [124, 125, 126, 127], 0x25);
    return spawn(e, function* (e) {
      let gun = 0x32;
      while (!offscreen(e)) {
        for (let i = 0; i < 0x25; i++) {
          physics(e);
          if (--gun <= 0) { gun = 0x32; aimedShot(e.x, 0x82 - 4, "jeep"); }
          if (offscreen(e)) return;
          yield;
        }
        e.x -= 6;
      }
    });
  }

  // $6D416: anti-aircraft gun. Level 1: rolls left. Later: after 200 frames it
  // shuffles left/right until the helicopter is on its firing line
  // (x - heliX = (y - heliY) * 32 / 14), then fires a burst every 30 frames.
  function aaGun() {
    const e = obj({ x: 0x14f, y: 0x8e, vx: -0.5, ground: true, score: 3, wreck: 122 });
    setAnim(e, [120], 2, true);
    return spawn(e, function* (e) {
      if (W.level === 1) { yield* drift(e); return; }
      yield* move(e, 200);
      while (!offscreen(e)) {
        const h = W.players.find((p) => p.kind === "heli" && p.joined && !p.dead);
        if (!h) { e.vx = -0.5; physics(e); yield; continue; }
        setAnim(e, [121], 2, true);
        const d0 = (e.x + 4 - h.x) & ~1, d1 = ((e.y - 4 - h.y) * 32 / 14) & ~1;
        if (Math.abs(d1 - d0) <= 2) {
          e.vx = 0;
          for (let k = 0; k < 3; k++) {
            const s = obj({ kind: "shot", x: e.x - 4, y: e.y - 8, hw: 3, hh: 3, shootable: false });
            velocity(s, angleTo(e.x, e.y, h.x, h.y), 3);
            spawn(s, function* (s) { while (!offscreen(s) && s.y < 0x9e) { physics(s); yield; } });
            yield* move(e, 6);
          }
          yield* move(e, 30);
        } else {
          e.vx = d1 > d0 ? 1.5 : -1.5;
          physics(e); yield;
        }
      }
    });
  }

  // ---------------------------------------------------------------- more families

  // Spawner like loc_6FADA: `count` children, `gap` frames apart.
  function group(count, gap, make) {
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    return spawn(ctrl, function* () {
      for (let i = 0; i < count; i++) { make(i); yield* wait(gap); }
    });
  }
  function straight(e) {
    return spawn(e, function* (e) { while (!offscreen(e) && e.y < 0x9e) { physics(e); yield; } });
  }

  // $6EA48 / $6EA40: floating pod (106-109): every 100 frames a ring of 8 shots.
  function floater(y) {
    const e = obj({ x: 0x14f, y: y == null ? 0x20 + W.rand(64) : y, vx: -0.75, score: 6 });
    setAnim(e, [106, 107, 108, 109]);
    return spawn(e, function* (e) {
      while (!offscreen(e)) {
        yield* move(e, 100);
        if (offscreen(e)) return;
        for (let a = 0x100; a > 0; a -= 0x20) {                 // $6FB2E, 3 px/frame
          const s = obj({ kind: "shot", x: e.x - 8, y: e.y, hw: 3, hh: 3, shootable: false });
          velocity(s, a & 255, 3);
          straight(s);
        }
      }
    });
  }

  // $6D816 / $6D81E / $6D82C / $6D834: ground turret (160, wreck 161):
  // 3 volleys of up-left / left / down-left shots, `gap` frames apart, then rests 50.
  function turret(y, gap) {
    const e = obj({ x: 0x14f, y, ground: true, score: 3, wreck: 161 });
    setAnim(e, [160]);
    return spawn(e, function* (e) {
      while (true) {
        for (let k = 0; k < 3; k++) {
          yield* move(e, gap);
          if (offscreen(e)) return;
          missile(e.x - 8, e.y - 5, 0xa0, 999, 0, 0, { fixed: true });   // $70766
          missile(e.x - 12, e.y + 3, 0x80, 999, 0, 0, { fixed: true });  // $70774
          missile(e.x - 8, e.y + 11, 0x60, 999, 0, 0, { fixed: true });  // $70780
        }
        yield* move(e, 50);
        if (offscreen(e)) return;
      }
    });
  }

  // $6E400 (groups $6E3F0 / $6E3F4): drone that can't be shot, accelerates left.
  function droneAt(y) {
    const e = obj({ x: 0x14f, y, ax: -0x3000 / 65536, shootable: false });
    setAnim(e, [98, 99]);
    return spawn(e, drift);
  }

  // $6E488 (groups $6E456-$6E47C): jet (85) accelerating left with a random climb/dive.
  function jet() {
    const v = (W.rand(65536) - 32768) / 65536;
    const e = obj({ x: 0x160, y: 0x30 + W.rand(64), vy: v, ax: -0x2000 / 65536, score: 1 });
    e.spr = 0x55;
    return spawn(e, drift);
  }

  // $6E8AE / $6E8D0: dive plane. Starts at the top, turns 2 units every 2 frames
  // for 128 frames (a half loop down and back), then leaves at 2 px/frame.
  function diver(fires) {
    const p = target("heli");
    const right = p.x > 0xa0;
    const e = obj({ x: right ? 0x80 : 0xc0, y: 0x0a, score: 1 });
    setAnim(e, right ? [297, 298] : [294, 295]);
    let angle = right ? 0x80 : 0, turn = right ? -2 : 2;
    let timer = fires ? W.rand(64) : -1;
    return spawn(e, function* (e) {
      const step = () => {
        physics(e);
        if (timer >= 0 && (timer = (timer - 1) & 255) === 0) aimedShot(e.x, e.y);
      };
      velocity(e, angle, 0x1a0 / 256);
      for (let k = 0; k < 64; k++) {
        angle = (angle + turn) & 255;
        velocity(e, angle, 0x1a0 / 256);
        step(); yield; step(); yield;
      }
      velocity(e, angle, 2);
      while (!offscreen(e)) { step(); yield; }
    });
  }

  // $6E99C (groups $6E96C-$6E990): bouncing ball (100/101, squash 102/103).
  // From level 5 each bounce may fire an aimed shot (about 1 in 11).
  function bouncer() {
    const e = obj({ x: 0x14f, y: 0x50, vx: -1.5, ay: 0x2000 / 65536, score: 1 });
    setAnim(e, [100, 101]);
    return spawn(e, function* (e) {
      while (!offscreen(e)) {
        physics(e);
        if (e.y > 0x98) {
          if (W.level >= 5 && W.rand(65536) <= 0x1800) aimedShot(e.x, e.y - 16);
          e.vy = -e.vy; e.y += e.vy;
          setAnim(e, [102, 103]);
          e.squash = 20;                                        // 5 x (102, 103), then back
        }
        if (e.squash > 0 && --e.squash === 0) setAnim(e, [100, 101]);
        yield;
      }
    });
  }

  // $6ED8E: spawner at x $145 releasing seekers, heights stepping by 16.
  // $6EDC6 seeker (288/289): starts at 3.1 px/frame, slows to 0.8, turns
  // up to 16 units a frame toward its target until it has passed it.
  function seekers(count) {
    let y = 0x38;
    return group(count, 32, () => {
      seeker(0x145, y);
      y += 16; if (y > 0x78) y -= 0x64;
    });
  }
  function seeker(x, y) {
    const e = obj({ x, y, score: 4 });
    setAnim(e, [288, 289]);
    const t = target();
    let speed = 0x320, angle = 0x80;
    return spawn(e, function* (e) {
      while (!offscreen(e)) {
        if (speed > 0xc8) speed -= 6;
        if (t.x < e.x) {
          let d = ((angleTo(e.x, e.y, t.x, t.y) - angle + 128) & 255) - 128;
          angle = (angle + Math.max(-16, Math.min(16, d))) & 255;
        }
        velocity(e, angle, speed / 256);
        physics(e); yield;
      }
    });
  }

  // $6EACE (groups $6EABE / $6EAC2): blimp (83/84), drifts left at 0.25 and
  // zig-zags vertically between y 64 and 134.
  function blimp() {
    const e = obj({ x: 0x14f, y: 0x20 + W.rand(64), vx: -0.25, score: 8 });
    setAnim(e, [83, 84], 4);
    e.vy = W.rand(2) ? 0.5 : -0.5;
    return spawn(e, function* (e) {
      while (!offscreen(e)) {
        if (e.y > 0x86) e.vy = -0.5;
        if (e.y < 0x40) e.vy = 0.5;
        physics(e); yield;
      }
    });
  }

  // $6E03A: missile silo. Waits for a ground column boundary, puts the silo
  // columns $5A/$5B into the road, then every 90 frames a missile ($6E07C)
  // rises out of it: from y 204 at -0.75 for 50 frames, then -2 for 77.
  function silo() {
    const anchor = obj({ kind: "controller", x: 0x14a, y: 0xa8, ground: true, shootable: false, touchKills: false });
    return spawn(anchor, function* (a) {
      while (W.siloBusy || W.scrollPos % 16 !== 1) { if (W.scrollDelta) a.x -= 1; yield; }
      W.siloBusy = true;
      const col = Math.floor((W.scrollPos + a.x + 0x56 - 16) / 16);
      W.groundOverride.set(col, 0x5a);
      W.groundOverride.set(col + 1, 0x5b);
      a.x = col * 16 + 16 - W.scrollPos - 0x56;
      W.siloBusy = false;
      while (a.x + 0x56 > -16) {
        yield* move(a, 0x5a);
        const m = obj({ kind: "silomissile", x: a.x + 0x56, y: 0xcc, ground: true, vy: -0xc000 / 65536,
                        hw: 4, hh: 12, score: 1 });
        spawn(m, function* (m) {
          yield* move(m, 0x32);
          m.vy = -2;
          yield* move(m, 0x4d);
        });
      }
    });
  }

  // ---------------------------------------------------------------- level 11 (and a few elsewhere)

  // Firing hook used with sub_6C7E2: first shot after `first` frames, then every 256.
  function fireHook(first) {
    let t = first;
    return (e) => { t = (t - 1) & 255; if (t === 0) aimedShot(e.x, e.y); };
  }

  // $6DF28 (groups $6DF1C x3 / $6DF18 x2, 127 frames apart): armoured car
  // (130/132, wreck 134) on the ground, rolling at +0.5 against the scroll.
  function car() {
    const e = obj({ x: 0x168, y: 0x8e, ground: true, vx: 0.5, score: 2, wreck: 134 });
    setAnim(e, [130, 132]);
    return spawn(e, drift);
  }

  // $6E130 / $6E152: swirling plane (290/291). From the top at a random x,
  // dives at angle 48-79 for 85 frames, then loops turning +-8, reversing at
  // random (1 in 8) while above y 100; the $6E130 kind fires.
  function swirler(fires) {
    const e = obj({ x: 0x20 + W.rand(256), y: 0x10, score: 1 });
    setAnim(e, [290, 291]);
    const hook = fires ? fireHook(W.rand(64)) : null;
    return spawn(e, function* (e) {
      let angle = 0x30 + W.rand(32);
      velocity(e, angle, 1.25);
      for (let i = 0; i < 0x55; i++) { physics(e); if (hook) hook(e); yield; }
      let turn = W.rand(2) ? 8 : -8;
      for (let i = 0; i < 100 && !offscreen(e); i++) {
        if (W.rand(8) === 0 && e.y <= 0x64) turn = -turn;
        angle = (angle + turn) & 255;
        velocity(e, angle, 1.25);
        for (let f = 0; f < 4; f++) { physics(e); if (hook) hook(e); yield; }
      }
      while (!offscreen(e)) { physics(e); yield; }
    });
  }

  // $6DE6E (groups $6DE5A x2 / $6DE5E x4, 40 frames apart): descender (104/105).
  // Sinks from the top, slows, then climbs away, firing (first after 100 frames).
  function descender() {
    const e = obj({ x: 0x94 + W.rand(64), y: 0, vx: -0x3000 / 65536, vy: 0x3000 / 65536, score: 2 });
    setAnim(e, [104, 105]);
    const hook = fireHook(100);
    return spawn(e, function* (e) {
      const phase = function* (n) { for (let i = 0; i < n; i++) { physics(e); hook(e); yield; } };
      yield* phase(0xc8 + W.rand(64));
      e.vy = 0x1000 / 65536;
      yield* phase(0xc8 + W.rand(64));
      e.vy = -0x3000 / 65536;
      yield* phase(0x190);
    });
  }

  // $6D2B8 (groups $6D2AC x4 / $6D2A8 x3, 20 frames apart): hovering gunship
  // (118/119): flies in, stops, fires at each player 4-7 times 50 frames apart, leaves.
  function hoverer() {
    const e = obj({ x: 0x14a, y: 0x32 + W.rand(64), vx: -1, score: 3 });
    setAnim(e, [118, 119]);
    return spawn(e, function* (e) {
      yield* move(e, 8 + W.rand(32));
      e.vx = 0;
      for (let n = 4 + W.rand(4); n > 0; n--) {
        yield* move(e, 0x32);
        aimedAtEach(e.x, e.y);
      }
      e.vx = -1;
      yield* drift(e);
    });
  }

  // $6DDAC (spawners $6DDA6 x4 / $6DDA2 x3): a column of sinkers (110/112),
  // 8 frames apart, each 18 px lower, from y 40.
  function column(count) {
    let y = 0x28;
    return group(count, 8, () => {
      const e = obj({ x: 0x166, y, vx: -0x2000 / 65536, vy: 0.5, score: 2 });
      setAnim(e, [110, 112]);
      spawn(e, drift);
      y += 0x12;
    });
  }

  // $6ED3E (group $6FCFA x4, 20 frames apart): low bomber (116/117) at y 134,
  // -2 px/frame, dropping a shot down-left every 10 frames.
  function bomber() {
    const e = obj({ x: 0x14f, y: 0x86, vx: -2, score: 2 });
    setAnim(e, [116, 117]);
    return spawn(e, function* (e) {
      while (!offscreen(e)) {
        yield* move(e, 10);
        const s = obj({ kind: "shot", x: e.x - 8, y: e.y, hw: 3, hh: 3, shootable: false });
        velocity(s, 0x70, 3);
        straight(s);
      }
    });
  }

  // $6ECE6 (groups $6FCEE x4 / $6ECDA x3): dasher (114/115) at y 40: cruises
  // at -1 for 100 frames, then dashes at -5 (116/117) firing every 5 frames.
  function dasher() {
    const e = obj({ x: 0x14f, y: 0x28, vx: -1, score: 3 });
    setAnim(e, [114, 115]);
    return spawn(e, function* (e) {
      yield* move(e, 100);
      e.vx = -5;
      setAnim(e, [116, 117]);
      while (!offscreen(e)) { yield* move(e, 5); aimedShot(e.x, e.y); }
    });
  }

  // $708A2: one frame of "everything touched a vehicle" (-$67A0), so every
  // enemy on screen is destroyed, then the screen flashes 7 times.
  function clearScreen() {
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    return spawn(ctrl, function* () {
      yield;
      W.destroyAll();
      for (let k = 0; k < 7; k++) { W.flash = 21; yield* wait(42); }
    });
  }

  // $6F5FE (and from mines): power-up. Drifts up-left with the ground.
  // Touch it to collect; 18 shots destroy it (sprite changes with 3 to go).
  function powerUp(x, y) {
    const e = obj({ kind: "powerup", x: x == null ? 0x14a : x, y: y == null ? 0x28 + W.rand(32) : y,
                    vx: -0.25, vy: -0x800 / 65536, ground: true, hw: 16, hh: 16, hp: 18, score: 10,
                    touchKills: false });
    setAnim(e, [34, 35]);
    e.onHit = (e) => { if (e.hp === 3) setAnim(e, [36, 37]); };
    return spawn(e, drift);
  }

  // $6F736: palette flash, 3 pulses (not an enemy)
  function flash() {
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    return spawn(ctrl, function* () {
      for (let k = 0; k < 3; k++) { W.flash = 21; yield* wait(42); }
    });
  }

  // ---------------------------------------------------------------- bosses
  // All three stop the scroll (-$7E76 = 1) and take level*8 + 40 hits
  // (the final boss 150); each hit flashes them ($6F8E0). When the count
  // runs out -$7E76 = 2 and the level ends.

  const chance = () => W.rand(65536) <= 0xe000;     // sub_6D3F4: 87.5 %

  function bossObj(props) {
    return obj(Object.assign({ kind: "boss", score: 5, shootable: false }, props, { maxHp: props.hp }));
  }
  function bossDies(e) {
    W.stopScroll = 2;
    for (let k = 0; k < 8; k++) W.boom(e.x + W.rand(48) - 24, e.y + W.rand(32) - 16, -k * 6);
  }
  function aimedAtEach(x, y) {                       // $6FB3A: one aimed shot per live player
    for (const p of W.players) if (p.joined && !p.dead) aimedShot(x, y, p.kind);
  }

  // $705D0, levels 1/3/5/7/9 (sprites 240/242)
  function bossA() {
    W.stopScroll = 1;
    const e = bossObj({ x: 351, y: 64, vx: -2 / 3, hw: 16, hh: 12, hp: W.level * 8 + 40, onDeath: bossDies });
    setAnim(e, [240, 242]);
    return spawn(e, function* (e) {
      yield* move(e, 150);
      e.shootable = true;
      while (true) {
        if (chance()) bomb(e.x, e.y);
        if (chance()) missile(e.x, e.y + 20, 0x80, 25, 12, 0,                 // $706EE
          { vx: 0, vy: 1, ax: -0x147a / 65536, ay: -0xa3d / 65536 });
        if (chance()) aimedAtEach(e.x, e.y);
        if (W.level !== 1 && chance()) drone(e.x, e.y);
        // sub_70672: drift to stay in x 160..270, follow the helicopter's height
        const n = (11 - W.level) * 8 + 35;
        for (let i = 0; i < n; i++) {
          e.ax = e.x < 0xa0 ? 0x600 / 65536 : e.x > 0x10e ? -0x600 / 65536 : 0;
          let ty;
          const h = W.players.find((p) => p.kind === "heli" && p.joined && !p.dead);
          const j = W.players.find((p) => p.kind === "jeep" && p.joined && !p.dead);
          if (h) ty = h.y + 4; else if (j) ty = Math.floor(j.x / 3) + 0x20; else ty = 0x40;
          ty = Math.max(0x28, ty);
          e.vy = ty > e.y ? 0x6000 / 65536 : ty < e.y ? -0x6000 / 65536 : 0;
          physics(e); yield;
        }
      }
    });
  }
  function drone(x, y) {                             // $6E42E: unshootable, accelerates away left
    const e = obj({ x, y, ax: -0x3000 / 65536, shootable: false });
    setAnim(e, [98, 99]);
    return spawn(e, drift);
  }

  // $6DB1E, levels 2/4/6/8/10: ground vehicle (209/229) with a rear part (218/238)
  function bossB() {
    W.stopScroll = 1;
    const e = bossObj({ x: 0x170, y: 0x76, vx: -2 / 3, hp: W.level * 8 + 40, onDeath: bossDies });
    setAnim(e, [209, 229]);
    // $6DC42, linked to the boss; hits on it count against the boss (assumed from the link)
    const rear = obj({ kind: "part", hw: 32, hh: 16, shootable: false, forward: e });
    setAnim(rear, [218, 238]);
    spawn(rear, function* (r) {
      while (e.alive && e.kind === "boss") {
        r.x = e.x - 18; r.y = e.y + 32; r.blink = e.blink;
        stepAnim(r); yield;
      }
      W.boom(r.x, r.y, 0);
    });
    return spawn(e, function* (e) {
      yield* move(e, 0x6e);
      e.shootable = true; rear.shootable = true; e.vx = 0;
      for (let round = 0; round < 14; round++) {
        const ox = e.x + 8, oy = e.y + 8;
        if (chance()) aimedAtEach(ox, oy);
        if (chance()) bomb(ox, oy, true);
        if (chance()) missile(ox, oy, 0x80, 0, 0);   // $707BC: aimed once
        if (W.rand(8) === 0) for (let k = 0; k < 4; k++) bomb(ox, oy, true);
        yield* move(e, (11 - W.level) * 8 + 0x2d);
      }
      while (true) {                                 // creeps left, firing every step, wraps around
        for (let k = 0; k < 2; k++) {
          yield* move(e, 3); e.y += 1;
          yield* move(e, 4); e.y -= 1;
        }
        e.x -= 1;
        missile(e.x, e.y, 0x80, 0, 0);
        bomb(e.x, e.y, true);
        if (e.x <= -32) e.x = 0x170;
      }
    });
  }

  // $70512, level 11: final boss, 150 hits, churns through sprites 310-313
  function bossFinal() {
    W.stopScroll = 1;
    const e = bossObj({ x: 0x119, y: 0x62, hp: 150, score: 50, shootable: true, touchKills: false,
                        onDeath: (e) => { bossDies(e); W.gameWon = true; } });
    e.spr = 310;
    e.onHit = (e) => W.boom(e.x + W.rand(32) - 16, e.y + W.rand(32) - 16, 0);
    const churn = (e) => { let f; do { f = 310 + W.rand(4); } while (f === e.spr); e.spr = f; };
    return spawn(e, function* (e) {
      while (true) {
        for (let i = 125; i > 0; i--) {              // launches firing helicopters every 8 frames
          churn(e); yield;
          if ((i & 7) === 0) heli(randomHeight(), true);
        }
        for (let i = 0; i < 50; i++) {
          e.spr = 310 + W.rand(4); yield;
          e.spr = 80; yield;
        }
        pod(e.x, e.y);
      }
    });
  }
  function pod(x, y) {                               // $6D616: spiral of 32 bullets
    const e = obj({ x, y, vx: -0.5, shootable: true, score: 1 });
    setAnim(e, [80, 81, 82], 10);
    return spawn(e, function* (e) {
      let angle = 8;
      for (let k = 0; k < 32; k++) {
        yield* move(e, 4);
        missile(e.x, e.y, angle, 25, 0, 0, { speed: 2 });   // $70798
        angle = (angle + 12) & 255;
      }
      yield* drift(e);
    });
  }

  // Families not decoded yet: real sprites, generic movement.
  function generic(h) {
    if (h.y !== null && h.y >= 0x78) {
      for (let i = 0; i < Math.min(h.count, 8); i++) {
        const e = obj({ x: (h.x || 0x14f) + i * 40, y: h.y, ground: true, vx: -0.5, score: 3 });
        setAnim(e, h.frames, 8);
        spawn(e, function* (e) {
          let gun = 45 + i * 20;
          while (!offscreen(e)) { physics(e); if (--gun === 0) { gun = 90; aimedShot(e.x, e.y - 8); } yield; }
        });
      }
      return;
    }
    const ctrl = obj({ kind: "controller", shootable: false, touchKills: false });
    spawn(ctrl, function* () {
      const fromLeft = target("heli").x > 0xa0, y0 = 32 + W.rand(80);
      for (let i = 0; i < Math.min(h.count, 16); i++) {
        const e = obj({ x: fromLeft ? -20 : 340, y: y0, vx: (fromLeft ? 1 : -1) * 2, score: 1 });
        setAnim(e, h.frames, 8);
        spawn(e, function* (e) {
          let t = W.rand(64);
          while (e.x > -60 && e.x < 380) {
            physics(e); e.y += Math.sin(++t / 12) * 0.6;
            if (t % 110 === 60) aimedShot(e.x, e.y);
            yield;
          }
        });
        yield* wait(12);
      }
    });
  }

  // ---------------------------------------------------------------- dispatch

  const FAMILY = {
    "6D672": () => mine(),
    "6D6C8": () => tank(0x9a), "6D6C0": () => tank(0x8a), "6D6AC": () => tank(0x82),
    "6D7A2": () => launcher(0x8e, 0x32), "6D79A": () => launcher(0x8e, 0x0a), "6D78C": () => launcher(0x7a, 0x32),
    "6D416": () => aaGun(),
    "6F5FE": () => powerUp(),
    "6F736": () => flash(),
    "705D0": () => bossA(), "6DB1E": () => bossB(), "70512": () => bossFinal(),
    "6EA48": () => floater(), "6EA40": () => floater(0x78),
    "6D816": () => turret(0x8e, 0x0a), "6D81E": () => turret(0x7e, 0x0a),
    "6D82C": () => turret(0x8e, 0x32), "6D834": () => turret(0x7e, 0x32),
    "6E3F0": () => group(2, 50, () => droneAt(randomHeight().y)),
    "6E3F4": () => group(3, 50, () => droneAt(randomHeight().y)),
    "6E400": () => droneAt(randomHeight().y),
    "6E03A": () => silo(),
    "6D40A": () => group(3, 0x26, aaGun),
    "6DE56": () => {},                                       // jumps straight to "end task"
    "6DCF6": () => bomb(0x14a, 0x76),
    "6DF1C": () => group(3, 0x7f, car), "6DF18": () => group(2, 0x7f, car),
    "6E02A": () => group(4, 0x14, () => floater()),
    "6E10C": () => group(4, 0x14, () => swirler(true)), "6E152": () => swirler(false),
    "6DE5A": () => group(2, 0x28, descender), "6DE5E": () => group(4, 0x28, descender),
    "6D2AC": () => group(4, 0x14, hoverer), "6D2A8": () => group(3, 0x14, hoverer),
    "6DDA6": () => column(4), "6DDA2": () => column(3),
    "6FCFA": () => group(4, 0x14, bomber), "6ED3E": () => bomber(),
    "6FCEE": () => group(4, 0x14, dasher), "6ECDA": () => group(3, 0x28, dasher),
    "708A2": () => clearScreen(),
    // other group sizes / single instances of the same families
    "6E104": () => group(10, 0x14, () => swirler(true)), "6E108": () => group(6, 0x14, () => swirler(true)),
    "6E118": () => group(14, 0x14, () => swirler(false)), "6E11C": () => group(10, 0x14, () => swirler(false)),
    "6E120": () => group(6, 0x14, () => swirler(false)), "6E124": () => group(4, 0x14, () => swirler(false)),
    "6D2A4": () => group(2, 0x14, hoverer), "6D2B8": () => hoverer(),
    "6ED7C": () => seekers(2), "6ED80": () => seekers(3),
    "6ECE6": () => dasher(), "6DF28": () => car(),
  };
  // stubs: group size and spacing as in each `moveq #n,d0 / moveq #m,d1`
  const JETS = { "6E456": [20, 10], "6E45C": [16, 16], "6E462": [9, 20], "6E468": [6, 18], "6E46E": [4, 20],
                 "6E474": [26, 50], "6E478": [14, 50], "6E47C": [4, 50] };
  const DIVERS = { "6E886": [6, true], "6E88A": [9, true], "6E896": [4, false], "6E89A": [8, false],
                   "6E89E": [12, false], "6E8A2": [15, false] };
  const BOUNCERS = { "6E96C": [16, 6], "6E972": [12, 10], "6E978": [9, 18], "6E97E": [8, 19],
                     "6E984": [6, 15], "6E98A": [4, 20], "6E990": [3, 20] };
  const SEEKERS = { "6ED84": 4, "6ED88": 6, "6ED8C": 15 };
  const BLIMPS = new Set(["6EABE", "6EAC2", "6EAC4"]);
  for (const [k, [n, gap]] of Object.entries(JETS)) FAMILY[k] = () => group(n, gap, jet);
  for (const [k, [n, fires]] of Object.entries(DIVERS)) FAMILY[k] = () => group(n, 0x14, () => diver(fires));
  for (const [k, [n, gap]] of Object.entries(BOUNCERS)) FAMILY[k] = () => group(n, gap, bouncer);
  for (const [k, n] of Object.entries(SEEKERS)) FAMILY[k] = () => seekers(n);
  for (const k of BLIMPS) FAMILY[k] = () => group((HINTS[k] && HINTS[k].count) || 1, 0x1c, blimp);
  const HELI_NO_FIRE = new Set(["6E556", "6E55A", "6E55E", "6E562", "6E566", "6E56A", "6E56E"]);
  const HELI_FIRE = new Set(["6E53A", "6E53E", "6E542", "6E546", "6E54A"]);
  const WALKER = new Set(["6FD0E", "6FD06", "6FD08", "6FD0A", "6FD0C", "6FD10"]);
  const SKIP = new Set();

  // Which waves use decoded behaviour (for the notes / debugging)
  function decoded(addr) {
    return !!(FAMILY[addr] || HELI_NO_FIRE.has(addr) || HELI_FIRE.has(addr) || WALKER.has(addr));
  }

  function wave(addr) {
    const h = HINTS[addr];
    const count = h ? h.count : 1;
    if (FAMILY[addr]) return FAMILY[addr]();
    if (HELI_NO_FIRE.has(addr)) return heliGroup(count, false);
    if (HELI_FIRE.has(addr)) return heliGroup(count, true);
    if (WALKER.has(addr)) return walkerGroup(count);
    if (SKIP.has(addr) || !h) return;
    let frames = h.frames[W.level] || Object.values(h.frames)[0];
    if (!frames) return;
    generic(Object.assign({}, h, { frames }));
  }

  return { attach, wave, decoded, setAnim, obj, EXPLOSION };
})();
