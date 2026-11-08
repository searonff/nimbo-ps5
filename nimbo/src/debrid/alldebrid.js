// AllDebrid: login por PIN (mostra um código; o app consulta até o usuário confirmar no site),
// magnets na nuvem, árvore de arquivos com links e desbloqueio do link na hora de baixar.
import {config} from '../store.js';
import {request, isoFromEpoch} from './http.js';

const SERVICE = 'AllDebrid';
const api = () => config.get().adBase || 'https://api.alldebrid.com';
const key = () => config.get().adKey || '';

const FRIENDLY = {
  AUTH_BAD_APIKEY: 'Chave do AllDebrid inválida. Conecte de novo em Ajustes.',
  AUTH_MISSING_APIKEY: 'Conecte sua conta do AllDebrid primeiro.',
  AUTH_BLOCKED: 'O AllDebrid bloqueou o acesso. Confirme o login pelo e-mail que eles enviaram.',
  AUTH_USER_BANNED: 'Conta do AllDebrid bloqueada.',
  MUST_BE_PREMIUM: 'Precisa de conta Premium no AllDebrid.',
  MAGNET_MUST_BE_PREMIUM: 'Precisa de conta Premium no AllDebrid.',
  MAGNET_TOO_MANY_ACTIVE: 'Limite de magnets ativos no AllDebrid.',
  MAGNET_INVALID_URI: 'Magnet inválido.',
  LINK_HOST_NOT_SUPPORTED: 'Site não suportado pelo AllDebrid.',
  LINK_DOWN: 'O arquivo não existe mais no site de origem.',
  LINK_PASS_PROTECTED: 'O link tem senha.',
  LINK_HOST_LIMIT_REACHED: 'Limite diário deste site no AllDebrid.',
};

async function call(method, path, {query, fields, auth = true} = {}) {
  if (auth && !key()) throw new Error(FRIENDLY.AUTH_MISSING_APIKEY);
  const r = await request(SERVICE, `${api()}${path}`, {method, query, fields, headers: auth ? {Authorization: `Bearer ${key()}`} : {}});
  const j = r.json;
  if (!j || j.status !== 'success') {
    const code = j && j.error && j.error.code;
    const err = new Error(FRIENDLY[code] || (j && j.error && j.error.message) || `O AllDebrid respondeu com erro ${r.status}.`);
    err.code = code || '';
    throw err;
  }
  return j.data || {};
}

export const id = 'alldebrid';
export const name = 'AllDebrid';
export const short = 'AD';
export const color = '#f6b54a';
export const auth = 'device';
export const linked = () => !!key();
export function logout() { config.set({adKey: ''}); }

export async function start() {
  const d = await call('GET', '/v4.1/pin/get', {auth: false});
  return {
    handle: {pin: d.pin, check: d.check}, code: d.pin, url: d.base_url || 'https://alldebrid.com/pin/',
    shortUrl: 'alldebrid.com/pin', qrUrl: d.user_url || d.base_url, interval: 5, expiresIn: d.expires_in || 600,
  };
}

export async function poll(h) {
  try {
    const d = await call('POST', '/v4/pin/check', {fields: {pin: h.pin, check: h.check}, auth: false});
    if (d.activated && d.apikey) { config.set({adKey: d.apikey}); return {done: true}; }
    return {pending: true};
  } catch (e) {
    if (/PIN_EXPIRED|PIN_INVALID/.test(e.code)) return {expired: true};
    return {pending: true};
  }
}

export async function account() {
  const d = await call('GET', '/v4/user');
  const u = d.user || {};
  return `${u.username || u.email || 'conta'} · ${u.isPremium ? 'Premium' : 'Free'}`;
}

function item(m) {
  const size = Number(m.size) || 0;
  const ready = Number(m.statusCode) === 4;
  return {
    provider: id, kind: 'magnets', id: m.id, name: String(m.filename || '(sem nome)'), size,
    files: [], fileCount: 0, needsFiles: true, ready,
    progress: ready ? 1 : size ? Math.min(1, (Number(m.downloaded) || 0) / size) : 0,
    state: String(m.status || ''), created: isoFromEpoch(m.uploadDate),
  };
}

export async function list() {
  const d = await call('POST', '/v4.1/magnet/status', {fields: {}});
  const ms = Array.isArray(d.magnets) ? d.magnets : d.magnets ? Object.values(d.magnets) : [];
  return ms.filter(m => m && m.id).map(item);
}

// Árvore {n, e:[...]} para pastas e {n, s, l} para arquivos.
function flatten(nodes, prefix, out) {
  for (const n of nodes || []) {
    if (Array.isArray(n.e)) flatten(n.e, `${prefix}${n.n}/`, out);
    else if (n.l) out.push({id: out.length + 1, name: `${prefix}${n.n}`, short: String(n.n), size: Number(n.s) || 0, link: n.l});
  }
  return out;
}

export async function details(it) {
  const d = await call('POST', '/v4/magnet/files', {fields: {id: [it.id]}});
  const m = (d.magnets || [])[0] || {};
  if (m.error) throw new Error(FRIENDLY[m.error.code] || m.error.message || 'O AllDebrid não listou os arquivos.');
  const files = flatten(m.files, '', []);
  return {...it, files, fileCount: files.length, needsFiles: false};
}

export async function resolve(job) {
  const d = await call('POST', '/v4/link/unlock', {fields: {link: job.link}});
  if (d.delayed && !d.link) throw new Error('O AllDebrid ainda está preparando o link. Aperte Retomar em alguns segundos.');
  if (!d.link) throw new Error('O AllDebrid não gerou o link de download.');
  return {url: d.link, size: Number(d.filesize) || 0};
}

export async function add(link) {
  link = link.trim();
  if (/^magnet:/i.test(link) || /^[a-f0-9]{40}$/i.test(link)) {
    const d = await call('POST', '/v4/magnet/upload', {fields: {magnets: [link]}});
    const m = (d.magnets || [])[0] || {};
    if (m.error) throw new Error(FRIENDLY[m.error.code] || m.error.message);
    return {kind: 'magnets', id: m.id, cached: !!m.ready};
  }
  if (/^https?:\/\//i.test(link)) {
    const d = await call('POST', '/v4/link/unlock', {fields: {link}});
    if (!d.link) throw new Error('O AllDebrid não gerou o link de download.');
    return {direct: d.link, name: d.filename, size: Number(d.filesize) || 0};
  }
  throw new Error('Link não reconhecido. Use magnet:, http:// ou https://');
}

export async function remove(it) { await call('POST', '/v4/magnet/delete', {fields: {id: it.id}}); }
