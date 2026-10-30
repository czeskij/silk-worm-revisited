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
P or Esc pauses; double-click goes fullscreen.

## What's faithful and what isn't (yet)

From the disassembly (see `../Research/NOTES.md`):
- 50 Hz game speed, 1 px ground scroll per frame, backdrop at half speed
- level backdrops, ground, scenery and palettes, read from the ADF
- the wave schedule of every level, the level length and the boss at the end
- helicopter and jeep movement, bounds, the jeep's jump (−3 px/frame, gravity
  0.125) and gun angles, fire rate and shot directions
- enemy behaviour for 94 % of all waves, every wave on level 11
  (`js/enemies.js`): mines, tanks, missile launchers with homing missiles,
  helicopter groups, walkers with turrets, AA guns, missile silos, ground
  turrets, floating pods, drones, jets, dive planes, bouncing helicopters,
  seekers, blimps, armoured cars, swirling planes, descenders, hovering
  gunships, sinker columns, low bombers, dashers, power-ups, wrecks, scores,
  the screen flash and the screen clear
- shots and missiles with their real hardware-sprite graphics, pointing the
  way they fly
- all three bosses: the gunship, the ground vehicle and the final boss, with
  their hit counts, movement and attack patterns; beating the final boss ends
  the game

Approximated for now:
- the remaining enemy types (36 waves, 6 %) use a generic flying or ground
  behaviour with their real sprites
- power-up effect (shield + double shot) and the bonus carrier
- no sound, simple HUD
