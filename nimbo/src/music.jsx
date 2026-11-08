// Música de fundo: “Chill lofi inspired”, de omfgdude (CC0, opengameart.org).
// O mixer do PS5 React toca WAVs de até 10 s e não deixa parar um som já iniciado, então a
// faixa vem em 14 trechos de ~8,5 s (mono, 22 kHz; trechos longos aguentam o app ocupado sem cortar) com bordas de 0,35 s em fade cruzado:
// somados, reproduzem a faixa original. Ajustes valem na hora: o trecho que está tocando é
// abafado pelo volume geral até terminar, e os próximos já saem no volume novo.
import {useEffect} from 'react';
import {Sound} from '@ps5-react/core';
import {config, useStore} from './store.js';
import m1 from '../assets/music/music1.wav';
import m2 from '../assets/music/music2.wav';
import m3 from '../assets/music/music3.wav';
import m4 from '../assets/music/music4.wav';
import m5 from '../assets/music/music5.wav';
import m6 from '../assets/music/music6.wav';
import m7 from '../assets/music/music7.wav';
import m8 from '../assets/music/music8.wav';
import m9 from '../assets/music/music9.wav';
import m10 from '../assets/music/music10.wav';
import m11 from '../assets/music/music11.wav';
import m12 from '../assets/music/music12.wav';
import m13 from '../assets/music/music13.wav';
import m14 from '../assets/music/music14.wav';
const FILES = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14];

export const MUSIC_CREDIT = '“Chill lofi inspired”, de omfgdude · CC0 · opengameart.org';

const STEP_MS = 8513.33;          // duração da faixa / 14
const TAIL_MS = STEP_MS + 700;    // um trecho dura o passo + as duas bordas
let timer = null, restore = null, index = 0, started = 0, playing = false;
let lastStart = 0, lastVolume = 0;

function tick() {
  if (!playing) return;
  const {musicVolume} = config.get();
  Sound.play(FILES[index % FILES.length], {volume: musicVolume});
  lastStart = Date.now();
  lastVolume = musicVolume;
  index++;
  const due = started + index * STEP_MS;   // corrige o atraso acumulado dos timers
  timer = setTimeout(tick, Math.max(0, due - Date.now()));
}

// Abafa o que ainda está tocando (fator 0–1) até o último trecho acabar.
function duck(factor) {
  const left = lastStart + TAIL_MS - Date.now();
  if (restore) clearTimeout(restore);
  restore = null;
  if (left <= 0 || factor >= 1) { Sound.setVolume(1); return; }
  Sound.setVolume(Math.max(0, factor));
  restore = setTimeout(() => { restore = null; Sound.setVolume(1); }, left);
}

function startMusic() {
  if (playing) return;
  if (restore) { clearTimeout(restore); restore = null; Sound.setVolume(1); }
  playing = true;
  index = 0;
  started = Date.now();
  tick();
}

function stopMusic() {
  if (!playing) return;
  playing = false;
  if (timer) clearTimeout(timer);
  timer = null;
  duck(0);                                  // silencia o trecho em andamento já
}

// Liga, desliga e acompanha o volume conforme os Ajustes.
export function BackgroundMusic() {
  const on = useStore(config, c => !!c.music);
  const volume = useStore(config, c => c.musicVolume);
  useEffect(() => { if (on) startMusic(); else stopMusic(); }, [on]);
  useEffect(() => { if (playing && lastVolume) duck(volume / lastVolume); }, [volume]);
  return null;
}
