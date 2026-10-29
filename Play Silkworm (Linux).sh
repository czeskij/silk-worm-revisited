#!/bin/sh
# Run from a file manager ("Run as program") or a terminal.
cd "$(dirname "$0")" || exit 1
HERE="$PWD"
BIN="$HERE/Emulator/FS-UAE/Linux/x86-64"

if [ "$(uname -m)" = "x86_64" ]; then
    chmod +x "$BIN/fs-uae" "$BIN/fs-uae-device-helper" 2>/dev/null
    exec "$BIN/fs-uae" "$HERE/Silkworm.fs-uae" "$@"
fi

# Not x86-64 (e.g. a Raspberry Pi): use a system-wide FS-UAE if installed.
if command -v fs-uae >/dev/null 2>&1; then
    exec fs-uae "$HERE/Silkworm.fs-uae" "$@"
fi
echo "No FS-UAE build for $(uname -m). Install it with your package manager (e.g. 'sudo apt install fs-uae') and run this again." >&2
exit 1
