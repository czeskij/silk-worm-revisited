# Silkworm (Amiga) — disassembly notes

Source disk: `Data/Floppies/Silkworm.adf` (Defjam/CCS/Spreadpoint crack, 1989).

## Files here

| File | What it is |
|---|---|
| `bootblock.asm` | Boot block (the crack's trackloader), fully disassembled |
| `chipmem.bin` | 512 KB chip RAM as it looks when the game starts (rebuilt from the disk) |
| `game_traced.asm` | Main program, traced from its entry point and VBL handler; data shown as `dc.b` |
| `loading_screen.png` | The crack's loading picture, decoded from tracks 3–9 |
| `levels/` | Background of every level (PNG) and the raw per-level blocks |
| `waves/` | Enemy wave list, per-level timelines and a legend of enemy types |
| `maps/` | Full map of every level: backdrop, ground, scenery and enemy entry points |
| `sprites.png` | All 400 sprite/bob objects in level 1's palette |
| `sprites_by_level/` | The same sheet in each level's palette (scenery colours change) |
| `hwsprites.png` | The 69 hardware sprites: shots and missiles in every direction |
| `tools/` | The Python scripts that produced all of the above |

Re-run everything (needs `pip install capstone` for the disassemblers):

```
python3 tools/extract.py ../Data/Floppies/Silkworm.adf .
python3 tools/trace68k.py chipmem.bin game_traced.asm 0x68488 0x6af38 --range 0x3FFE0 0x7F3E0
python3 tools/sprites.py chipmem.bin sprites.png 0x67772      # level 1 palette
python3 tools/hwsprites.py chipmem.bin hwsprites.png
python3 tools/levels.py ../Data/Floppies/Silkworm.adf chipmem.bin levels
python3 tools/waves.py chipmem.bin waves
python3 tools/maps.py ../Data/Floppies/Silkworm.adf chipmem.bin maps
```

To include the enemy routines in `game_traced.asm`, pass their addresses as extra
entries (they're computed at runtime, so the tracer can't find them alone) —
the list is in `waves/waves.txt` (legend section).

## Disk layout

Not an AmigaDOS disk. The boot block (“Spam & Spam Disk Load v1.0”) drives the
floppy hardware directly (sync `$4489`, standard 11-sector MFM, `$55555555` decode).

Both loaders pick the head from bit 0 of their track counter **inverted** (an even
number selects head 1), and the next-track routine (`$300` in the boot block,
`$6BBB4` in the game) toggles that bit and steps the drive only every other call.
So track number *n* (even) reads ADF tracks **n+1, n+3, n+2, n+5, n+4 …** —
reading the ADF linearly gives scrambled data. `tools/extract.py:track_order`
simulates this.

| Track number | ADF tracks read | Loaded to | Content |
|---|---|---|---|
| — | 0–1 | — | boot block |
| 2 (×6) | 3,5,4,7,6,9 | `$20000` | loading picture: 320×200, 4 bitplanes, palette `$27D00` |
| 10 (×46) | 11,13,12 … 55,57 | `$3FFE0–$7F3E0` | main program + data |
| 80–112 (×4 each) | 81–116 | `$18E4` | per-level background blocks (see Levels) |
| — | 120–159 | — | empty |

After loading, the boot block writes `moveq #0,d0 / rts` at `$6ACB0` (the crack's
patch over the original protection) and jumps to **`$68488`**.

A small anti-tamper check XORs the `-----PROTEC-----` string and hangs if it was edited.

## Program

- Entry `$68488`: `ori #$700,sr`, stack `$80000`, **A6 = `$8080`** → all game
  variables are `-$xxxx(a6)`, i.e. in `$0080–$8080`.
- Level-3 (VBL) interrupt handler: **`$6AF38`** (installed at `$6AF26`).
- ~28 KB of code found by the tracer (7,800 instructions, 1,229 labels) when the
  116 enemy routines are added as entries. Indirect calls (`jsr (a0)` at
  `$6AF68`, `jsr (a4)` at `$6BDA0`) still hide some routines.
- Note: many routines keep a **game object** pointer in `a4`, so the listing's
  `; if a4=$DFF000: …` hints are only meaningful where `a4` really is `$DFF000`.

### Controls

- `$6AFA0` reads `JOY0DAT`/`JOY1DAT` + CIA fire bits each frame into
  `$01E2` (port 0) and `$01E4` (port 1); keyboard state goes to `$01E6`.
  Format: low nibble = direction (table at `$6AFDC`), bit 7 = fire.
- Each vehicle has an input-source variable — `$02D0` and `$0342`:
  **0 = joystick port 0, 1 = joystick port 1, 2 = keyboard**.
  Defaults set at start-up: `$02D0 = 1`, `$0342 = 2`, so one vehicle starts on
  the keyboard. The title screen's “PRESS FUNCTION KEYS TO SELECT CONTROLS” changes it.

### Frame loop

The frame routine `$6963E` runs from the VBL interrupt (via `-$7E98` at `$6AF64`),
i.e. **50 times a second** on PAL: read joysticks (`$6AFA0`) and keyboard,
run every task once (`sub_6C4AE`), scroll one step (`sub_69C4A`).

### Players

Two tasks start with each level, before the wave scheduler (`$6EECC`):
**jeep `$6EFB8`** (object `-$7D9A`, input source `-$7D3E`) and
**helicopter `$6F148`** (object `-$7E0C`, input source `-$7DB0`).

- Direction table `$6F244`: 16 × (dx, dy) words indexed by the joystick byte's
  low nibble. Both vehicles move 2× that, 3× with their speed power-up
  (`-$7D8E` jeep, `-$7E00` helicopter). X is kept in 30–300.
- **Helicopter**: starts (64, 64); Y kept in 24–122. Sprites 0–3 are poses
  (level, tilt right 1/2, tilt left 3), 4–7 the same with the rotor in its other
  position; animations alternate them.
- **Jeep**: starts (64, `$98`); `$98` is ground level. `sub_6F386`: on a joystick,
  up without fire becomes **jump** (bit `$40`), and up/down are dropped. Jump:
  Y speed −3.0, gravity +0.125 per frame (16.16), lands at > `$99`. With fire
  held, up/down turn the gun (`$64`, 0–16, one step per 2 frames, an extra
  8-frame stop at 7). Sprite = 10 + (angle + 1) / 2; 20/21 while jumping.
- **Firing** (`sub_6F284` heli, `sub_6F2F4` jeep): fire held auto-repeats every
  `$5E(player)` frames (10 at start). Heli: shot at angle 0 from (x+8, y+2) plus
  one at angle 32 (45° down). Jeep: shot at angle −gun×8 from (x−8, y−5), plus the
  45° shot while airborne. Weapon power-ups (`-$7E02` heli, `-$7D90` jeep) add a
  second shot. All shots: speed `$E00` (14 px/frame), angle via the 256-step
  sine table at `$6D01E` (`sub_6D006`), die at Y ≥ `$9E` or off screen.
  Shot sprites are `$2xx` (hardware sprites, `bclr #9` path in `sub_712AA`).
- Joystick byte: bit 0 up, 1 down, 2 left, 3 right, 7 fire (table `$6AFDC`).

### Graphics

- Setup routine `$715C0` relocates 400 object records and builds their masks.
- Pointer table `$4A498` (400 longs, record = value + `$5F3B8`).
- Record: `+0` width (words), `+2` rows, `+6/+8` hotspot, `+$E` pixel offset from `$4AAD8`.
- Pixels: row-interleaved, 4 bitplanes per row. Masks are built at runtime into `$2AE6C+`.
- Palettes: `sub_69BC8` copies 32 colours from `a0` into the target palette at
  `-$7FBC(a6)`; the fader at `$6C398` blends the live palette towards it.
  - **Level palettes: `$67732 + level × 64`** (levels 0–11), picked by the level
    number in `-$7F20(a6)` at `$6B98A`. Colours 0–9 are shared by vehicles/enemies/
    explosions; 10–15 are per-level scenery; 16–31 are hardware-sprite colours.
  - Menu/text palettes: `$676D2`, `$676F2`, `$67712`.
- `sprites.png` uses level 1's palette; `sprites_by_level/` has one sheet per level.
- **Hardware sprites** (`hwsprites.png`): sprite numbers with bit 9 set (`$2xx`)
  take the `bclr #9` path in `sub_712AA` (`loc_714AA`): data at
  `$61132 + n×64`, 16 lines of two words (Amiga sprite format, 2 bitplanes),
  69 of them up to the ground bank at `$62272`, coloured with palette entries
  17–19 (red / grey / white in every level). Queued in a list sorted by y
  (`-$7D20`, at most 24 per frame), positioned at (x + `$78`, y + `$44`).

  | Sprites | Use | Picked by |
  |---|---|---|
  | `$200`–`$20F` | player shot, 16 directions | jeep: `$200 + (−gun >> 1 & 15)` (`$6F428`); `$202` = the 45° extra shot |
  | `$210`–`$22F` | missile, 32 directions | `$210 + (angle + 4) / 8` (`sub_7088C`) |
  | `$230` / `$231` | silo missile, top / bottom half | `$6E07C` and its linked part `$6E0F6` |
  | `$232`–`$241` | enemy shot, 16 directions | `$232 + (angle + 8) / 16` (`$6FBA2`) |
  | `$242`–`$244` | helicopter shot (`$6F45E`) and two long variants | |

### Levels

Level number lives in `-$7F20(a6)`: **1–11 are the game's levels, 12 is the ending**
(skips the palette); 0 is unused by the loader.

- **Loader `$6B93E`**: track number from the word table at `$6B924 + level×2`
  (L1–12: 80, 84, 88, 92, 84, 96, 100, 96, 88, 104, 108, 112), reads 4 tracks
  (22 KB) to `$18E4`. Levels sharing a block (2/5, 3/9, 6/8) differ by palette
  and column stream.
- **Per-level table `$69E3C + level×12`**: three stream pointers →
  `-$7FDA` backdrop column stream (drawn into `$70E4`),
  `-$7FD6` second column layer (near ground, drawn into `$1D8E4` by
  `$6A966`/`$6A992`; `-$7FDC` can force special columns `$5A`/`$5B`),
  `-$7E5A` ground scenery: words = sprite number, negative = wait N columns;
  queued with an X position in the ring buffer `$69CC2`, drawn by `$69C88` → `sub_712AA`.
- **Block format**: 20 columns × 9 word offsets (360 bytes), then 128-byte cells.
  A cell is 16×16 pixels, 4 bitplanes interleaved per row; a column is 9 cells
  stacked = 16×144 pixels.
- **Scroller `$69D9A`**: every 16 pixels of scroll it reads one byte (column
  number) from the stream; a negative byte loops back to the start. Columns are
  drawn into the background buffer at `$70E4` by `$6A900`/`$6A934`.
- `levels/level_NN.png`: one pass of each level's backdrop in its own palette;
  `levels/block_NNN.bin`: the raw blocks (named by track number).
### Scrolling and full maps

- **Scroll step `sub_69C4A`** runs once per pixel of ground scroll: level clock
  `-$7FD2` += 1 (so **wave clock = ground pixels**, a level is 4,704 px),
  ground counter += 1, backdrop counter += 1 every other step (half-speed
  parallax), and every 32 steps the scenery stream steps (`sub_69D52`).
- **Ground layer**: stream `-$7FD6`, one byte per 16 px; column *n* is 192 bytes
  at `$62272 + n×$C0` = 16×24 pixels, 4 bitplanes interleaved per row. The ground
  bank is in the main program and shared by all levels.
- **Scenery**: stream `-$7E5A`, one word per 32 px slot: sprite number, `0` =
  empty slot, negative *w* = skip `−w−1` slots. Object world X = scroll + `$150`,
  drawn by `sub_712AA` at Y = `$90 − $F` minus the sprite's hotspot (`+6`/`+8` in
  its record; hotspot Y is always height − 17, so every object stands on one
  ground line). Levels 6 and 8–11 point at a stream starting with −10000, i.e.
  no scenery objects.
