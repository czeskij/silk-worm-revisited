#!/bin/bash
# Double-click in Finder to play.
cd "$(dirname "$0")" || exit 1
HERE="$PWD"

case "$(uname -m)" in
    arm64) ARCH=ARM64 ;;
    *)     ARCH=x86-64 ;;
esac
APP="$HERE/Emulator/FS-UAE/macOS/$ARCH/FS-UAE.app"

# Files copied from another computer or a download get quarantined by
# Gatekeeper; clear it once so the bundled emulator can start.
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null

"$APP/Contents/MacOS/fs-uae" "$HERE/Silkworm.fs-uae" "$@" &
disown
# Close the Terminal window that Finder opened for this script.
osascript -e 'tell application "Terminal" to close (every window whose name contains "Play Silkworm")' >/dev/null 2>&1 &
exit 0
