// Atualização pelo próprio app: procura a release mais recente no GitHub, baixa o .zip
// (pasta PPSA48921 dentro), extrai e troca os arquivos da instalação um a um.
// A troca é por arquivo (grava ao lado e renomeia por cima) para não quebrar a montagem
// que o ShadowMount+ faz da pasta; a versão nova vale quando o app é reaberto.
import {Http, Downloads, Archives, FileSystem, Platform} from '@ps5-react/core';
import {config} from './store.js';
import {engineBusy, holdEngine} from './engine.js';

export const APP_VERSION = '2.2.7';
export const REPO = 'searonff/nimbo-ps5';
export const REPO_URL = `https://github.com/${REPO}`;
const TITLE = 'PPSA48921';

const isPS5 = () => Platform.OS === 'ps5';
// Endereço pelo número do repositório: continua valendo se o repositório mudar de nome ou de dono.
const REPO_ID = 1450019000;
const api = () => config.get().updateApi || `https://api.github.com/repositories/${REPO_ID}/releases/latest`;

// "v2.1.0" -> [2,1,0]; compara números, ignora prefixos.
const parts = v => String(v || '').replace(/^[^\d]*/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
export function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

// Lê um cabeçalho da resposta, seja objeto simples ou estilo Headers.
function header(res, name) {
  const h = res && res.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  const key = Object.keys(h).find(k => k.toLowerCase() === name);
  return key ? h[key] : null;
}

// O Http do PS5 não segue redirecionamentos; o GitHub responde 301 quando o
// repositório muda de nome ou de dono. Segue até 5 saltos (Location ou "url" do corpo).
async function fetchRelease(url) {
  const opts = {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'NimboDownloader-PS5'}, maxBytes: 2 * 1024 * 1024};
  for (let hop = 0; ; hop++) {
    const res = await Http.request(url, opts);
    if (res.status < 300 || res.status >= 400 || hop >= 5) return res;
    let next = header(res, 'location');
    if (!next) { try { next = (await res.json()).url; } catch (_) {} }
    if (!next) return res;
    url = /^https?:/i.test(next) ? next : `https://api.github.com${next.startsWith('/') ? '' : '/'}${next}`;
  }
}

// Guarda quando foi a última procura e o erro (se houve), para mostrar em Sobre.
export async function checkUpdate() {
  try {
    const info = await fetchLatest();
    config.set({updateError: ''});
    return info;
  } catch (e) {
    config.set({updateCheckedAt: Date.now(), updateError: e.message});
    throw e;
  }
}

async function fetchLatest() {
  let res;
  try {
    res = await fetchRelease(api());
  } catch (_) {
    throw new Error('Sem conexão com o GitHub. Confira a internet do PS5.');
  }
  if (res.status === 404) throw new Error('Ainda não há versões publicadas no GitHub.');
  if (res.status === 403 || res.status === 429) throw new Error('O GitHub limitou as consultas. Tente de novo mais tarde.');
  if (!res.ok) throw new Error(`O GitHub respondeu com erro ${res.status}.`);
  const rel = await res.json();
  const zips = (rel.assets || []).filter(a => /\.zip$/i.test(a.name));
  const asset = zips.find(a => /^nimbodownloader.*ps5/i.test(a.name)) || zips.find(a => /ps5/i.test(a.name)) || zips[0];
  const version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
  config.set({updateCheckedAt: Date.now(), updateLatest: version});
  return {
    version, notes: String(rel.body || '').trim().slice(0, 8000), page: rel.html_url || REPO_URL,
    asset: asset ? {url: asset.browser_download_url, size: asset.size || 0, name: asset.name} : null,
    available: !!asset && newer(version, APP_VERSION),
  };
}

// Notas de uma versão já publicada (para mostrar "Novidades" depois de atualizar).
export async function fetchNotes(version) {
  const res = await fetchRelease(`https://api.github.com/repositories/${REPO_ID}/releases/tags/v${version}`);
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const rel = await res.json();
  return String(rel.body || '').trim().slice(0, 8000);
}

