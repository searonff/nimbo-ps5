// Unidades de armazenamento disponíveis (PS5: SSD interno, USB e armazenamento estendido).
//
// Apagar um arquivo grande num HD USB (exFAT) prende o disco por vários segundos. Qualquer
// leitura feita nesse tempo pela linha principal (espaço livre, listar pasta) espera junto e
// congela a tela e a música. Por isso: o espaço livre fica em cache, e enquanto houver uma
// exclusão em andamento (removeSafely) ninguém lê o disco; tudo se atualiza quando ela termina.
import {FileSystem, Platform} from '@ps5-react/core';
import {ui} from './store.js';

let busy = 0;
let cache = null, cacheAt = 0;

export function fsBusy() { return busy > 0; }

// Apaga em segundo plano e avisa a tela (ui.fsBusy) enquanto o disco estiver ocupado.
export function removeSafely(path, opts) {
  busy++;
  ui.set({fsBusy: busy});
  const done = () => { busy = Math.max(0, busy - 1); cacheAt = 0; ui.set({fsBusy: busy, fsTick: Date.now()}); };
  return FileSystem.removeAsync(path, opts).then(v => { done(); return v; }, e => { done(); throw e; });
}

function read() {
  const out = [];
  const add = (label, path, type) => {
    try {
      if (!FileSystem.exists(path)) return;
      const {total, free} = FileSystem.diskUsage(path);
      // Pontos de montagem vazios do PS5 (USB/estendido sem nada plugado) aparecem com ~2 MB: ignorar.
      if (total >= 256 * 1024 * 1024 || type === 'internal') out.push({label, path, type, total, free});
    } catch (_) { /* sem acesso */ }
  };
  if (Platform.OS === 'ps5') {
    add('SSD interno', '/data', 'internal');
    for (let i = 0; i < 8; i++) add(`USB ${i}`, `/mnt/usb${i}`, 'usb');
    for (let i = 0; i < 2; i++) add(`Estendido ${i}`, `/mnt/ext${i}`, 'ext');
  } else {
    add('Armazenamento do app', FileSystem.dataDir, 'internal');
    // Prévia no PC: pastas em dataDir/fake-mnt simulam pendrives do PS5.
    const fake = `${FileSystem.dataDir}/fake-mnt`;
    try { FileSystem.readDir(fake).filter(e => e.isDirectory).forEach((e, i) => add(`USB ${i}`, `${fake}/${e.name}`, 'usb')); } catch (_) { /* sem simulação */ }
  }
  return out;
}

// Lista as unidades; relê no máximo a cada 3 s e nunca durante uma exclusão.
export function drives() {
  if (cache && (busy || Date.now() - cacheAt < 3000)) return cache;
  if (busy) return [];
  cache = read();
  cacheAt = Date.now();
  return cache;
}

export function driveOf(path) {
  const list = drives();
  return list.filter(d => path === d.path || path.startsWith(`${d.path}/`)).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
