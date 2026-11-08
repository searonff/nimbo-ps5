#!/usr/bin/env python3
"""Compõe a música de fundo original do Nimbo, em estilo lo-fi, por síntese.

Loop de 16 compassos (78 bpm, ~49 s): bateria com swing (bumbo, caixa e
chimbal), Rhodes com acordes de jazz, baixo macio, melodia de piano, chiado de
vinil, oscilação de fita (wow/flutter) e master abafado. É dividido em 6
segmentos WAV de menos de 10 s (limite do mixer do PS5 React) com bordas
sobrepostas; a interface toca um a cada L segundos e as bordas se cruzam sem
emenda.

Uso: python3 tools/compose_music.py app/assets/music [prévia.wav]
"""
import sys, os, wave
import numpy as np
from scipy.signal import lfilter, butter

SR = 32000
BPM = 78
BEAT = 60.0 / BPM
BARS = 16
LOOP = BARS * 4 * BEAT
SEGMENTS = 16
XFADE = 0.35
SWING = 0.58          # colcheia "atrasada" (lo-fi)
rng = np.random.default_rng(78)

def hz(n): return 440.0 * 2 ** ((n - 69) / 12)

# progressão (2 compassos cada) em Si bemol: Ebmaj9, Dm7(9), Cm9, F13
CHORDS = [
    [51, 55, 58, 62, 65],
    [50, 53, 57, 60, 64],
    [48, 51, 55, 58, 62],
    [53, 57, 63, 62, 67],
]
ROOTS = [39, 38, 36, 41]
# melodia original de piano: (beat, duração em beats, nota MIDI)
MELODY = [
    (1.5, .5, 70), (2, 1, 74), (3.5, .5, 72), (4, 2, 70), (7, .5, 67), (7.5, 1.5, 69),
    (9.5, .5, 69), (10, 1, 72), (11.5, .5, 70), (12, 3, 69),
    (17.5, .5, 67), (18, 1, 70), (19, .5, 72), (19.5, 1.5, 74), (22, 1, 72), (23, 1, 70), (24, 3, 67),
    (33.5, .5, 70), (34, 1, 74), (35.5, .5, 77), (36, 2, 75), (39, 1, 74), (40, 2, 72), (42.5, 1, 70),
    (49.5, .5, 72), (50, 1, 70), (51, 1, 69), (52, 2, 67), (55, .5, 65), (56, 5, 67),
]

N_TOTAL = int(SR * LOOP * 2) + SR
out = np.zeros((N_TOTAL, 2))
drums = np.zeros((N_TOTAL, 2))

def add(buf, sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.4142, np.sin((pan + 1) * np.pi / 4) * 1.4142
    for off in (0, int(LOOP * SR)):          # escreve nos dois loops (caudas envolvem)
        a = i + off
        if a < 0 or a >= N_TOTAL: continue
        n = min(len(sig), N_TOTAL - a)
        buf[a:a + n, 0] += sig[:n] * gain * gl
        buf[a:a + n, 1] += sig[:n] * gain * gr

def env(n, a, r):
    e = np.ones(n)
    na = min(int(a * SR), n); nr = min(int(r * SR), n - na)
    e[:na] = np.linspace(0, 1, na)
    if nr > 0: e[n - nr:] = np.linspace(1, 0, nr) ** 1.5
    return e

def lp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'low'); return lfilter(b, a, x)

def hp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'high'); return lfilter(b, a, x)

def bp(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return lfilter(b, a, x)

# ---------- Rhodes ----------
def rhodes(f, dur, vel=1.0):
    n = int((dur + 1.2) * SR); t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * t) * (1.6 * vel) * np.exp(-t * 5)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 0.9)
    x += 0.18 * np.sin(2 * np.pi * f * 4.01 * t) * np.exp(-t * 9)
    x *= 1 + 0.12 * np.sin(2 * np.pi * 5.2 * t)
    e = np.ones(n); rel = int(0.35 * SR); off = min(int(dur * SR), n)
    m = min(rel, n - off)
    e[off:off + m] = np.linspace(1, 0, m); e[off + m:] = 0
    return x * e * env(n, 0.003, 0)

for ci in range(8):
    chord = CHORDS[ci % 4]
    base = ci * 8 * BEAT
    for hit, dur in ((0, 3.4), (3.5 + (SWING - .5), 0.8), (4.0, 3.2), (7.5 + (SWING - .5), 0.45)):
        for k, note in enumerate(chord):
            strum = k * 0.012 + rng.uniform(0, .006)
            add(out, rhodes(hz(note), dur * BEAT, 0.8), base + hit * BEAT + strum, (k - 2) * 0.18, 0.055)

# ---------- baixo ----------
def bass(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
    return np.tanh(1.5 * x) * env(n, 0.012, 0.12)

BASS_RHYTHM = [(0, 1.4, 0), (1.5 + (SWING - .5), .5, 0), (2.5, 1, 7), (4, 1.5, 0), (6, .5, 12), (6.5, 1.3, 10)]
for ci in range(8):
    root = ROOTS[ci % 4]
    for b, d, iv in BASS_RHYTHM:
        add(out, bass(hz(root + iv), d * BEAT), ci * 8 * BEAT + b * BEAT, 0, 0.16)

# ---------- melodia (piano macio com eco) ----------
def piano(f, dur):
    n = int((dur + 1.5) * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.6) + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
    x += 0.08 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 5)
    return lp(x * env(n, 0.004, 0.4), 3500)

for b, d, note in MELODY:
    sw = (SWING - .5) * BEAT if (b % 1) == .5 else 0
    for delay, g, pan in ((0, 1, .15), (.75 * BEAT, .3, -.45), (1.5 * BEAT, .12, .45)):
        add(out, piano(hz(note), d * BEAT), b * BEAT + sw + delay + rng.uniform(0, .01), pan, 0.075 * g)