- `maps/map_level_NN.png`: full level (4,704 px + one screen): backdrop
  (shown 1:1 and looping; in game it moves at half speed), ground strip, scenery
  objects, and a band below with an icon where each enemy wave enters
  (clock + 320 px). Vertical lines in the band mark every screen width.

### Enemy waves

Enemies are cooperative **tasks**: `sub_6C4E2` spawns one, `sub_6C564` yields a
frame, `sub_6C7D4` waits `d0` frames, `a5` = current task/object.
Object fields seen so far: `(a5)` X and `4(a5)` Y (16.16), `$14`/`$18` velocity,
`$26`/`$2C`/`$30` animation state, `$32` current sprite number.

- **Scheduler `$6EEF6`**: script for level *n* at long `$6EEA0 + (n−1)×4`.
  Pairs of words `(clock, action)` until clock < 0. When the level clock
  `-$7FD2(a6)` reaches `clock`, it runs `$6D21E + |action|`
  (action < 0 → its own task, else via `sub_6C852`).
- **Wave routines** are mostly stubs: `moveq #count,d0 / bra common`. The common
  part calls **`loc_6FADA`** = spawn `d0` copies of the child behaviour in `a0`,
  `d1` frames apart.
- **Animations**: `sub_6C8F6` (a0 = list) or `sub_6C8DA` (list inline after the
  `bsr`; code continues after `$FFFF`), or `move.w #n,$32(a5)` for a still frame.
  Lists are sprite numbers from the 400-object bank (bit 14/13 = control words,
  `$FFFF` = loop). Some behaviours index their list by `level × 8`, so the same
  enemy changes look per level.
