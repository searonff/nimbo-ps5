// Motor: fila de downloads (TorBox ou link direto), extração automática e cópias.
// Um trabalho pesado por vez: o PS5 React recomenda não extrair enquanto baixa.
import {Archives, Downloads, FileSystem, Notifications, Power} from '@ps5-react/core';
import {config, queue, ui, nextId, toast} from './store.js';
import * as torbox from './torbox.js';

/* ---------- caminhos ---------- */
export function sanitize(name) {
  let s = String(name).replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '');
  return s || '_';
}
export function relPath(name) {
  return String(name).split(/[\\/]+/).filter(p => p && p !== '.' && p !== '..').map(sanitize).join('/') || 'download';
}
export const dirname = p => p.slice(0, p.lastIndexOf('/')) || '/';
export const basename = p => p.slice(p.lastIndexOf('/') + 1);
export function unique(path) {
  if (!FileSystem.exists(path) && !FileSystem.exists(`${path}.part`)) return path;
  const dir = dirname(path), base = basename(path);
  const dot = base.lastIndexOf('.') > 0 ? base.lastIndexOf('.') : base.length;
  for (let i = 1; i < 1000; i++) {
    const c = `${dir}/${base.slice(0, dot)} (${i})${base.slice(dot)}`;
    if (!FileSystem.exists(c) && !FileSystem.exists(`${c}.part`)) return c;
  }
  return path;
}

/* ---------- arquivos compactados em partes ---------- */
const RAR_PART = /^(.*)\.part(\d+)\.rar$/i;
const OLD_RAR = /^(.*)\.([rs])(\d\d)$/i;
const SPLIT = /^(.*)\.(\d{3})$/;
const SINGLE = /\.(rar|zip|7z|tar|tgz|tar\.gz|tar\.xz|txz)$/i;

export function archiveKind(name) {
  let m;
  if ((m = RAR_PART.exec(name))) return Number(m[2]) === 1 ? 'first' : 'part';
  if (OLD_RAR.test(name)) return 'part';
  if ((m = SPLIT.exec(name))) return Number(m[2]) === 1 ? 'first' : 'part';
  if (SINGLE.test(name)) return 'first';
  return '';
}

export function firstVolume(path) {
  const dir = dirname(path), name = basename(path);
  let m;
  if ((m = RAR_PART.exec(name))) return `${dir}/${m[1]}.part${'1'.padStart(m[2].length, '0')}.rar`;
  if ((m = OLD_RAR.exec(name))) return `${dir}/${m[1]}.rar`;
  if ((m = SPLIT.exec(name))) return `${dir}/${m[1]}.001`;
  if (SINGLE.test(name)) return path;
  return null;
}

export function volumes(first) {
  const dir = dirname(first), name = basename(first);
  let entries = [];
  try { entries = FileSystem.readDir(dir).map(e => e.name); } catch (_) { return [first]; }
  let m, pick = [];
  if ((m = RAR_PART.exec(name))) {
    pick = entries.map(n => [RAR_PART.exec(n), n]).filter(([x]) => x && x[1] === m[1]).map(([x, n]) => [Number(x[2]), n]);
  } else if ((m = SPLIT.exec(name))) {
    pick = entries.map(n => [SPLIT.exec(n), n]).filter(([x]) => x && x[1] === m[1]).map(([x, n]) => [Number(x[2]), n]);
  } else if (/\.rar$/i.test(name)) {
    const stem = name.slice(0, -4);
    pick = [[-1, name]].concat(entries.map(n => [OLD_RAR.exec(n), n]).filter(([x]) => x && x[1] === stem)
      .map(([x, n]) => [(x[2].toLowerCase() === 's' ? 100 : 0) + Number(x[3]), n]));
  } else return [first];
  return pick.sort((a, b) => a[0] - b[0]).map(([, n]) => `${dir}/${n}`);
}

export function stripArchive(name) {
  let m;
  if ((m = RAR_PART.exec(name))) return m[1];
  if ((m = SPLIT.exec(name))) name = m[1];
  return name.replace(/\.(tar\.gz|tar\.xz|rar|zip|7z|tar|tgz|txz)$/i, '') || 'extraido';
}

