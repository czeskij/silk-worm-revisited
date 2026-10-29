# Silkworm revisited

A portable, gamepad-friendly setup for playing the Amiga version of **Silkworm**
(Virgin / The Sales Curve, 1989) in two-player co-op on macOS, Windows and Linux,
plus a reverse-engineering notebook of how the game works.

Not included: the game disk and the Kickstart ROM. Both are copyrighted, so
use your own.

## Play

1. Put your files in place:
   - `Data/Floppies/Silkworm.adf`: the game disk
   - `Data/Kickstarts/kick13.rom`: Kickstart 1.3 (A500)
2. Get the emulator (FS-UAE 3.1.66, downloaded from its GitHub releases):
   - macOS / Linux: `./get-emulator.sh`
   - Windows: `get-emulator.ps1` (right-click → Run with PowerShell)
3. Pair one or two pads (DualShock 4 / DualSense tested), then run
   `Play Silkworm (macOS).command`, `Play Silkworm (Windows).bat` or
   `Play Silkworm (Linux).sh`.

Controls and pad pairing are described in [README.txt](README.txt). On the title
screen, use the function keys to set each vehicle to a joystick (by default
the game puts one of them on the keyboard).

## Reverse engineering

[Research/NOTES.md](Research/NOTES.md) covers the disk format, the boot loader,
memory map, controls, sprite bank, palettes, level backdrops and enemy wave
scripts. Extracted images:

- `Research/loading_screen.png`
- `Research/sprites.png`, `Research/sprites_by_level/`
- `Research/levels/level_NN.png`: scrolling backdrop of each level
- `Research/waves/`: enemy waves per level, and a legend of enemy types
- `Research/maps/map_level_NN.png`: full map of each level with scenery and
  where every enemy wave comes in

Regenerate everything (including the disassembly listings, which aren't
committed) from your own ADF with the scripts in `Research/tools/`. They need
Python 3, and `pip install capstone` for the disassembler. The commands are in
the notes.
