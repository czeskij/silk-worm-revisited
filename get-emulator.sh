#!/bin/sh
# Download FS-UAE 3.1.66 (official GitHub releases) into Emulator/FS-UAE
# for macOS (ARM64 + x86-64), Linux x86-64 and Windows x86-64.
set -e
cd "$(dirname "$0")"
BASE=https://github.com/FrodeSolheim/fs-uae/releases/download/v3.1.66
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for f in FS-UAE_3.1.66_macOS_ARM64.tar.xz FS-UAE_3.1.66_macOS_x86-64.tar.xz \
         FS-UAE_3.1.66_Linux_x86-64.tar.xz FS-UAE_3.1.66_Windows_x86-64.zip; do
    echo "Downloading $f"
    curl -fsSL -o "$TMP/$f" "$BASE/$f"
    mkdir -p "$TMP/x"
    case $f in
        *.zip) unzip -q -o "$TMP/$f" -d "$TMP/x" ;;
        *)     tar xf "$TMP/$f" -C "$TMP/x" ;;
    esac
done

mkdir -p Emulator
cp -R "$TMP/x/FS-UAE" Emulator/
chmod +x Emulator/FS-UAE/Linux/x86-64/fs-uae Emulator/FS-UAE/Linux/x86-64/fs-uae-device-helper
echo "FS-UAE installed in Emulator/FS-UAE"
