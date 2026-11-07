#!/usr/bin/env bash
# Monta dist/NimboPS5/ (pasta pronta para /data/pldmgr/payloads/) e o .zip
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(grep -o 'NIMBO_VERSION "[^"]*"' src/nimbo.h | cut -d'"' -f2)
rm -rf dist && mkdir -p dist/NimboPS5
cp nimbo-ps5.elf dist/NimboPS5/
cp assets/icon0.png dist/NimboPS5/icon0.png
cp docs/LEIA-ME.txt dist/NimboPS5/
(cd dist && zip -qr "NimboPS5-v$VER.zip" NimboPS5)
ls -la dist
