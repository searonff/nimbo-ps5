// Atualização pelo próprio app: procura a release mais recente no GitHub, baixa o .zip
// (pasta PPSA48921 dentro), extrai e troca os arquivos da instalação um a um.
// A troca é por arquivo (grava ao lado e renomeia por cima) para não quebrar a montagem
// que o ShadowMount+ faz da pasta; a versão nova vale quando o app é reaberto.
import {Http, Downloads, Archives, FileSystem, Platform} from '@ps5-react/core';
import {config} from './store.js';
import {engineBusy, holdEngine} from './engine.js';

export const APP_VERSION = '2.2.2';
export const REPO = 'felipezmoraes/nimbo-ps5';
export const REPO_URL = `https://github.com/${REPO}`;
const TITLE = 'PPSA48921';

const isPS5 = () => Platform.OS === 'ps5';
const api = () => config.get().updateApi || `https://api.github.com/repos/${REPO}/releases/latest`;

// "v2.1.0" -> [2,1,0]; compara números, ignora prefixos.
const parts = v => String(v || '').replace(/^[^\d]*/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
export function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

export async function checkUpdate() {
  let res;
  try {
    res = await Http.request(api(), {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'NimboDownloader-PS5'}, maxBytes: 2 * 1024 * 1024});
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
    version, notes: String(rel.body || '').trim().slice(0, 1200), page: rel.html_url || REPO_URL,
    asset: asset ? {url: asset.browser_download_url, size: asset.size || 0, name: asset.name} : null,
    available: !!asset && newer(version, APP_VERSION),
  };
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

// step(texto, fração 0–1) informa o andamento na tela.
export async function installUpdate(info, step) {
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
