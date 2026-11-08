// Estado do app com persistência em JSON no armazenamento do próprio app.
import {useEffect, useState} from 'react';
import {FileSystem} from '@ps5-react/core';

function load(file, fallback) {
  try {
    const path = `${FileSystem.dataDir}/${file}`;
    if (FileSystem.exists(path)) return {...fallback, ...JSON.parse(FileSystem.readFile(path))};
  } catch (_) { /* arquivo corrompido: usa o padrão */ }
  return fallback;
}

function createStore(file, initial, persist = true) {
  let value = file ? load(file, initial) : initial;
  const listeners = new Set();
  let saveTimer = null;
  const save = () => {
    saveTimer = null;
    try {
      const path = `${FileSystem.dataDir}/${file}`;
      FileSystem.writeFile(`${path}.tmp`, JSON.stringify(value), {sync: true});
      FileSystem.rename(`${path}.tmp`, path);
    } catch (_) { /* sem espaço: tenta na próxima mudança */ }
  };
  return {
    get: () => value,
    set(patch) {
      value = typeof patch === 'function' ? patch(value) : {...value, ...patch};
      listeners.forEach(fn => fn(value));
      if (file && persist && !saveTimer) saveTimer = setTimeout(save, 400);
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
  musicVolume: 0.25,
  sfx: true,
  speedLimitOn: false,
  speedLimitMB: 5,
  connections: 8,
  phonePin: '',
  phoneSession: '',
});

// fila de downloads e tarefas (extrair, copiar, mover)
export const queue = createStore('queue.json', {jobs: [], tasks: [], watches: [], nextId: 1});

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
