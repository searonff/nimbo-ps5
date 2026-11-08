"""Fundo da tela inicial do PS5 (sce_sys/pic0.png): céu + nuvens + marca Nimbo Downloader à direita."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import sys
K = int(sys.argv[1]) if len(sys.argv) > 1 else 1
OUTF = sys.argv[2] if len(sys.argv) > 2 else None
N = os.path.join(os.path.dirname(__file__), '..', 'nimbo')
A = os.path.join(N, 'assets', 'art')
img = Image.open(os.path.join(A, 'sky.png')).convert('RGBA').resize((1920 * K, 1080 * K), Image.LANCZOS)
for f, x, y, s in [('cloud2.png', -120, 600, 1.3), ('cloud1.png', 1150, 520, 1.1), ('cloud3.png', 520, 720, 1.5), ('cloud1.png', 1500, 790, 1.4)]:
    c = Image.open(os.path.join(A, f)).convert('RGBA')
    c = c.resize((int(c.width * s), int(c.height * s)))
    c = c.resize((c.width * K, c.height * K), Image.LANCZOS)
    img.alpha_composite(c, (x * K, y * K))
S = 260 * K
icon = Image.open(os.path.join(N, 'sce_sys', 'icon0.png')).convert('RGBA').resize((S, S))
m = Image.new('L', icon.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], 58 * K, fill=255)
icon.putalpha(m)
sh = Image.new('RGBA', (S + 120 * K, S + 120 * K), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([60 * K, 70 * K, S + 60 * K, S + 70 * K], 58 * K, fill=(0, 0, 0, 140))
sh = sh.filter(ImageFilter.GaussianBlur(28 * K))
cx, cy = 1390 * K, 330 * K
img.alpha_composite(sh, (cx - S // 2 - 60 * K, cy - 60 * K)); img.alpha_composite(icon, (cx - S // 2, cy))
d = ImageDraw.Draw(img)
fh = ImageFont.truetype(os.path.join(N, 'assets', 'Nunito-ExtraBold.ttf'), 96 * K)
fs = ImageFont.truetype(os.path.join(N, 'assets', 'Nunito-SemiBold.ttf'), 38 * K)
# Só o nome: a imagem da tela inicial é fixa e o app tem vários idiomas.
for txt, f, y, col in [('Nimbo Downloader', fh, cy + S + 30 * K, (242, 245, 249, 255))]:
    w = d.textlength(txt, font=f)
    d.text((cx - w / 2 + 3 * K, y + 4 * K), txt, font=f, fill=(5, 10, 20, 120))
    d.text((cx - w / 2, y), txt, font=f, fill=col)
img.convert('RGB').save(OUTF or os.path.join(N, 'sce_sys', 'pic0.png'), optimize=True)
