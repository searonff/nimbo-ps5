// Premiumize: entra com a chave da API (premiumize.me/account), digitada no PS5 ou colada pelo celular.
// A nuvem são os arquivos guardados (agrupados pela pasta de cima) mais as transferências em andamento.
import {config} from '../store.js';
import {request, basename, isoFromEpoch} from './http.js';

const SERVICE = 'Premiumize';
const api = () => config.get().pmBase || 'https://www.premiumize.me/api';
const key = () => config.get().pmKey || '';

async function call(method, path, {query = {}, fields, apikey = key()} = {}) {
  if (!apikey) throw new Error('Conecte sua conta do Premiumize primeiro.');
  const r = await request(SERVICE, `${api()}${path}`, {method, query: {...query, apikey}, fields});
  const j = r.json;
  if (!j || j.status !== 'success') {
    const msg = (j && j.message) || `O Premiumize respondeu com erro ${r.status}.`;
    throw new Error(/api ?key|customer_id|not logged/i.test(msg) ? 'Chave do Premiumize inválida. Confira em premiumize.me/account.' : `Premiumize: ${msg}`);
  }
  return j;
}

export const id = 'premiumize';
export const name = 'Premiumize';
export const short = 'PM';
export const color = '#ff8a5c';
export const auth = 'key';
export const keyUrl = 'premiumize.me/account';
export const linked = () => !!key();
export function logout() { config.set({pmKey: ''}); }

// Confere a chave antes de salvar.
export async function setKey(k) {
  k = String(k || '').trim();
  if (!k) throw new Error('Chave vazia.');
  await call('GET', '/account/info', {apikey: k});
  config.set({pmKey: k});
}

export async function account() {
  const j = await call('GET', '/account/info');
  const until = Number(j.premium_until) || 0;
  return `ID ${j.customer_id || '?'} · ${until * 1000 > Date.now() ? 'Premium' : 'Free'}`;
}

export async function list() {
  const [all, tr] = await Promise.all([call('GET', '/item/listall'), call('GET', '/transfer/list').catch(() => ({transfers: []}))]);
  const groups = new Map();
  for (const f of all.files || []) {
    const path = String(f.path || f.name || '').replace(/^\//, '');
    const top = path.includes('/') ? path.split('/')[0] : null;
    const gid = top ? `d:${top}` : `f:${f.id}`;
    if (!groups.has(gid)) groups.set(gid, {provider: id, kind: 'files', id: gid, name: top || String(f.name), size: 0, files: [], ready: true, progress: 1, state: 'finished', created: ''});
    const g = groups.get(gid);
    g.files.push({id: f.id, name: path, short: basename(f.name || path), size: Number(f.size) || 0});
    g.size += Number(f.size) || 0;
    const at = isoFromEpoch(f.created_at);
    if (at > g.created) g.created = at;
  }
  const items = [...groups.values()].map(g => ({...g, fileCount: g.files.length}));
  for (const t of tr.transfers || []) {
    if (['finished', 'seeding'].includes(t.status)) continue;
    items.push({provider: id, kind: 'transfers', id: `t:${t.id}`, name: String(t.name || '(sem nome)'), size: 0, files: [], fileCount: 0,
      ready: false, progress: Number(t.progress) || 0, state: String(t.status || ''), created: ''});
  }
  return items;
}

export async function details(it) { return it; }

export async function resolve(job) {
  const j = await call('GET', '/item/details', {query: {id: job.fileId}});
  if (!j.link) throw new Error('O Premiumize não gerou o link de download.');
  return {url: j.link, size: Number(j.size) || 0};
}

export async function add(link) {
  link = link.trim();
  if (/^magnet:/i.test(link)) {
    const j = await call('POST', '/transfer/create', {fields: {src: link}});
    return {kind: 'transfers', id: `t:${j.id}`};
  }
  if (/^https?:\/\//i.test(link)) {
    const j = await call('POST', '/transfer/directdl', {fields: {src: link}});
    const c = (j.content || [])[0];
    if (!c || !c.link) throw new Error('O Premiumize não gerou o link de download.');
    return {direct: c.link, name: basename(c.path), size: Number(c.size) || 0, more: (j.content || []).slice(1)};
  }
  throw new Error('Link não reconhecido. Use magnet:, http:// ou https://');
}

export async function remove(it) {
  if (String(it.id).startsWith('t:')) { await call('POST', '/transfer/delete', {fields: {id: it.id.slice(2)}}); return; }
  if (String(it.id).startsWith('f:')) { await call('POST', '/item/delete', {fields: {id: it.id.slice(2)}}); return; }
  // pasta: acha o id pela listagem da raiz
  const root = await call('GET', '/folder/list');
  const folder = (root.content || []).find(c => c.type === 'folder' && c.name === it.name);
  if (!folder) throw new Error('Pasta não encontrada no Premiumize.');
  await call('POST', '/folder/delete', {fields: {id: folder.id}});
}