/* ---------- fila ---------- */
const jobs = () => queue.get().jobs;
const tasks = () => queue.get().tasks;
// Mensagens técnicas viram texto que dá para entender (e agir) na TV.
const FRIENDLY_ERRORS = [
  [/destination already exists|already exists/i, 'Já existe um arquivo com esse nome no destino.'],
  [/no space|enospc|disk full/i, 'Sem espaço livre no destino.'],
  [/timed? ?out|connection|network|resolve|socket|ECONN/i, 'A conexão caiu. Aperte Retomar para continuar de onde parou.'],
  [/permission|EACCES|EPERM|read-only/i, 'Sem permissão para gravar nesta pasta. Escolha outra.'],
  [/HTTP 4\d\d|forbidden|expired/i, 'O link expirou. Aperte Retomar para gerar outro.'],
];
function friendly(patch) {
  if (!patch.error) return patch;
  const hit = FRIENDLY_ERRORS.find(([re]) => re.test(patch.error));
  return hit ? {...patch, error: hit[1]} : patch;
}
function patchJob(id, patch) { patch = friendly(patch); queue.set(q => ({...q, jobs: q.jobs.map(j => (j.id === id ? {...j, ...patch} : j))})); }
function patchTask(id, patch) { patch = friendly(patch); queue.set(q => ({...q, tasks: q.tasks.map(t => (t.id === id ? {...t, ...patch} : t))})); }

export function enqueueTorbox(item, files, dest, {extract, deleteArchive}) {
  FileSystem.mkdir(dest, {recursive: true});
  let added = 0;
  const current = jobs();
  const fresh = [];
  for (const f of files) {
    if (current.some(j => j.tbKind === item.kind && j.itemId === item.id && j.fileId === f.id && j.state !== 'done')) continue;
    const path = unique(`${dest}/${relPath(f.name)}`);
    fresh.push({
      id: nextId(), type: 'torbox', tbKind: item.kind, itemId: item.id, fileId: f.id, itemName: item.name,
      name: basename(path), path, size: f.size || 0, written: 0, state: 'queued', error: '',
      extract, deleteArchive, created: Date.now(),
    });
    added++;
  }
  queue.set(q => ({...q, jobs: q.jobs.concat(fresh)}));
  return added;
}

export function enqueueDirect(url, dest, {extract, deleteArchive}) {
  FileSystem.mkdir(dest, {recursive: true});
  let name = decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || 'download'));
  const path = unique(`${dest}/${sanitize(name)}`);
  queue.set(q => ({...q, jobs: q.jobs.concat([{
    id: nextId(), type: 'direct', url, name: basename(path), path, size: 0, written: 0, state: 'queued', error: '',
    extract, deleteArchive, created: Date.now(),
  }])}));
}

export function enqueueExtract(first, {deleteArchive, auto}) {
  if (tasks().some(t => t.type === 'extract' && t.src === first && ['queued', 'running', 'done'].includes(t.state))) return;
  queue.set(q => ({...q, tasks: q.tasks.concat([{
    id: nextId(), type: 'extract', src: first, name: basename(first), dest: dirname(first), state: 'queued',
    written: 0, total: 0, error: '', deleteArchive, auto: !!auto, created: Date.now(),
  }])}));
}

export function enqueueCopy(src, destDir, move) {
  queue.set(q => ({...q, tasks: q.tasks.concat([{
    id: nextId(), type: move ? 'move' : 'copy', src, name: basename(src), dest: destDir, state: 'queued',
    written: 0, total: 0, error: '', created: Date.now(),
  }])}));
}

export function watchItem(kind, id, name, dest, opts) {
  queue.set(q => ({...q, watches: q.watches.filter(w => !(w.kind === kind && w.id === id))
    .concat([{kind, id, name, dest, ...opts, since: Date.now()}])}));
}

/* ---------- execução ---------- */
let current = null;   // {kind:'job'|'task', id, handle}
let held = false;     // atualização do app em andamento: não começa nada novo
export function engineBusy() { return !!current; }
export function holdEngine(on) { held = on; }
let lastWritten = 0, lastAt = 0;

