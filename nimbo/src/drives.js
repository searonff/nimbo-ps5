// Unidades de armazenamento disponíveis (PS5: SSD interno, USB e armazenamento estendido).
import {FileSystem, Platform} from '@ps5-react/core';

export function drives() {
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

export function driveOf(path) {
  const list = drives();
  return list.filter(d => path === d.path || path.startsWith(`${d.path}/`)).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
