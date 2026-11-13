// Motor: fila de downloads (TorBox ou link direto), extração automática e cópias.
// Um trabalho pesado por vez: o PS5 React recomenda não extrair enquanto baixa.
import {Archives, Downloads, FileSystem, Notifications, Power} from '@ps5-react/core';
import {config, queue, ui, nextId, toast} from './store.js';
import * as torbox from './torbox.js';
import {provider} from './debrid/index.js';
import {removeSafely, fsBusy} from './drives.js';

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
  [/unsupported or incomplete|incomplete archive|corrupt|truncated|unexpected end/i, 'O compactado está incompleto ou corrompido (falta alguma parte?).'],
  [/password|encrypted|senha/i, 'Senha errada ou faltando. Cadastre em Ajustes > Senhas e tente de novo.'],
  [/maxBytes must be/i, 'Erro de uma versão antiga do app. Aperte Tentar de novo.'],
];
// Também usado na tela, para erros salvos por versões antigas.
export function friendlyError(msg) {
  const hit = FRIENDLY_ERRORS.find(([re]) => re.test(String(msg || '')));
  return hit ? hit[1] : msg;
}
function friendly(patch) {
  if (!patch.error) return patch;
  const hit = FRIENDLY_ERRORS.find(([re]) => re.test(patch.error));
  return hit ? {...patch, error: hit[1]} : patch;
}
function patchJob(id, patch) { patch = friendly(patch); queue.set(q => ({...q, jobs: q.jobs.map(j => (j.id === id ? {...j, ...patch} : j))})); }
function patchTask(id, patch) { patch = friendly(patch); queue.set(q => ({...q, tasks: q.tasks.map(t => (t.id === id ? {...t, ...patch} : t))})); }

// Progresso chega muitas vezes por segundo; repassar cada um redesenha o app inteiro e
// atrasa a música. Guarda o último valor e aplica no máximo uma vez por segundo (em step).
const live = new Map();   // id -> {kind: 'job'|'task', patch}
let liveAt = 0;
function liveProgress(kind, id, patch) { live.set(id, {kind, patch}); }
function flushProgress(force) {
  if (!live.size || (!force && Date.now() - liveAt < 1000)) return;
  liveAt = Date.now();
  const all = [...live.entries()];
  live.clear();
  queue.set(q => ({
    ...q,
    jobs: q.jobs.map(j => { const e = all.find(([id, x]) => id === j.id && x.kind === 'job'); return e ? {...j, ...e[1].patch} : j; }),
    tasks: q.tasks.map(t => { const e = all.find(([id, x]) => id === t.id && x.kind === 'task'); return e ? {...t, ...e[1].patch} : t; }),
  }));
}
// Ao terminar, aplica o último progresso e esquece o item (nada atrasado sobrescreve o estado final).
function endProgress(id) { const e = live.get(id); live.delete(id); if (e) (e.kind === 'job' ? patchJob : patchTask)(id, e.patch); }

export function enqueueTorbox(item, files, dest, {extract, deleteArchive, flatten}) {
  FileSystem.mkdir(dest, {recursive: true});
  let added = 0;
  const current = jobs();
  const fresh = [];
  for (const f of files) {
    const prov = item.provider || 'torbox';
    if (current.some(j => (j.provider || 'torbox') === prov && j.tbKind === item.kind && j.itemId === item.id && j.fileId === f.id && j.state !== 'done')) continue;
    const path = unique(`${dest}/${relPath(f.name)}`);
    fresh.push({
      id: nextId(), type: prov === 'torbox' ? 'torbox' : 'debrid', provider: prov, link: f.link || '',
      tbKind: item.kind, itemId: item.id, fileId: f.id, itemName: item.name,
      name: basename(path), path, root: dest, size: f.size || 0, written: 0, state: 'queued', error: '',
      extract, deleteArchive, flatten: !!flatten, created: Date.now(),
    });
    added++;
  }
  queue.set(q => ({...q, jobs: q.jobs.concat(fresh)}));
  return added;
}

