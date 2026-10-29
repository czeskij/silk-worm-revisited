// Keyboard and gamepads -> the game's joystick byte.
// Bits as read by $6AFA0: 1 up, 2 down, 4 left, 8 right, $80 fire.
// Extra bit $40 = jump (the game derives it from "up without fire" for the jeep).
"use strict";

SW.input = (function () {
  const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, JUMP = 0x40, FIRE = 0x80;
  const keys = new Set();
  const KEYMAPS = [
    // heli: arrows + Space / Right Ctrl / M
    { ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT, Space: FIRE, ControlRight: FIRE, KeyM: FIRE },
    // jeep: WASD + Left Shift / F, Q = jump
    { KeyW: UP, KeyS: DOWN, KeyA: LEFT, KeyD: RIGHT, ShiftLeft: FIRE, KeyF: FIRE, KeyQ: JUMP },
  ];
  let swapped = false;

  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  function pads() {
    return (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).filter((p) => p && p.connected);
  }

  function padBits(p) {
    const b = (i) => p.buttons[i] && p.buttons[i].pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    let v = 0;
    if (b(12) || ay < -0.45) v |= UP;
    if (b(13) || ay > 0.45) v |= DOWN;
    if (b(14) || ax < -0.45) v |= LEFT;
    if (b(15) || ax > 0.45) v |= RIGHT;
    if (b(0) || b(2) || b(7) || b(5)) v |= FIRE;   // Cross/A, Square/X, R2, R1
    if (b(1) || b(3)) v |= JUMP;                   // Circle/B, Triangle/Y
    return v;
  }

  // Player 0 = helicopter, 1 = jeep. First pad -> heli, second -> jeep;
  // the keyboard always works too.
  function read(player) {
    const slot = swapped ? 1 - player : player;
    let v = 0;
    for (const code in KEYMAPS[player]) if (keys.has(code)) v |= KEYMAPS[player][code];
    const p = pads()[slot];
    if (p) v |= padBits(p);
    return v;
  }

  function pressed(code) { return keys.has(code); }
  function anyPadButton(i) { return pads().some((p) => p.buttons[i] && p.buttons[i].pressed); }

  return {
    UP, DOWN, LEFT, RIGHT, JUMP, FIRE, read, pressed, anyPadButton, pads,
    swap() { swapped = !swapped; }, get swapped() { return swapped; },
  };
})();