- Every level's script ends with the boss at clock **4704** (alternating
  `$705D0` / `$6DB1E`); level 11 ends at 4792 with `$70512`.
  `$6E03A` is a gun emplacement built into the ground layer; `$6F736` is a
  palette flash effect, not an enemy.
- `waves/waves.txt`: every wave of every level (clock, routine, group size,
  sprites found). 569 of 604 waves resolve to sprites by static analysis.
  `waves/waves_level_NN.png`: timeline per level (bar = clock, icons = group).
  `waves/legend.png`: all 116 routines with their main sprite.

### Enemy behaviour

**Task/object API** (all enemies are built from these):

| Routine | Does |
|---|---|
| `sub_6C96A` | one frame: velocity += acceleration (`$14`/`$18`), position += velocity (`$8`/`$C`), minus scroll if `$38` bit 0 (ground) / bit 1 (backdrop); then `sub_6C9A0`: animate, draw (`sub_712AA`), collide (`sub_6CAFE`), yield |
| `sub_6C810(d0)` | `d0` frames of `sub_6C96A` |
| `sub_6C7D4(d0)` | wait `d0` frames (no movement, not drawn) |
| `sub_6C7FC` | keep moving until off screen, then end |
| `sub_6C660` / `sub_6C62C` | spawn a child task at `a0`, copying position |
| `loc_6C6FE` | end task |
| `sub_6C8DA` | set animation from the words after the `bsr` (code resumes after the list) |
| `sub_6C8F6` | set animation from `a0` |
| `sub_6C8BC` | velocity from angle `$10` and speed `$12` |
| `sub_6C88A(d0)` | turn toward target `d1` by at most `d0` (0 = snap) |
| `sub_6CBB8` | atan2 → 256-step angle |
| `sub_6FC32` | pick a target: a live player, else (160, 150) |
| `loc_6FADA` | spawn `d0` children of `a0`, `d1` frames apart |

