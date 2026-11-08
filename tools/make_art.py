"""Arte original do Nimbo: céu de anoitecer sobre um mar de nuvens, nuvens soltas e telas do sistema."""
import random, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont
OUT = os.path.join(os.path.dirname(__file__), '..', 'nimbo')
random.seed(11)
W, H = 1920, 1080

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def sky(w, h):
    img = Image.new('RGB', (w, h))
    px = img.load()
    top, mid, low = (12, 22, 40), (24, 40, 70), (78, 62, 92)
    for y in range(h):
        t = y / (h - 1)
        c = lerp(top, mid, t / .62) if t < .62 else lerp(mid, low, (t - .62) / .38)
        for x in range(w):
            px[x, y] = c
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse([w * .45, h * .62, w * 1.15, h * 1.25], fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    img = Image.composite(Image.new('RGB', (w, h), (255, 176, 92)), img, glow.point(lambda v: int(v * .55)))
    d = ImageDraw.Draw(img)
    for _ in range(140):                      # estrelas discretas no alto
        x, y = random.randrange(w), random.randrange(int(h * .45))
        r = random.choice((1, 1, 1, 2))
        a = random.randint(60, 170)
        d.ellipse([x, y, x + r, y + r], fill=lerp((12, 22, 40), (230, 236, 255), a / 255))
    return img

def cloud_bank(w, h, y0, color, alpha, blur, n, seed):
    rnd = random.Random(seed)
    m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
    x = -100
    while x < w + 100:
        r = rnd.randint(int(h * .07), int(h * .14))
        d.ellipse([x - r, y0 - r * .8, x + r, y0 + r * .8], fill=255)
        x += rnd.randint(int(r * .6), int(r * 1.1))
    d.rectangle([0, y0, w, h], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * alpha))
    return Image.new('RGB', (w, h), color), m

bg = sky(W, H)
for y0, col, al, bl, seed in ((int(H * .80), (52, 62, 98), .85, 26, 1), (int(H * .87), (70, 78, 116), .9, 20, 2), (int(H * .94), (96, 98, 136), .95, 14, 3)):
    c, m = cloud_bank(W, H, y0, col, al, bl, 0, seed)
    bg.paste(c, (0, 0), m)
bg.save(f'{OUT}/assets/art/sky.png', optimize=True)

def puff(w, h, seed):
    rnd = random.Random(seed)
    m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
    base = h * .62
    for i in range(7):
        r = rnd.randint(int(h * .18), int(h * .34))
        cx = w * (.15 + .7 * i / 6) + rnd.randint(-12, 12)
        d.ellipse([cx - r, base - r * 1.2, cx + r, base + r * .5], fill=255)
    d.rounded_rectangle([w * .08, base - h * .08, w * .92, base + h * .16], radius=int(h * .12), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(10))
    img = Image.new('RGBA', (w, h), (214, 222, 245, 0))
    img.putalpha(m.point(lambda v: int(v * .16)))
    return img

for i, (w, h) in enumerate(((420, 150), (300, 110), (520, 180))):
    puff(w, h, 40 + i).save(f'{OUT}/assets/art/cloud{i + 1}.png')

icon = Image.open(os.path.join(os.path.dirname(__file__), '..', 'assets', 'icon0.png')).convert('RGB')
icon.resize((512, 512)).save(f'{OUT}/sce_sys/icon0.png')
font = ImageFont.truetype(f'{OUT}/assets/Nunito-ExtraBold.ttf', 120)
for name, with_logo in (('pic0', False), ('pic1', True)):
    p = bg.copy()
    if with_logo:
        lg = icon.resize((220, 220))
        mask = Image.new('L', (220, 220), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 219, 219], 50, fill=255)
        p.paste(lg, (W // 2 - 110, H // 2 - 220), mask)
        d = ImageDraw.Draw(p)
        tw = d.textlength('Nimbo', font=font)
        d.text((W // 2 - tw / 2, H // 2 + 20), 'Nimbo', font=font, fill=(242, 245, 249))
    p.save(f'{OUT}/sce_sys/{name}.png')
print('ok')