export function jobAction(id, action) {
  const job = jobs().find(j => j.id === id);
  if (!job) return;
  if (action === 'pause') {
    if (current && current.kind === 'job' && current.id === id) { current.pausing = true; current.handle.cancel(); }
    else if (job.state === 'queued') patchJob(id, {state: 'paused'});
  } else if (action === 'resume') {
    if (job.state === 'paused' || job.state === 'error') patchJob(id, {state: 'queued', error: ''});
  } else if (action === 'cancel') {
    if (current && current.kind === 'job' && current.id === id) { current.cancelling = true; current.handle.cancel(); return; }
    discardPartial(job);
    queue.set(q => ({...q, jobs: q.jobs.filter(j => j.id !== id)}));
  } else if (action === 'remove') {
    queue.set(q => ({...q, jobs: q.jobs.filter(j => j.id !== id)}));
  } else if (action === 'first') {
    queue.set(q => ({...q, jobs: [job].concat(q.jobs.filter(j => j.id !== id))}));
  }
}

export function taskAction(id, action) {
  const task = tasks().find(t => t.id === id);
  if (!task) return;
  if (action === 'cancel' && current && current.kind === 'task' && current.id === id) { current.handle.cancel(); return; }
  if (action === 'cancel' && task.state === 'queued') patchTask(id, {state: 'canceled'});
  if (action === 'retry') patchTask(id, {state: 'queued', error: ''});
  if (action === 'remove' && task.state !== 'running') queue.set(q => ({...q, tasks: q.tasks.filter(t => t.id !== id)}));
}

export function clearFinished() {
  queue.set(q => ({...q, jobs: q.jobs.filter(j => j.state !== 'done'),
    tasks: q.tasks.filter(t => !['done', 'canceled'].includes(t.state))}));
}

function discardPartial(job) {
  for (const s of ['.part', '.resume']) {
    try { if (FileSystem.exists(job.path + s)) FileSystem.removeAsync(job.path + s, {background: true}).catch(() => {}); } catch (_) { /* nada */ }
  }
}

function permalink(job) {
  const id = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id'}[job.tbKind];
  const base = config.get().apiBase || 'https://api.torbox.app/v1/api';
  return `${base}/${job.tbKind}/requestdl?token=${encodeURIComponent(config.get().apiKey)}` +
    `&${id}=${job.itemId}&file_id=${job.fileId}&zip_link=false&redirect=true`;
}

function startJob(job) {
  FileSystem.mkdir(dirname(job.path), {recursive: true});
  // outro download terminou com o mesmo nome depois que este entrou na fila: escolhe outro nome
  if (FileSystem.exists(job.path) && !FileSystem.exists(`${job.path}.part`)) {
    const path = unique(job.path);
    patchJob(job.id, {path, name: basename(path)});
    job = {...job, path, name: basename(path)};
  }
  const free = (() => { try { return FileSystem.diskUsage(dirname(job.path)).free; } catch (_) { return -1; } })();
  if (job.size > 0 && free >= 0 && free < job.size - job.written + 64 * 1024 * 1024) {
    patchJob(job.id, {state: 'error', error: `Espaço insuficiente: precisa ${fmt(job.size)}, livre ${fmt(free)}`});
    return;
  }
  const handle = Downloads.enqueue({
    url: job.type === 'torbox' ? permalink(job) : job.url,
    destination: job.path,
    connections: config.get().connections,
    resume: true,
    rejectHtml: true,
    ...(job.type === 'torbox' && job.size > 0 ? {expectedBytes: job.size} : {}),
  });
  current = {kind: 'job', id: job.id, handle};
  lastWritten = job.written; lastAt = Date.now();
  patchJob(job.id, {state: 'downloading', error: '', started: Date.now()});
  const unsub = handle.subscribe(p => {
    const patch = {written: p.written || 0};
    if (p.total) patch.size = p.total;
    patchJob(job.id, patch);
  });
  handle.done.then(() => {
    unsub();
    current = null;
    patchJob(job.id, {state: 'done', finished: Date.now()});
    const fresh = jobs().find(j => j.id === job.id);
    Notifications.show('Download concluído', fresh.name);
    toast(`Download concluído: ${fresh.name}`, 'ok');
    afterDownload(fresh);
  }, error => {
    unsub();
    const c = current; current = null;
    if (c && c.cancelling) {
      discardPartial(job);
      queue.set(q => ({...q, jobs: q.jobs.filter(j => j.id !== job.id)}));
    } else if (c && c.pausing) {
      patchJob(job.id, {state: 'paused'});
    } else {
      const msg = friendlyDownloadError(error);
      patchJob(job.id, {state: 'error', error: msg});
      Notifications.show('Falha no download', job.name);
    }
  });
}