export function enqueueDirect(url, dest, {extract, deleteArchive, flatten}, givenName) {
  FileSystem.mkdir(dest, {recursive: true});
  let name = givenName || (() => { try { return decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'download'); } catch (_) { return 'download'; } })();
  const path = unique(`${dest}/${sanitize(name)}`);
  queue.set(q => ({...q, jobs: q.jobs.concat([{
    id: nextId(), type: 'direct', url, name: basename(path), path, root: dest, size: 0, written: 0, state: 'queued', error: '',
    extract, deleteArchive, flatten: !!flatten, created: Date.now(),
  }])}));
}

export function enqueueExtract(first, {deleteArchive, auto, flatten}) {
  if (tasks().some(t => t.type === 'extract' && t.src === first && ['queued', 'running', 'done'].includes(t.state))) return;
  queue.set(q => ({...q, tasks: q.tasks.concat([{
    id: nextId(), type: 'extract', src: first, name: basename(first), dest: dirname(first), state: 'queued',
    written: 0, total: 0, error: '', deleteArchive, auto: !!auto, flatten: !!flatten, created: Date.now(),
  }])}));
}

function fsChanged() { try { ui.set({fsTick: (ui.get().fsTick || 0) + 1}); } catch (_) { /* sem tela */ } }

// Tira todos os arquivos de dentro de `dir` (em qualquer nível) e os põe soltos em `target`;
// nome repetido ganha " (1)", nada é sobrescrito. As pastas que ficarem vazias são apagadas.
// Cede a vez a cada 40 arquivos para não travar a tela e a música. Devolve quantos moveu.
export async function flattenInto(dir, target) {
  const files = [], dirs = [];
  const walk = d => {
    let list = [];
    try { list = FileSystem.readDir(d); } catch (_) { return; }
    for (const e of list) {
      const full = `${d}/${e.name}`;
      if (e.isDirectory) { dirs.push(full); walk(full); } else files.push(full);
    }
  };
  walk(dir);
  let moved = 0;
  for (const f of files) {
    if (dirname(f) === target) continue;   // já está solto no destino
    try { FileSystem.rename(f, unique(`${target}/${basename(f)}`)); moved++; } catch (_) { /* fica onde está */ }
    if (moved % 40 === 0) await new Promise(r => setTimeout(r, 0));
  }
  // Apaga de baixo para cima só as pastas vazias (a de origem também, se não for o próprio destino).
  for (const d of dirs.reverse().concat(dir === target ? [] : [dir])) {
    try { if (!FileSystem.readDir(d).length) await removeSafely(d); } catch (_) { /* deixa */ }
  }
  fsChanged();
  return moved;
}

export function enqueueCopy(src, destDir, move) {
  queue.set(q => ({...q, tasks: q.tasks.concat([{
    id: nextId(), type: move ? 'move' : 'copy', src, name: basename(src), dest: destDir, state: 'queued',
    written: 0, total: 0, error: '', created: Date.now(),
  }])}));
}

export function watchItem(kind, id, name, dest, opts, prov = 'torbox') {
  queue.set(q => ({...q, watches: q.watches.filter(w => !((w.provider || 'torbox') === prov && w.kind === kind && w.id === id))
    .concat([{provider: prov, kind, id, name, dest, ...opts, since: Date.now()}])}));
}

/* ---------- execução ---------- */
// Duas vagas: um download (cj) e uma tarefa de disco (ct: extrair, copiar, mover). Por padrão
// só uma roda por vez (o PS5 React recomenda não extrair enquanto baixa); com "Extrair durante
// o download" ligado, uma extração pode rodar junto com o download seguinte.
let cj = null;   // {id, handle, pausing?, cancelling?}
let ct = null;   // {id, handle}
let held = false;     // atualização do app em andamento: não começa nada novo
export function engineBusy() { return !!(cj || ct); }
export function holdEngine(on) { held = on; }
let lastWritten = 0, lastAt = 0;

