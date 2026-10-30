# Silkworm Revisited: the remake

A browser remake for two players that loads all graphics, levels and wave
scripts from **your own Silkworm ADF**. The code in this folder holds no game
data; `js/hints.js` only lists sprite numbers and group sizes per enemy routine.

## Run

Open `index.html` in Chrome, Edge or Firefox and pick your `Silkworm.adf`.
The browser keeps it (IndexedDB), so next time it starts straight away.

If the browser refuses to keep the file or doesn't see your pads when opened
as a local file, serve the folder instead:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/remake/>.

URL options (handy for testing): `?adf=path` loads a disk image from the
server, `?level=N` starts at level N, `?t=N` starts N pixels into the level
(4704 = boss), `?god=1` makes the players invulnerable.

## Controls

| | Helicopter (player 1) | Jeep (player 2) |
|---|---|---|
| Pad | first connected pad | second pad |
| Move | arrows | WASD |
| Fire (auto-repeat) | Space / Right Ctrl / M | Left Shift / F |
| Jump | — | up without fire, Q, or Circle/B |
| Aim gun | — | hold fire + up/down |

Pads: d-pad or left stick moves, Cross/Square/R1/R2 fire, Circle/Triangle jump,
Options pauses. Press fire on a vehicle's controller to join, also mid-game.
P or Esc pauses; N turns sound on/off; double-click goes fullscreen.

## What's faithful and what isn't (yet)

From the disassembly (see `../Research/NOTES.md`):
- 50 Hz game speed, 1 px ground scroll per frame, backdrop at half speed
- level backdrops, ground, scenery and palettes, read from the ADF
- the wave schedule of every level, the level length and the boss at the end
- helicopter and jeep movement, bounds, the jeep's jump (−3 px/frame, gravity
  0.125) and gun angles, fire rate and shot directions
- enemy behaviour for every one of the 604 waves (`js/enemies.js`), including
  paratroopers, dive bombers, transport planes and the distant background
  ships and planes: mines, tanks, missile launchers with homing missiles,
  helicopter groups, walkers with turrets, AA guns, missile silos, ground
  turrets, floating pods, drones, jets, dive planes, bouncing helicopters,
  seekers, blimps, armoured cars, swirling planes, descenders, hovering
  gunships, sinker columns, low bombers, dashers, power-ups, wrecks, scores,
  the screen flash and the screen clear
- shots and missiles with their real hardware-sprite graphics, pointing the
  way they fly
- the original sound effects (samples from your ADF, played at the game's
  periods and channels)
- enemy hit points as in the original (tanks take 6 hits, blimps 8, ...)
- the shield item (300 frames, rams enemies it touches; a second pickup while
  shielded, or 18 shots at it, sets off a smart bomb) and the bonus carrier: a
  helicopter whose four parts fly in and dock, coming after enough kills and
  dropping upgrades for each player: double shot, then speed + rapid fire,
  then points + invulnerability (upgrades are lost with a life)
- all three bosses: the gunship, the ground vehicle and the final boss, with
  their hit counts, movement and attack patterns; beating the final boss ends
  the game

Approximated for now:
- a few enemy details whose code wasn't fully followed (listed in
  `../Research/NOTES.md`): what the transport plane drops, the large ground
  vehicle's later movement, the emplacement's projectile, the swirling planes'
  loop speed
- losing upgrades on death is assumed
- no music yet, simple HUD