# ---------- bateria (boom-bap com swing) ----------
def kick():
    n = int(.45 * SR); t = np.arange(n) / SR
    f = 52 + 70 * np.exp(-t * 28)
    return np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7))

def snare():
    n = int(.35 * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 22)
    noise = bp(rng.standard_normal(n), 1200, 6000) * np.exp(-t * 14)
    return (0.5 * body + 0.9 * noise) * env(n, .001, .05)

def hat(open_=False):
    n = int((.25 if open_ else .07) * SR); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t * (14 if open_ else 60))

K, S = kick(), snare()
KICKS = [[0, 1.5 + (SWING - .5), 2.5], [0, 2.25, 2.75]]
for bar in range(BARS):
    base = bar * 4 * BEAT
    for k in KICKS[bar % 2]:
        add(drums, K, base + k * BEAT + rng.uniform(0, .008), 0, 0.42)
    for s in (1, 3):
        add(drums, S, base + s * BEAT + 0.018 + rng.uniform(0, .01), 0.05, 0.26)
    if bar % 4 == 3:
        add(drums, S, base + 3.75 * BEAT, 0.05, 0.10)            # nota fantasma
    for e in range(8):
        pos = e // 2 + (SWING if e % 2 else 0)
        op = (e == 7 and bar % 2 == 1)
        vel = 0.10 if e % 2 == 0 else 0.065
        add(drums, hat(op), base + pos * BEAT + rng.uniform(0, .006), 0.3, vel * (1.6 if op else 1))

# instrumental "respira" quando o bumbo bate (sidechain)
duck = np.ones(N_TOTAL)
dk = 1 - 0.35 * np.exp(-np.arange(int(.3 * SR)) / SR * 9)
for bar in range(BARS * 2):
    for k in KICKS[bar % 2]:
        a = int((bar * 4 + k) * BEAT * SR)
        if a < N_TOTAL:
            m = min(len(dk), N_TOTAL - a); duck[a:a + m] = np.minimum(duck[a:a + m], dk[:m])
out *= duck[:, None]

# ---------- reverb (Schroeder) ----------
def reverb(x, mix=0.22):
    y = np.zeros_like(x)
    for d, g in ((1557, .82), (1617, .81), (1491, .82), (1422, .81)):
        d = int(d * SR / 44100); b = np.zeros(d + 1); b[d] = 1; a = np.zeros(d + 1); a[0] = 1; a[d] = -g
        y += lfilter(b, a, x)
    for d, g in ((225, .5), (556, .5)):
        d = int(d * SR / 44100); b = np.zeros(d + 1); b[0] = -g; b[d] = 1; a = np.zeros(d + 1); a[0] = 1; a[d] = -g
        y = lfilter(b, a, y)
    return x * (1 - mix) + y * mix * 0.25

for k in range(2):
    out[:, k] = reverb(out[:, k])
    drums[:, k] = reverb(drums[:, k], 0.1)
mix = out + drums

# ---------- "fita": wow/flutter, saturação e master abafado ----------
L_loop = int(LOOP * SR)
t = np.arange(N_TOTAL) / SR
cyc = 2 * np.pi / LOOP          # modulações inteiras por loop: não quebram a emenda
pos = np.arange(N_TOTAL) + (np.sin(cyc * 18 * t) * 0.0028 + np.sin(cyc * 140 * t + 1) * 0.0004) * SR
pos = np.clip(pos, 0, N_TOTAL - 1)
for k in range(2):
    mix[:, k] = np.interp(pos, np.arange(N_TOTAL), mix[:, k])
mix = np.tanh(mix * 1.3) / 1.3
for k in range(2):
    mix[:, k] = lp(hp(mix[:, k], 35), 5200, 2)

# chiado e estalos de vinil
crackle = hp(lp(rng.standard_normal(L_loop), 6000), 1500) * 0.012
for p in rng.choice(L_loop - 64, size=int(LOOP * 9), replace=False):
    w = int(rng.integers(8, 40))
    crackle[p:p + w] += rng.uniform(-1, 1) * 0.12 * np.exp(-np.arange(w) / 6)
crackle = lp(crackle, 7000)

loop = mix[L_loop:2 * L_loop].copy()
# chiado de vinil desligado: soava como chuva
loop -= loop.mean(axis=0)
loop *= 0.13 / np.sqrt((loop ** 2).mean())
loop = np.tanh(loop * 1.15) / 1.15
peak = np.abs(loop).max()
if peak > 0.92: loop *= 0.92 / peak

def save(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

outdir = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(outdir, exist_ok=True)
for f in os.listdir(outdir):
    if f.startswith("music") and f.endswith(".wav"): os.remove(os.path.join(outdir, f))
N = len(loop); L = N / SEGMENTS; X = int(XFADE * SR)
for i in range(SEGMENTS):
    a = int(round(i * L)) - X; b = int(round((i + 1) * L)) + X
    seg = loop[np.arange(a, b) % N].copy()
    ramp = np.linspace(0, 1, 2 * X)[:, None]
    seg[:2 * X] *= ramp; seg[-2 * X:] *= ramp[::-1]
    save(os.path.join(outdir, f"music{i + 1}.wav"), seg)
if len(sys.argv) > 2:
    save(sys.argv[2], np.concatenate([loop, loop]))
print(f"loop {LOOP:.3f}s, {SEGMENTS} segmentos de {(L + 2 * X) / SR:.2f}s, um a cada {LOOP / SEGMENTS * 1000:.1f} ms")