Collision (`sub_6CAFE`): flags `$3B` pick checks, hitbox half-size `$1C`/`$1E`:
bit 0 player shot → handler `$3C`; bit 1 player vehicle → `$40`; bit 3 → `$44`;
bit 4 level end → `$48`; bit 2 blitter collision → `$4C`. Common handlers:
`$6FA34` kill the touching player; `$6FA40` explode + score + (mines) release a
power-up; `$6FA58` become a wreck (sprite `$72`) that scrolls away. `$24` is
the score value (`sub_6FA8A`); every N kills (N from `-$7EAC`, +8 each time,
up to `$68`) a bonus carrier `$6FE20` appears and group sizes are halved
while it's around (`sub_6FACC`).

**Families decoded** (wave routine → behaviour), 59 % of all waves:

| Routine | Enemy | Behaviour |
|---|---|---|
| `6D672` | mine / dome (168, 169) | fixed to the road at (`$14F`, `$9E`); shot: explodes, releases a power-up; touch kills |
| `6D6C8` `6D6C0` `6D6AC` | tank (162, wreck 166) | Y `$9A`/`$8A`/`$82`, hitbox ±18×±10, score 6. Level 1 passive; later: every (11 − level)×8 + 10 frames fires a shell (`$7071E`) while x > 50 |
| `6D7A2` `6D79A` `6D78C` | missile launcher (170, wreck 172) | Y `$8E`/`$8E`/`$7A`; 4 homing missiles (`$70754`) 50 or 10 frames apart, then 50 frames rest |
| `6E556`–`6E56E` | helicopter group, no fire | 4–16 helicopters 12 frames apart, all at one random height (every 4th group scattered), enter from the side away from the player and accelerate (`$900`) across; small random vertical drift, damped at Y 48 / 132. Sprites per level from `$6E644` / `$6E6A4 + level×8` |
| `6E53A`–`6E54A` | helicopter group, firing | same, plus an aimed shot (`$6FB6C`, 3 px/frame) after 0–63 frames then every 256, and sometimes a bomb (`$6DD16`) |
| `6FD0E` `6FD10` | walker + gun turret (124–127, turret 123, wreck 128) | on the ground at Y `$8E`, steps 6 px left every 37 frames; turret fires at the jeep every 50 frames |
| `6D416` | AA gun (120/121, wreck 122) | level 1 rolls left; later shuffles (±1.5 px/frame) until the helicopter is on its firing line (x − heliX = (y − heliY)×32/14), fires a burst, waits 30 frames |
| `6F5FE` | power-up (34/35, then 36/37) | drifts up-left with the ground; 18 hits to destroy; touching it gives the player item (player field `$6`) |
| `6F736` | palette flash | colour `$448` pulsed 3 times |

