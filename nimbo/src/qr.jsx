// QR code desenhado com retângulos (um por sequência de módulos escuros em cada linha).
import {View} from '@ps5-react/core';
import qrcode from './qrcode.js';

export function QR({text, size = 240}) {
  let qr;
  try { qr = qrcode(0, 'M'); qr.addData(text); qr.make(); } catch (_) { return null; }
  const n = qr.getModuleCount();
  const margin = 2;
  const cell = Math.floor(size / (n + margin * 2));
  const total = cell * (n + margin * 2);
  const runs = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!qr.isDark(y, x)) { x++; continue; }
      const start = x;
      while (x < n && qr.isDark(y, x)) x++;
      runs.push(<View key={`${y}:${start}`} style={{position: 'absolute', backgroundColor: '#0f1b2d',
        left: (start + margin) * cell, top: (y + margin) * cell, width: (x - start) * cell, height: cell}} />);
    }
  }
  return <View style={{width: total, height: total, backgroundColor: '#ffffff', borderRadius: 16}}>{runs}</View>;
}
