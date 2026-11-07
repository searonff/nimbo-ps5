# Gera assets/icon0.png (512x512) — nuvem com seta de download.
from PIL import Image, ImageDraw, ImageFilter
S = 512; SS = 4; W = S * SS
img = Image.new("RGB", (W, W))
px = img.load()
top, bot = (22, 40, 92), (88, 46, 170)
for y in range(W):
    t = y / (W - 1)
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    for x in range(W):
        px[x, y] = c
d = ImageDraw.Draw(img)
def circ(cx, cy, r, fill):
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=fill)
white = (245, 248, 255)
# nuvem
circ(200, 250, 78, white); circ(290, 215, 100, white); circ(370, 270, 66, white)
d.rounded_rectangle([120 * SS, 250 * SS, 420 * SS, 336 * SS], radius=43 * SS, fill=white)
# seta
ac = (60, 70, 170)
d.rectangle([243 * SS, 215 * SS, 281 * SS, 300 * SS], fill=ac)
d.polygon([(205 * SS, 290 * SS), (319 * SS, 290 * SS), (262 * SS, 352 * SS)], fill=ac)
# barra (bandeja)
d.rounded_rectangle([170 * SS, 385 * SS, 354 * SS, 410 * SS], radius=12 * SS, fill=white)
img = img.resize((S, S), Image.LANCZOS)
img.save("assets/icon0.png", optimize=True)