More families (together with the above and the bosses: **84 % of all waves**):

| Routine | Enemy | Behaviour |
|---|---|---|
| `6E03A` | missile silo | waits for a ground column boundary, inserts ground columns `$5A`/`$5B` (a launch tube) via `-$7FDC`, then every 90 frames a missile (`$6E07C`, hardware sprite `$230`, shootable) rises from y 204: −0.75 for 50 frames, then −2 for 77 |
| `6EA48` / `6EA40` | floating pod (106–109) | random y 32–95 (or `$78`), −0.75 px/frame; every 100 frames a ring of 8 shots (`$6FB2E`, angles `$100`…`$20`, 3 px/frame) |
| `6D816` `6D81E` `6D82C` `6D834` | ground turret (160, wreck 161) | y `$8E`/`$7E`; 3 volleys 10 or 50 frames apart, each up-left / left / down-left (`$70766`/`$70774`/`$70780`, fixed direction), then 50 frames rest |
| `6E400` (`6E3F0` ×2, `6E3F4` ×3, 50 frames apart) | drone (98/99) | random height, accelerates left (−`$3000`), can't be shot |
| `6E488` (`6E456`–`6E47C`: 4–26 jets, 10–50 frames apart) | jet (85) | from x 352, y 48–111, random vertical speed ±0.5, accelerates left (−`$2000`) |
| `6E8AE` (`6E886` ×6, `6E88A` ×9, firing) / `6E8D0` (`6E896`–`6E8A2` ×4–15) | dive plane (294/295 or 297/298) | from (128 or 192, 10), speed 1.625, turns ±2 every 2 frames for 128 frames (a half loop), then 2 px/frame; firing ones shoot like the helicopters |
| `6E99C` (`6E96C`–`6E990`: 3–16, 6–20 frames apart) | bouncing helicopter (100/101, squash 102/103) | from (335, 80), −1.5 px/frame, gravity 0.125, bounces off y `$98`; from level 5 each bounce may fire (random ≤ `$1800`) |
| `6ED8E` (`6ED84` ×4, `6ED88` ×6, `6ED8C` ×15, 32 frames apart) | seeker (288/289) | released at x `$145`, heights stepping 16 (wrapping 56–120); speed 3.1 slowing to 0.8, turns ≤ 16 a frame toward its target until past it |
| `6EACE` (`6EABE` / `6EAC2`, 28 frames apart) | blimp (83/84) | random y 32–95, −0.25 px/frame, zig-zags ±0.5 between y 64 and 134, score 8 |

Level 11 families (and their other group sizes elsewhere) — with these,
**94 % of all waves** (568/604) are decoded and level 11 is complete:

| Routine | Enemy | Behaviour |
|---|---|---|
| `6DF28` (`6DF1C` ×3, `6DF18` ×2, 127 frames apart) | armoured car (130/132, wreck 134) | on the ground at (360, `$8E`), +0.5 px/frame against the scroll |
| `6E130` (`6E10C`/`6E108`/`6E104` ×4/6/10, firing) / `6E152` (`6E118`–`6E124` ×14/10/6/4) | swirling plane (290/291) | from (32–287, 16) at angle 48–79, 1.25 px/frame for 85 frames, then turns ±8 per step for 100 steps, reversing at random (1 in 8) while above y 100 |
| `6DE6E` (`6DE5A` ×2, `6DE5E` ×4, 40 frames apart) | descender (104/105) | from (148–211, 0), x −0.19; y +0.19 for 200–263 frames, +0.06 for 200–263, then −0.19 for 400; fires (first after 100 frames) |
| `6D2B8` (`6D2AC`/`6D2A8`/`6D2A4` ×4/3/2) | hovering gunship (118/119) | from x 330 at y 50–113, −1 px/frame for 8–39 frames, stops, fires at each player 4–7 times 50 frames apart, leaves |
| `6DDAC` (`6DDA6` ×4, `6DDA2` ×3) | sinker column (110/112) | 8 frames apart from (358, 40), each 18 px lower; x −0.125, y +0.5 |
| `6ED3E` (`6FCFA` ×4) | low bomber (116/117) | y 134, −2 px/frame, a shot at angle `$70` every 10 frames |
| `6ECE6` (`6FCEE` ×4, `6ECDA` ×3) | dasher (114/115 → 116/117) | y 40, −1 for 100 frames, then −5 firing every 5 frames |
| `708A2` | screen clear | sets `-$67A0` (vehicle collision) for one frame, so every enemy on screen takes its "hit by vehicle" handler; then 7 palette flashes |
| `6D40A` | 3 AA guns, 38 frames apart | |
| `6DCF6` | a bomb at (330, 118) | |
| `6DE56` | nothing (jumps to `loc_6C6FE`) | |

Still generic: 36 waves from ~25 small families.

**Projectiles**: `loc_707C0` missiles/shells: 2.5 px/frame, hitbox ±8, fly
`d0` frames as fired (shell: straight up with extra upward acceleration), then
re-aim `d1` times every 5 frames turning ≤ 12 units; sprite `$210 + angle/8`
(hardware sprite). `$6FB6C` aimed shot: 3 px/frame, can't be shot.

Not decoded yet: the small families listed below as generic. Power-ups and
the bonus carrier: see their own section.

### Power-ups and the bonus carrier

Player struct (`-$7E0C` helicopter, `-$7D9A` jeep): `$4` hit flag, `$6` shield
timer, `$8` blink/invulnerability timer, `$A` double shot, `$C` speed,
`$E`/`$10` "already got it" markers, `$5E` fire delay.

- **Shield item** (`$6F5FE`, also released by every mine shot down via
  `$6FA40`): touching it (`$6F94E`) sets `$6 = −1`; `sub_6F520` turns that
  into 300 frames (`$12C`) during which the hit flag is cleared every frame,
  with an orb (`$6F680`, sprites 34/35) following the player; then
  `$8 = 100` frames of blinking invulnerability.
  **Shooting it 18 times** (`$6F92C`, sprites 36/37 from 3 hits left) makes it
  a smart bomb (`$6F6B6`): explosion, white flash, and one frame of the
  vehicle-collision flag `-$67A0` for whoever shot it, which destroys
  everything on screen.
- **Kill counter** (`sub_6FA8A`, on every scored kill unless a boss or a
  carrier is out): starts at 32 (`-$7EAE`), then reloads from `-$7EAC`
  (64, +8 per carrier, up to 104). At zero it sets `-$7FBE` (halves group
  sizes in `sub_6FACC`) and spawns the carrier.