function friendlyDownloadError(error) {
  const m = String(error && error.message || error);
  if (/space|ENOSPC/i.test(m)) return 'Sem espaço no destino.';
  if (/already exists/i.test(m)) return 'Já existe um arquivo com esse nome no destino. Tente de novo.';
  if (/denied|expired|403|401/i.test(m)) return 'O TorBox recusou o link. Tente de novo.';
  if (/html/i.test(m)) return 'O servidor mandou uma página em vez do arquivo.';
  if (/expected|size/i.test(m)) return 'O tamanho do arquivo não bate com o do TorBox. Tente de novo.';
  if (/resolve|connect|network|timed out/i.test(m)) return 'Sem conexão. Confira a internet do PS5.';
  return m;
}

function afterDownload(job) {
  // apaga da nuvem quando todos os arquivos daquele item terminaram
  if (job.type === 'torbox' && config.get().deleteFromCloud) {
    const pending = jobs().some(j => j.type === 'torbox' && j.tbKind === job.tbKind && j.itemId === job.itemId && j.state !== 'done');
    if (!pending) torbox.remove(job.tbKind, job.itemId).catch(() => {});
  }
  if (!job.extract) return;
  const first = firstVolume(job.path);
  if (!first) return;
  const waiting = jobs().some(j => j.state !== 'done' && firstVolume(j.path) === first);
  if (waiting || !FileSystem.exists(first)) return;
  enqueueExtract(first, {deleteArchive: job.deleteArchive, auto: true});
}

function passwordError(m) { return /password|passphrase|decrypt|encrypt/i.test(m); }

async function runExtract(task) {
  const sources = volumes(task.src);
  const dest = unique(`${task.dest}/${sanitize(stripArchive(basename(task.src)))}`);
  const passwords = [''].concat(config.get().passwords || []);
  patchTask(task.id, {state: 'running', step: 'extract', written: 0, error: ''});
  let lastError = '';
  for (const password of passwords) {
    const handle = Archives.extract({sources, destination: dest, maxBytes: 1024 ** 4, ...(password ? {password} : {})});
    current = {kind: 'task', id: task.id, handle};
    const unsub = handle.subscribe(p => patchTask(task.id, {written: p.written || 0, total: p.total || 0}));
    try {
      await handle.done;
      unsub(); current = null;
      if (task.deleteArchive) for (const s of sources) FileSystem.removeAsync(s, {background: true}).catch(() => {});
      patchTask(task.id, {state: 'done', result: dest, finished: Date.now()});
      Notifications.show('Extração concluída', basename(dest));
      toast(`Extraído: ${basename(dest)}`, 'ok');
      return;
    } catch (error) {
      unsub(); current = null;
      lastError = String(error && error.message || error);
      if (error && error.name === 'AbortError') { patchTask(task.id, {state: 'canceled'}); return; }
      if (!passwordError(lastError)) break;
    }
  }
  let msg = lastError;
  if (passwordError(lastError)) {
    msg = (config.get().passwords || []).length ? 'Nenhuma das senhas cadastradas funcionou.' :
      'Arquivo com senha: cadastre a senha em Ajustes e tente de novo.';
    if (/not supported|unsupported/i.test(lastError)) msg = 'Este tipo de arquivo com senha ainda não é suportado.';
  } else if (/missing|truncat|volume/i.test(lastError)) msg = 'Arquivo incompleto ou faltando partes.';
  patchTask(task.id, {state: 'error', error: msg});
  Notifications.show('Falha ao extrair', task.name);
}

