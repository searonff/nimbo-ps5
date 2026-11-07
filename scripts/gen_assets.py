#!/usr/bin/env python3
"""Gera src/gen/assets.c com a interface web, o ícone e o pacote de certificados CA."""
import os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
web = os.path.join(root, "web")
out = os.path.join(root, "src", "gen", "assets.c")
cacert = sys.argv[1] if len(sys.argv) > 1 else "/etc/ssl/certs/ca-certificates.crt"
MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"}
def arr(name, data):
    body = ",".join(str(b) for b in data)
    return f"const unsigned char {name}[] = {{{body},0}};\nconst size_t {name}_len = {len(data)};\n"
os.makedirs(os.path.dirname(out), exist_ok=True)
parts = ['#include "../nimbo.h"\n']
entries = []
files = sorted(os.listdir(web))
for i, fn in enumerate(files):
    data = open(os.path.join(web, fn), "rb").read()
    parts.append(arr(f"a{i}", data))
    entries.append(f'  {{ "/{fn}", "{MIME.get(os.path.splitext(fn)[1], "application/octet-stream")}", a{i}, {len(data)} }},')
icon = open(os.path.join(root, "assets", "icon0.png"), "rb").read()
parts.append(arr("g_icon0", icon))
entries.append(f'  {{ "/icon.png", "image/png", g_icon0, {len(icon)} }},')
parts.append(arr("g_cacert", open(cacert, "rb").read()))
parts.append("const asset_t g_assets[] = {\n" + "\n".join(entries) + "\n};\n")
parts.append(f"const size_t g_assets_count = {len(entries)};\n")
open(out, "w").write("".join(parts))
print("gerado", out, len(entries), "arquivos")
