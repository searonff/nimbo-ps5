"""Nuvens do fundo do Nimbo (precisa de tools/sky_base.png, o céu sem nuvens soltas): cúmulos com volume (topo iluminado, base em sombra e
borda quente do lado do pôr do sol, que fica à direita no céu). Gera o sky.png com as nuvens pintadas."""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = os.path.join(os.path.dirname(__file__), '..', 'nimbo', 'assets', 'art')
SIZES = [(460, 200), (340, 150), (620, 250), (400, 170), (520, 220), (280, 130)]

LIT = (214, 214, 238)      # topo, luz fria do céu
SHADE = (78, 86, 132)    # base, mesma família do mar de nuvens do sky.png
WARM = (255, 190, 140)     # reflexo do pôr do sol


def mask_for(w, h, rnd):
    """Silhueta: base de elipses achatadas + lóbulos redondos, maiores no meio.
    Tudo fica dentro de uma margem, para o desfoque não bater na borda da imagem."""
    mx, my = w * .1, h * .14
    iw, ih = w - 2 * mx, h - 2 * my
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    base = my + ih * .78
    # base: elipses achatadas encadeadas (fundo levemente ondulado, pontas arredondadas)
    k = 6
    for i in range(k):
        t = i / (k - 1)
        rx = iw * rnd.uniform(.14, .2) * (1 - abs(t - .5) * .5)
        ry = ih * rnd.uniform(.13, .18)
        cx = mx + iw * (.12 + .76 * t)
        d.ellipse([cx - rx, base - ry, cx + rx, base + ry * .7], fill=255)
    n = rnd.randint(6, 9)
    for i in range(n):
        t = i / (n - 1)
        bulge = 1 - abs(t - .5) * 1.5                      # lóbulos do centro sobem mais
        r = ih * (.16 + .26 * max(0, bulge)) * rnd.uniform(.85, 1.12)
        cx = mx + iw * (.14 + .72 * t) + rnd.uniform(-8, 8)
        cy = base - r * rnd.uniform(.5, .85)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def shade(w, h, m, rnd):
    """Cor por pixel: gradiente vertical + borda iluminada no alto + calor à direita."""
    grad = Image.new('RGB', (w, h))
    gp = grad.load()
    for y in range(h):
        t = min(1, max(0, (y / h - .15) / .7))
        c = tuple(int(LIT[i] + (SHADE[i] - LIT[i]) * t ** 1.3) for i in range(3))
        for x in range(w):
            gp[x, y] = c
    # luz quente vindo da direita, mais forte nas bordas da silhueta
    edge = ImageChops.subtract(m, m.filter(ImageFilter.GaussianBlur(h * .12)))
    warm = Image.new('L', (w, h), 0)
    wp, ep = warm.load(), edge.load()
    for y in range(h):
        for x in range(w):
            k = (x / w) ** 2 * (1 - y / h * .4)
            wp[x, y] = min(255, int(ep[x, y] * 3 * k + 60 * k))
    return Image.composite(Image.new('RGB', (w, h), WARM), grad, warm.point(lambda v: int(v * .7)))


def make(seed, w, h, opacity):
    rnd = random.Random(seed)
    m = mask_for(w, h, rnd)
    soft = m.filter(ImageFilter.GaussianBlur(max(3, h * .045)))
    rgb = shade(w, h, soft, rnd)
    # opacidade já embutida: o app desenha a nuvem no tamanho do arquivo e sem "opacity",
    # o caminho mais barato do renderizador (que desenha tudo na CPU).
    img = rgb.convert('RGBA')
    img.putalpha(soft.point(lambda v: int(min(255, v * 1.05) * .82 * opacity)))
    return img


# Tudo estático, pintado direto no céu: o renderizador do PS5 React desenha na CPU e nuvens
# em movimento redesenhariam, a cada quadro, a área delas e os painéis por cima.
sky = Image.open(os.path.join(os.path.dirname(__file__), 'sky_base.png')).convert('RGBA')
CLOUDS = [
    # longe: pequenas e apagadas, no alto
    (320, 140, 1460, 60, .3), (220, 100, 640, 120, .28), (260, 110, 170, 30, .26), (200, 90, 1090, 210, .3),
    (300, 130, 1700, 290, .24), (240, 100, 360, 300, .25),
    # meio
    (390, 170, 60, 150, .5), (360, 150, 1240, 140, .48), (420, 180, 760, 330, .46),
    # perto: maiores e mais nítidas, descendo para o mar de nuvens
    (680, 275, 1180, 470, .7), (520, 220, 140, 520, .66), (410, 180, 700, 640, .62),
]
for i, (w, h, x, y, op) in enumerate(CLOUDS):
    sky.alpha_composite(make(300 + i, w, h, op), (x, y))
sky.convert('RGB').save(os.path.join(OUT, 'sky.png'), optimize=True)
print('ok')