async function runCopy(task) {
  const target = unique(`${task.dest}/${basename(task.src)}`);
  patchTask(task.id, {state: 'running', written: 0, error: ''});
  if (task.type === 'move') {
    try { FileSystem.rename(task.src, target); patchTask(task.id, {state: 'done', result: target}); return; } catch (_) { /* outro disco: copia */ }
  }
  const handle = FileSystem.copyAsync(task.src, target, {verify: true, resume: true});
  current = {kind: 'task', id: task.id, handle};
  const unsub = handle.subscribe(p => patchTask(task.id, {written: p.written || 0, total: p.total || 0}));
  try {
    await handle.done;
    if (task.type === 'move') await FileSystem.removeAsync(task.src);
    patchTask(task.id, {state: 'done', result: target});
    toast(`${task.type === 'move' ? 'Movido' : 'Copiado'}: ${task.name}`, 'ok');
  } catch (error) {
    patchTask(task.id, {state: error && error.name === 'AbortError' ? 'canceled' : 'error', error: String(error && error.message || error)});
  } finally {
    unsub(); current = null;
  }
}

/* ---------- laço principal ---------- */
// Um erro inesperado não pode deixar o item preso em "rodando" nem travar a fila.
function guard(promise, patch) {
  Promise.resolve(promise).catch(error => {
    current = null;
    patch({state: 'error', error: String(error && error.message || error) || 'Erro inesperado'});
  });
}
let awake = false;
function setAwake(on) {
  if (on !== awake) { awake = on; try { Power.keepAwake(on && config.get().keepAwake); } catch (_) { /* desktop */ } }
}

function step() {
  // velocidade
  if (current && current.kind === 'job') {
    const job = jobs().find(j => j.id === current.id);
    const now = Date.now();
    if (job && now - lastAt >= 900) {
      const inst = (job.written - lastWritten) * 1000 / (now - lastAt);
      ui.set({speed: ui.get().speed ? ui.get().speed * 0.6 + inst * 0.4 : inst});
      lastWritten = job.written; lastAt = now;
    }
  } else if (ui.get().speed) ui.set({speed: 0});

  if (current) { setAwake(true); return; }
  if (held) return;
  const task = tasks().find(t => t.state === 'queued');
  if (task) { setAwake(true); guard((task.type === 'extract' ? runExtract : runCopy)(task), p => patchTask(task.id, p)); return; }
  const job = jobs().find(j => j.state === 'queued');
  if (job) { setAwake(true); guard(startJob(job), p => patchJob(job.id, p)); return; }
  setAwake(false);
}

let watchBusy = false;
async function checkWatches() {
  const ws = queue.get().watches;
  if (!ws.length || watchBusy || !config.get().apiKey) return;
  watchBusy = true;
  try {
    const kinds = [...new Set(ws.map(w => w.kind))];
    for (const kind of kinds) {
      const list = await torbox.list(kind).catch(() => []);
      for (const w of ws.filter(x => x.kind === kind)) {
        const item = list.find(i => i.id === w.id);
        if (item && item.ready && item.files.length) {
          enqueueTorbox(item, item.files, w.dest, {extract: w.extract, deleteArchive: w.deleteArchive});
          queue.set(q => ({...q, watches: q.watches.filter(x => !(x.kind === kind && x.id === w.id))}));
          Notifications.show('Pronto no TorBox', item.name);
          toast(`Pronto no TorBox, baixando: ${item.name}`, 'ok');
        }
      }
    }
  } finally { watchBusy = false; }
}

export function applyRateLimit() {
  const {speedLimitOn, speedLimitMB} = config.get();
  try { Downloads.setRateLimit(speedLimitOn ? Math.round(speedLimitMB * 1024 * 1024) : 0); } catch (_) { /* host antigo */ }
}

export function startEngine() {
  // o app foi fechado no meio de algo: volta para a fila
  queue.set(q => ({
    ...q,
    jobs: q.jobs.map(j => (j.state === 'downloading' ? {...j, state: 'queued'} : j)),
    tasks: q.tasks.map(t => (t.state === 'running' ? {...t, state: 'queued'} : t)),
  }));
  applyRateLimit();
  setInterval(step, 500);
  setInterval(checkWatches, 20000);
}

export function fmt(bytes) {
  if (bytes == null || bytes < 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, b = bytes;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${i ? b.toFixed(b >= 100 ? 0 : 1) : b} ${u[i]}`;
}
export const fmtSpeed = b => `${fmt(b || 0)}/s`;
export function fmtEta(s) {
  if (!(s > 0) || !isFinite(s)) return '';
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
