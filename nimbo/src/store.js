// Estado do app com persistência em JSON no armazenamento do próprio app.
//
// Excluir o app pelo menu do PS5 apaga a área de dados dele (dataDir), mesmo com a pasta
// em /data/homebrew intacta. Por isso cada arquivo também é copiado para BACKUP_DIR, que o
// sistema não mexe; se o app abrir sem dados, restaura de lá (logins, ajustes e fila).
import {useEffect, useState} from 'react';
import {FileSystem, Platform} from '@ps5-react/core';

const BACKUP_DIR = Platform.OS === 'ps5' ? '/data/nimbo-settings' : `${FileSystem.dataDir}/fake-backup`;

function readJson(path) {
  try { if (FileSystem.exists(path)) return JSON.parse(FileSystem.readFile(path)); } catch (_) { /* corrompido */ }
  return null;
}

function load(file, fallback) {
  const own = readJson(`${FileSystem.dataDir}/${file}`);
  if (own) return {...fallback, ...own};
  const saved = readJson(`${BACKUP_DIR}/${file}`);
  if (saved) return {...fallback, ...saved, restoredFromBackup: true};
  return fallback;
}

function writeSafe(path, text, sync = true) {
  FileSystem.writeFile(`${path}.tmp`, text, {sync});
  FileSystem.rename(`${path}.tmp`, path);
}

// delay: espera antes de gravar (junta várias mudanças numa gravação só).
// sync: força a gravação física no disco; desligado na fila, que muda o tempo todo e
// não pode travar a tela (e a música) enquanto o disco está ocupado extraindo.
function createStore(file, initial, persist = true, {delay = 400, sync = true} = {}) {
  let value = file ? load(file, initial) : initial;
  const listeners = new Set();
  let saveTimer = null;
  // Ao abrir, grava uma vez: cria a cópia de segurança (ou repõe os dados restaurados).
  if (file && persist) saveTimer = setTimeout(() => save(), 1500);
  const save = () => {
    saveTimer = null;
    const {restoredFromBackup, ...data} = value || {};
    void restoredFromBackup;
    const text = JSON.stringify(data);
    try { writeSafe(`${FileSystem.dataDir}/${file}`, text, sync); } catch (_) { /* sem espaço: tenta na próxima mudança */ }
    try { FileSystem.mkdir(BACKUP_DIR, {recursive: true}); writeSafe(`${BACKUP_DIR}/${file}`, text, sync); } catch (_) { /* cópia é só reserva */ }
  };
  return {
    get: () => value,
    set(patch) {
      value = typeof patch === 'function' ? patch(value) : {...value, ...patch};
      listeners.forEach(fn => fn(value));
      if (file && persist && !saveTimer) saveTimer = setTimeout(save, delay);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    flush() { if (saveTimer) { clearTimeout(saveTimer); save(); } },
  };
}

export function useStore(store, select = v => v) {
  const [state, setState] = useState(() => select(store.get()));
  useEffect(() => store.subscribe(v => setState(select(v))), [store]);
  return state;
}

export const config = createStore('config.json', {
  apiKey: '',
  apiBase: '',
  defaultDest: '/data/Nimbo',
  passwords: [],
  autoExtract: true,
  deleteArchive: false,
  deleteFromCloud: false,
  keepAwake: true,
  music: true,
  musicVolume: 0.3,
  sfx: true,
  speedLimitOn: false,
  speedLimitMB: 5,
  connections: 8,
  phonePin: '',
  phoneSession: '',
});

// fila de downloads e tarefas (extrair, copiar, mover)
export const queue = createStore('queue.json', {jobs: [], tasks: [], watches: [], nextId: 1}, true, {delay: 3000, sync: false});

// estado volátil da interface (não persiste)
export const ui = createStore(null, {cloud: null, cloudError: '', toast: null, speed: 0});

export function nextId() {
  const id = queue.get().nextId;
  queue.set({nextId: id + 1});
  return id;
}

export function toast(text, kind = 'info') {
  ui.set({toast: {text, kind, at: Date.now()}});
}