- **Bonus carrier** (`$6FE20`, sprites 280/281): flies to (250, 64), gathers 4
  parts (`$7002E`, `$70086`, `$700E6`, `$7013E`, sprites 290–293; their exact
  layout, `sub_70212`, isn't decoded) 50 frames apart, waits 250 frames,
  then becomes shootable (16 hits, `$6FF54` makes the parts recoil) and
  hunts like the gunship, with a small chance each frame (500/65536) of a
  bomb + missile + aimed shots.
- **Rewards** (`$6FFAC` → `$6FFD8`): one icon per living player, drifting
  left at 0.25 and homing to y 80 (helicopter) or 118 (jeep); only its owner
  can take it (`$64` vs `-$7E36`). In order: **double shot** (icon 30,
  `$6E34C`: `$A = −1`) if not owned, else **speed + rapid fire** (icon 31,
  `$6E36A`: `$C = −1`, `$5E = 5`), else **points + 200 frames invulnerable**
  (icon 32, `$6E388`).

### Bosses

All bosses set `-$7E76 = 1` (the scroll step `sub_69C4A` skips while it's
non-zero), start unshootable while they arrive, and use the hit handler
`$6F8E0`: each hit decrements `$66` and flashes them for 3 frames (`$34`);
at zero `-$7E76 = 2` (level over), a 50-frame explosion runs (`sub_6F8CA`) and
the next level loads. Each of their attacks fires with probability 87.5 %
(`sub_6D3F4`: random ≤ `$E000`).

| Boss | Levels | Behaviour |
|---|---|---|
| `$705D0` gunship (sprites 240/242) | 1, 3, 5, 7, 9 | enters at (351, 64), −0.67 px/frame, 150 frames unshootable; `level×8 + 40` hits, hitbox ±16×±12, score 5. Loop: bomb (`$6DD16`), missile `$706EE` (dropped below it with acceleration, homes after 25 frames), an aimed shot at each player (`$6FB3A`), and from level 2 a drone (`$6E42E`, sprites 98/99, accelerates away left, can't be shot). Then for `(11 − level)×8 + 35` frames (`sub_70672`): accelerates (±`$600`) to stay within x 160–270 and moves at 0.375 px/frame toward the helicopter's height (or jeep x / 3 + 32, minimum y 40) |
| `$6DB1E` ground vehicle (209/229, rear part `$6DC42` 218/238 at x−18, y+32, hitbox ±32×±16; the remake assumes hits on it count against the boss, otherwise the jeep can't hit it) | 2, 4, 6, 8, 10 | enters at (368, 118), 110 frames unshootable, `level×8 + 40` hits. 14 rounds: aimed shots, a lobbed bomb (`$6DCB4`: after 0–31 frames thrown up at −2 and left at up to −4, then falls and rolls), an aimed missile (`$707BC`), 1 in 8 rounds 4 extra bombs; wait `(11 − level)×8 + 45` frames between rounds. Then forever: creep 1 px left every 14 frames bobbing ±1, firing a missile and a bomb each step, wrapping from x −32 back to 368 |
| `$70512` final boss (310–313) | 11 | stationary at (281, 98), 150 hits (`$6E224`: small explosion per hit; at zero → `$703DA`, game end). Loop: 125 frames on a random frame each frame, launching a firing helicopter (`$6E588`) every 8 frames; 50 × (random frame, sprite 80); then a pod (`$6D616`: sprites 80–82, drifts left at 0.5 px/frame, fires 32 bullets every 4 frames turning 12 units each — a spiral; bullets fly 2 px/frame for 25 frames then aim at a player once) |

### Sound

- Music/SFX player at `$71666`: jump table `init / play / ? / stop`.
  The start-up code points it at the sound bank **`$71D74`** (custom format: offset
  table to songs and instrument tables; song number in `d0`).
- A separate 15-instrument SoundTracker header `silkwormtitle` sits at `$7AAAC`
  (6 instruments, 10 patterns) — its samples are not stored after it, so it may be
  a leftover or uses the bank's samples.

### Text

Menus, high-score table, credits and the ending text are plain ASCII at
`$67A32–$6845F` (`$` is the line break). The credits screen lists the Random
Access team with joke nicknames; the Amiga programmer is Ronald “Pieket Weeserik”
MacDonald, the ST programmer John Croudy.

## Next steps

1. ~~Find the in-game palette~~ — done (see Graphics).
2. ~~Level backdrops~~, ~~enemy waves~~ and ~~full level maps~~ — done.
   Open: enemy flight paths (so the band could show where enemies actually fly),
   and the HUD/status panel layout.
3. Reverse the sound bank format and player → export tunes/SFX as .mod/.wav.
4. Name variables in the `$0080–$8080` block (scores, lives, positions) — useful
   for trainers, a patched default “2 joysticks” control setup, or a reimplementation.
