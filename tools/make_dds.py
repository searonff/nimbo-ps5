"""Converte PNG em pic0.dds/pic1.dds do PS5 (3840x2160, BC7, cores lineares, como os do sistema).
Uso: python3 tools/make_dds.py entrada.png saida.dds"""
import struct, sys
import numpy as np
import etcpak
from PIL import Image

W, H = 3840, 2160

def header():
    pf = struct.pack('<II4s5I', 32, 0x4, b'DX10', 0, 0, 0, 0, 0)
    h = struct.pack('<7I', 124, 0xA1007, H, W, W * H, 1, 1) + b'\0' * 44 + pf + struct.pack('<5I', 0x1000, 0, 0, 0, 0)
    return b'DDS ' + h + struct.pack('<5I', 98, 3, 0, 1, 1)

src, out = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(src).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)   # o PS5 guarda em linear
rng = np.random.default_rng(7)
q = np.clip(lin * 255 + rng.uniform(-0.5, 0.5, lin.shape), 0, 255).astype(np.uint8)  # dither contra faixas no céu escuro
rgba = np.dstack([q, np.full((H, W, 1), 255, np.uint8)])
data = etcpak.compress_bc7(rgba.tobytes(), W, H)
open(out, 'wb').write(header() + data)