// Markdown da release -> blocos simples para a TV: títulos, tópicos e parágrafos.
export function noteBlocks(md) {
  const out = [];
  for (let line of String(md || '').replace(/\r/g, '').split('\n')) {
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // imagens
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                   // links: fica o texto
      .replace(/(\*\*|__|`)/g, '').trimEnd();
    if (!line.trim()) continue;
    const h = /^\s*#{1,6}\s+(.*)/.exec(line);
    const b = /^\s*[-*+]\s+(.*)/.exec(line) || /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (h) out.push({kind: 'title', text: h[1]});
    else if (b) out.push({kind: 'item', text: b[1]});
    else if (out.length && out[out.length - 1].kind === 'text') out[out.length - 1].text += ` ${line.trim()}`;
    else out.push({kind: 'text', text: line.trim()});
  }
  return out;
}

// Onde o Nimbo está instalado (ShadowMount+ lê /data/homebrew e pastas homebrew em USB/estendido).
export function installDir() {
  const roots = isPS5()
    ? ['/data/homebrew', ...Array.from({length: 8}, (_, i) => `/mnt/usb${i}/homebrew`), '/mnt/ext0/homebrew', '/mnt/ext1/homebrew']
    : [`${FileSystem.dataDir}/fake-install`];
  for (const r of roots) if (FileSystem.exists(`${r}/${TITLE}/eboot.bin`)) return `${r}/${TITLE}`;
  return null;
}

function files(dir, rel = '') {
  const out = [];
  for (const e of FileSystem.readDir(rel ? `${dir}/${rel}` : dir)) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) out.push(...files(dir, r)); else out.push(r);
  }
  return out;
}

function waitTask(handle, onProgress) {
  const unsub = handle.subscribe ? handle.subscribe(p => onProgress && onProgress(p)) : null;
  return handle.done.finally(() => unsub && unsub());
}

// Troca arquivo por arquivo: grava ao lado e renomeia por cima (a pasta montada pelo ShadowMount+ continua válida).
async function replaceFiles(src, target, progress) {
  const list = files(src);
  for (let i = 0; i < list.length; i++) {
    const rel = list[i], to = `${target}/${rel}`, tmp = `${to}.nimbo-new`;
    progress(rel, i / list.length);
    const dir = to.slice(0, to.lastIndexOf('/'));
    if (!FileSystem.exists(dir)) FileSystem.mkdir(dir, {recursive: true});
    if (FileSystem.exists(tmp)) await FileSystem.removeAsync(tmp);
    await waitTask(FileSystem.copyAsync(`${src}/${rel}`, tmp, {verify: true, resume: false}));
    if (FileSystem.exists(to)) await FileSystem.removeAsync(to);
    FileSystem.rename(tmp, to);
  }
}

// Volta para a versão guardada antes da última atualização.
export function backupVersion() {
  const v = config.get().backupVersion;
  return v && FileSystem.exists(`${FileSystem.dataDir}/app-backup/eboot.bin`) ? v : '';
}
export async function rollback(step) {
  if (running) throw new Error('Há uma atualização em andamento. Espere ela terminar.');
  const target = installDir();
  if (!target || !backupVersion()) throw new Error('Não há versão anterior guardada.');
  if (engineBusy()) throw new Error('Termine ou pause os downloads e extrações antes.');
  holdEngine(true);
  try {
    await replaceFiles(`${FileSystem.dataDir}/app-backup`, target, (rel, frac) => step(`Restaurando ${rel}…`, frac));
    config.set({updateInstalled: backupVersion()});
    step('Pronto!', 1);
  } finally { holdEngine(false); }
}

// Uma instalação por vez: a automática (ao abrir o app) e o botão em Sobre usam a mesma
// pasta de trabalho, e rodar as duas juntas apagava os arquivos uma da outra
// ("no such file or directory"). Quem chama durante uma instalação se junta a ela.
let running = null;
let lastStep = null;
const listeners = new Set();
export const updateRunning = () => !!running;

// step(texto, fração 0–1) informa o andamento na tela.
export function installUpdate(info, step) {
  if (step) listeners.add(step);
  if (running) {
    if (step && lastStep) step(lastStep[0], lastStep[1]);
    return running;
  }
  lastStep = null;
  running = doInstall(info, (text, frac) => {
    lastStep = [text, frac];
    listeners.forEach(fn => { try { fn(text, frac); } catch (_) { /* tela fechada */ } });
  }).finally(() => { running = null; lastStep = null; listeners.clear(); });
  return running;
}

async function doInstall(info, step) {
  if (!info || !info.asset) throw new Error('Esta versão não tem o arquivo do PS5 anexado.');
  if (engineBusy()) throw new Error('Termine ou pause os downloads e extrações antes de atualizar.');
  const target = installDir();
  if (!target) throw new Error('Não achei a pasta do Nimbo em /data/homebrew. Atualize copiando a pasta nova pelo FTP.');
  const work = `${FileSystem.dataDir}/update`;
  holdEngine(true);
  try {
    try { await FileSystem.removeAsync(work); } catch (_) { /* não existia */ }
    FileSystem.mkdir(work, {recursive: true});
    const zip = `${work}/${info.asset.name || 'update.zip'}`;
    step('Baixando a versão nova…', 0);
    await waitTask(Downloads.enqueue({url: info.asset.url, destination: zip, connections: 4, resume: true, rejectHtml: true, unlimited: true,
      ...(info.asset.size ? {expectedBytes: info.asset.size} : {})}),
    p => step('Baixando a versão nova…', p.total ? (p.written || 0) / p.total * 0.6 : 0));
    step('Abrindo o pacote…', 0.6);
    const out = `${work}/x`;
    await waitTask(Archives.extract({sources: [zip], destination: out, maxBytes: 4 * 1024 ** 3}),
      p => step('Abrindo o pacote…', 0.6 + (p.total ? (p.written || 0) / p.total * 0.2 : 0)));
    const src = FileSystem.exists(`${out}/${TITLE}/eboot.bin`) ? `${out}/${TITLE}` : FileSystem.exists(`${out}/eboot.bin`) ? out : null;
    if (!src) throw new Error('O pacote baixado não tem a pasta do app (PPSA48921).');
    // Cópia de segurança da versão atual antes de trocar qualquer arquivo.
    step('Guardando a versão atual…', 0.8);
    const backup = `${FileSystem.dataDir}/app-backup`;
    try { await FileSystem.removeAsync(backup); } catch (_) { /* não havia */ }
    await waitTask(FileSystem.copyAsync(target, backup, {verify: true, resume: false}));
    config.set({backupVersion: APP_VERSION});
    try {
      await replaceFiles(src, target, (rel, frac) => step(`Instalando ${rel}…`, 0.82 + 0.18 * frac));
    } catch (e) {
      // algo falhou no meio: volta tudo para a versão anterior
      step('Algo deu errado, voltando para a versão anterior…', 0.9);
      await replaceFiles(backup, target, () => {});
      throw new Error(`A atualização falhou e o app voltou para a versão ${APP_VERSION}. (${e.message})`);
    }
    step('Pronto!', 1);
    config.set({updateInstalled: info.version});
  } finally {
    holdEngine(false);
    FileSystem.removeAsync(work, {background: true}).catch(() => {});
  }
}
