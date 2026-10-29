SILKWORM - portable Amiga 500 setup (FS-UAE 3.1.66)
====================================================

Copy this whole folder anywhere (USB stick, cloud drive) and run:

  macOS    Play Silkworm (macOS).command      (Apple Silicon and Intel)
  Windows  Play Silkworm (Windows).bat        (64-bit)
  Linux    Play Silkworm (Linux).sh           (x86-64; other CPUs use system fs-uae)

First run on macOS: if Finder says it can't be opened, right-click the
.command file -> Open -> Open. After that a double-click works.

TWO PLAYERS
-----------
Pair both pads over Bluetooth BEFORE starting the game.
  Pad 1 -> player 1 (helicopter)      Pad 2 -> player 2 (jeep)
No pad: arrow keys + Right Ctrl (or Right Alt) = player 1.

Pairing a DualShock 4: hold SHARE + PS until the light bar flashes fast,
then pick "Wireless Controller" / "DUALSHOCK 4" in Bluetooth settings.

BUTTONS (DualShock 4 / DualSense; other pads FS-UAE knows use the same layout)
---------------------------------------------------
  D-pad or left stick    move
  Cross                  fire
  Circle                 up  (jeep: jump, without pushing the stick up)
  Triangle               fire
  R1 / L1                up / down
  R2 (hold)              autofire
  L2                     toggle autofire on/off
  Share / Select         pause
  Options / Start        FS-UAE menu: save/load state, swap, quit

KEYBOARD
--------
  F12              FS-UAE menu (save states, quit)
  Alt+Enter        (Cmd+F on macOS) toggle fullscreen
  Alt+F4 / Cmd+Q   quit

FILES
-----
  Silkworm.fs-uae          settings (video, controllers, model)
  Data/Floppies            game disk
  Data/Kickstarts          kick13.rom (used) and kick31.rom (spare)
  Data/Controllers         pad layouts for SDL's DS4/DualSense driver
  Data/Save States         your save states (created on first save)
  Emulator/FS-UAE          FS-UAE 3.1.66 binaries for each OS