export function jobAction(id, action) {
  const job = jobs().find(j => j.id === id);
  if (!job) return;
  if (action === 'pause') {
    if (cj && cj.id === id) { cj.pausing = true; if (cj.handle) cj.handle.cancel(); }
    else if (job.state === 'queued') patchJob(id, {state: 'paused'});
  } else if (action === 'resume') {
    if (job.state === 'paused' || job.state === 'error') patchJob(id, {state: 'queued', error: ''});
  } else if (action === 'cancel') {
    if (cj && cj.id === id) { cj.cancelling = true; if (cj.handle) cj.handle.cancel(); return; }
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
  if (action === 'cancel' && ct && ct.id === id) { ct.handle.cancel(); return; }
  if (action === 'cancel' && task.state === 'queued') patchTask(id, {state: 'canceled'});
  if (action === 'retry') patchTask(id, {state: 'queued', error: ''});
  if (action === 'remove' && task.state !== 'running') queue.set(q => ({...q, tasks: q.tasks.filter(t => t.id !== id)}));
}

export function clearFinished() {
  queue.set(q => ({...q, jobs: q.jobs.filter(j => j.state !== 'done'),
    tasks: q.tasks.filter(t => !['done', 'canceled'].includes(t.state))}));
}

// Apaga o pedaço baixado e, depois, as pastas que ficaram vazias por causa dele (a pasta do
// torrent, por exemplo), subindo até a pasta de destino escolhida — que nunca é apagada.
function discardPartial(job) {
  const removals = [];
  for (const s of ['.part', '.resume']) {
    try { if (FileSystem.exists(job.path + s)) removals.push(removeSafely(job.path + s, {background: true}).catch(() => {})); } catch (_) { /* nada */ }
  }
  Promise.all(removals).then(() => pruneEmpty(dirname(job.path), job.root || config.get().defaultDest)).catch(() => {});
}

async function pruneEmpty(dir, root) {
  root = String(root || '').replace(/\/+$/, '');
  if (!root || root.split('/').length < 3) return;        // nunca perto da raiz da unidade
  while (dir.startsWith(`${root}/`) && dir !== root) {
    let entries;
    try { entries = FileSystem.readDir(dir); } catch (_) { return; }
    if (entries.length) return;
    // outro item da fila ainda vai gravar aqui: deixa a pasta
    if (jobs().some(j => j.state !== 'done' && j.path.startsWith(`${dir}/`))) return;
    try { await removeSafely(dir); } catch (_) { return; }
    dir = dirname(dir);
  }
}

function permalink(job) {
  const id = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id'}[job.tbKind];
  const base = config.get().apiBase || 'https://api.torbox.app/v1/api';
  return `${base}/${job.tbKind}/requestdl?token=${encodeURIComponent(config.get().apiKey)}` +
    `&${id}=${job.itemId}&file_id=${job.fileId}&zip_link=false&redirect=true`;
}

async function startJob(job) {
  FileSystem.mkdir(dirname(job.path), {recursive: true});
  // outro download terminou com o mesmo nome depois que este entrou na fila: escolhe outro nome
  if (FileSystem.exists(job.path) && !FileSystem.exists(`${job.path}.part`)) {
    const path = unique(job.path);
    patchJob(job.id, {path, name: basename(path)});
    job = {...job, path, name: basename(path)};
  }
  const free = (() => { try { return FileSystem.diskUsage(dirname(job.path)).free; } catch (_) { return -1; } })();
  // Uma extração rodando junto ainda vai gravar (total - written) no disco: reserva esse espaço também.
  const ext = ct ? tasks().find(t => t.id === ct.id && t.type === 'extract') : null;
  const reserved = ext && ext.total > 0 ? Math.max(0, ext.total - (ext.written || 0)) : 0;
  if (job.size > 0 && free >= 0 && free < job.size - job.written + reserved + 64 * 1024 * 1024) {
    // com extração rodando, espera ela terminar em vez de dar erro
    if (reserved && free >= job.size - job.written + 64 * 1024 * 1024) return;
    patchJob(job.id, {state: 'error', error: `Espaço insuficiente: precisa ${fmt(job.size)}, livre ${fmt(free)}`});
    return;
  }
  let url = job.type === 'torbox' ? permalink(job) : job.url;
  if (job.type === 'debrid') {
    // Real-Debrid, AllDebrid e Premiumize geram o link direto na hora (eles expiram).
    const slot = {kind: 'job', id: job.id, handle: null};
    cj = slot;
    patchJob(job.id, {state: 'downloading', error: ''});
    let r;
    try { r = await provider(job.provider).resolve(job); } catch (e) { cj = null; throw e; }
    if (slot.cancelling) { cj = null; queue.set(q => ({...q, jobs: q.jobs.filter(j => j.id !== job.id)})); return; }
    if (slot.pausing) { cj = null; patchJob(job.id, {state: 'paused'}); return; }
    url = r.url;
    if (r.size && !job.size) { job = {...job, size: r.size}; patchJob(job.id, {size: r.size}); }
  }
  const handle = Downloads.enqueue({
    url,
    destination: job.path,
    connections: config.get().connections,
    resume: true,
    rejectHtml: true,
    ...(job.type !== 'direct' && job.size > 0 ? {expectedBytes: job.size} : {}),
  });
  cj = {kind: 'job', id: job.id, handle};
  lastWritten = job.written; lastAt = Date.now();
  patchJob(job.id, {state: 'downloading', error: '', started: Date.now()});
  const unsub = handle.subscribe(p => {
    const patch = {written: p.written || 0};
    if (p.total) patch.size = p.total;
    liveProgress('job', job.id, patch);
  });
  handle.done.then(() => {
    unsub();
    endProgress(job.id);
    cj = null;
    patchJob(job.id, {state: 'done', finished: Date.now()});
    const fresh = jobs().find(j => j.id === job.id);
    Notifications.show('Download concluído', fresh.name);
    toast(`Download concluído: ${fresh.name}`, 'ok');
    afterDownload(fresh);
  }, error => {
    unsub();
    endProgress(job.id);
    const c = cj; cj = null;
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
  if (/denied|expired|403|401/i.test(m)) return 'O serviço recusou o link (pode ter expirado). Aperte Retomar.';
  if (/html/i.test(m)) return 'O servidor mandou uma página em vez do arquivo.';
  if (/expected|size/i.test(m)) return 'O tamanho do arquivo não bate com o da nuvem. Tente de novo.';
  if (/resolve|connect|network|timed out/i.test(m)) return 'Sem conexão. Confira a internet do PS5.';
  return m;
}

function afterDownload(job) {
  // apaga da nuvem quando todos os arquivos daquele item terminaram
  if ((job.type === 'torbox' || job.type === 'debrid') && config.get().deleteFromCloud) {
    const prov = job.provider || 'torbox';
    const pending = jobs().some(j => (j.provider || 'torbox') === prov && j.tbKind === job.tbKind && j.itemId === job.itemId && j.state !== 'done');
    if (!pending) provider(prov).remove({provider: prov, kind: job.tbKind, id: job.itemId, name: job.itemName}).catch(() => {});
  }
  if (!job.extract) return;
  const first = firstVolume(job.path);
  if (!first) return;
  const waiting = jobs().some(j => j.state !== 'done' && firstVolume(j.path) === first);
  if (waiting || !FileSystem.exists(first)) return;
  enqueueExtract(first, {deleteArchive: job.deleteArchive, auto: true, flatten: job.flatten});
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
    ct = {kind: 'task', id: task.id, handle};
    const unsub = handle.subscribe(p => liveProgress('task', task.id, {written: p.written || 0, total: p.total || 0}));
    try {
      await handle.done;
      unsub(); endProgress(task.id); ct = null;
      if (task.deleteArchive) for (const s of sources) removeSafely(s, {background: true}).catch(() => {});
      let result = dest;
      if (task.flatten) { await flattenInto(dest, task.dest); result = task.dest; }   // sem subpastas: tudo solto na pasta escolhida
      patchTask(task.id, {state: 'done', result, finished: Date.now()});
      Notifications.show('Extração concluída', basename(dest));
      toast(`Extraído: ${basename(dest)}`, 'ok');
      return;
    } catch (error) {
      unsub(); endProgress(task.id); ct = null;
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
  ct = {kind: 'task', id: task.id, handle};
  const unsub = handle.subscribe(p => liveProgress('task', task.id, {written: p.written || 0, total: p.total || 0}));
  try {
    await handle.done;
    unsub(); endProgress(task.id);
    if (task.type === 'move') await removeSafely(task.src);
    patchTask(task.id, {state: 'done', result: target});
    toast(`${task.type === 'move' ? 'Movido' : 'Copiado'}: ${task.name}`, 'ok');
  } catch (error) {
    patchTask(task.id, {state: error && error.name === 'AbortError' ? 'canceled' : 'error', error: String(error && error.message || error)});
  } finally {
    unsub(); endProgress(task.id); ct = null;
  }
}

/* ---------- laço principal ---------- */
// Um erro inesperado não pode deixar o item preso em "rodando" nem travar a fila.
function guard(promise, patch, slot) {
  Promise.resolve(promise).catch(error => {
    if (slot === 'job') cj = null; else ct = null;
    patch({state: 'error', error: String(error && error.message || error) || 'Erro inesperado'});
  });
}
let awake = false;
function setAwake(on) {
  if (on !== awake) { awake = on; try { Power.keepAwake(on && config.get().keepAwake); } catch (_) { /* desktop */ } }
}

function step() {
  flushProgress();
  // velocidade
  if (cj) {
    const job = jobs().find(j => j.id === cj.id);
    const now = Date.now();
    if (job && now - lastAt >= 900) {
      const inst = (job.written - lastWritten) * 1000 / (now - lastAt);
      ui.set({speed: ui.get().speed ? ui.get().speed * 0.6 + inst * 0.4 : inst});
      lastWritten = job.written; lastAt = now;
    }
  } else if (ui.get().speed) ui.set({speed: 0});

  if (cj || ct) { setAwake(true); return; }
  if (held || fsBusy()) return;   // disco preso numa exclusão (ou o app se atualizando): começa depois
  // Uma coisa por vez. O SDK pede para não extrair durante download: o limite de memória do
  // descompactador (64 MiB) supõe que nada grande roda junto.
  const task = tasks().find(t => t.state === 'queued');
  if (task) { setAwake(true); guard((task.type === 'extract' ? runExtract : runCopy)(task), p => patchTask(task.id, p), 'task'); return; }
  const job = jobs().find(j => j.state === 'queued');
  if (job) { setAwake(true); guard(startJob(job), p => patchJob(job.id, p), 'job'); return; }
  setAwake(false);
}

let watchBusy = false;
async function checkWatches() {
  const ws = queue.get().watches;
  if (!ws.length || watchBusy) return;
  watchBusy = true;
  try {
    const provs = [...new Set(ws.map(w => w.provider || 'torbox'))];
    for (const pid of provs) {
      const p = provider(pid);
      if (!p.linked()) continue;
      const list = await p.list().catch(() => []);
      for (const w of ws.filter(x => (x.provider || 'torbox') === pid)) {
        let item = list.find(i => i.kind === w.kind && String(i.id) === String(w.id)) ||
          (w.name ? list.find(i => i.ready && i.name === w.name) : null);   // Premiumize troca o id ao terminar
        if (!item || !item.ready) continue;
        if (item.needsFiles) item = await p.details(item).catch(() => null);
        if (!item || !item.files.length) continue;
        enqueueTorbox(item, item.files, w.dest, {extract: w.extract, deleteArchive: w.deleteArchive, flatten: w.flatten});
        queue.set(q => ({...q, watches: q.watches.filter(x => x !== w && !((x.provider || 'torbox') === pid && x.kind === w.kind && x.id === w.id))}));
        Notifications.show(`Pronto no ${p.name}`, item.name);
        toast(`Pronto no ${p.name}, baixando: ${item.name}`, 'ok');
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
