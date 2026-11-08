// Real-Debrid: login por código de dispositivo (client_id público para apps open source),
// lista de torrents, arquivos por torrent e geração do link direto (unrestrict) na hora de baixar.
import {config} from '../store.js';
import {request, basename} from './http.js';

const SERVICE = 'Real-Debrid';
const CLIENT = 'X245A4XAIBGVM';
const oauth = () => (config.get().rdBase ? `${config.get().rdBase}/oauth/v2` : 'https://api.real-debrid.com/oauth/v2');
const rest = () => (config.get().rdBase ? `${config.get().rdBase}/rest/1.0` : 'https://api.real-debrid.com/rest/1.0');
const acct = () => config.get().rd || {};

const FRIENDLY = {
  bad_token: 'Sessão do Real-Debrid expirou. Conecte de novo em Ajustes.',
  permission_denied: 'Sua conta do Real-Debrid não tem permissão para isso.',
  hoster_unsupported: 'Site não suportado pelo Real-Debrid.',
  hoster_unavailable: 'O site está fora do ar no Real-Debrid agora.',
  unavailable_file: 'Arquivo indisponível no Real-Debrid.',
  traffic_exhausted: 'Seu tráfego do Real-Debrid acabou.',
  infringing_file: 'O Real-Debrid bloqueou este arquivo.',
  too_many_active_downloads: 'Limite de torrents ativos no Real-Debrid.',
  file_unavailable: 'Arquivo indisponível no Real-Debrid.',
};

function fail(r) {
  const code = r.json && r.json.error;
  throw new Error(FRIENDLY[code] || (code ? `Real-Debrid: ${String(code).replace(/_/g, ' ')}` : `O Real-Debrid respondeu com erro ${r.status}.`));
}

async function refresh() {
  const a = acct();
  const r = await request(SERVICE, `${oauth()}/token`, {method: 'POST', fields: {
    client_id: a.clientId, client_secret: a.clientSecret, code: a.refreshToken, grant_type: 'http://oauth.net/grant_type/device/1.0',
  }});
  if (!r.ok || !r.json || !r.json.access_token) throw new Error(FRIENDLY.bad_token);
  config.set({rd: {...a, accessToken: r.json.access_token, refreshToken: r.json.refresh_token || a.refreshToken,
    expiresAt: Date.now() + (r.json.expires_in || 3600) * 1000}});
}

async function call(method, path, {query, fields} = {}, retried = false) {
  const a = acct();
  if (!a.accessToken) throw new Error('Conecte sua conta do Real-Debrid primeiro.');
  if (a.expiresAt && a.expiresAt - Date.now() < 60000 && !retried) await refresh();
  const r = await request(SERVICE, `${rest()}${path}`, {method, query, fields, headers: {Authorization: `Bearer ${acct().accessToken}`}});
  if (r.status === 401 && !retried) { await refresh(); return call(method, path, {query, fields}, true); }
  if (!r.ok) fail(r);
  return r.json;
}

export const id = 'realdebrid';
export const name = 'Real-Debrid';
export const short = 'RD';
export const color = '#7aa7ff';
export const auth = 'device';
export const linked = () => !!acct().accessToken;
export function logout() { config.set({rd: {}}); }

export async function start() {
  const r = await request(SERVICE, `${oauth()}/device/code`, {query: {client_id: CLIENT, new_credentials: 'yes'}});
  if (!r.ok || !r.json || !r.json.device_code) throw new Error('O Real-Debrid não iniciou o login.');
  const d = r.json;
  return {
    handle: d.device_code, code: d.user_code, url: d.verification_url || 'https://real-debrid.com/device',
    shortUrl: 'real-debrid.com/device', qrUrl: d.direct_verification_url || d.verification_url || 'https://real-debrid.com/device',
    interval: d.interval || 5, expiresIn: d.expires_in || 1800,
  };
}

export async function poll(deviceCode) {
  const r = await request(SERVICE, `${oauth()}/device/credentials`, {query: {client_id: CLIENT, code: deviceCode}});
  if (!r.ok || !r.json || !r.json.client_secret) return {pending: true};
  const {client_id: clientId, client_secret: clientSecret} = r.json;
  const t = await request(SERVICE, `${oauth()}/token`, {method: 'POST', fields: {
    client_id: clientId, client_secret: clientSecret, code: deviceCode, grant_type: 'http://oauth.net/grant_type/device/1.0',
  }});
  if (!t.ok || !t.json || !t.json.access_token) return {pending: true};
  config.set({rd: {clientId, clientSecret, accessToken: t.json.access_token, refreshToken: t.json.refresh_token,
    expiresAt: Date.now() + (t.json.expires_in || 3600) * 1000}});
  return {done: true};
}

export async function account() {
  const u = await call('GET', '/user');
  return `${u.username || u.email || 'conta'} · ${u.type === 'premium' ? 'Premium' : 'Free'}`;
}

const READY = ['downloaded'];
function item(t) {
  const links = Array.isArray(t.links) ? t.links : [];
  return {
    provider: id, kind: 'torrents', id: t.id, name: String(t.filename || '(sem nome)'), size: Number(t.bytes) || 0,
    files: [], fileCount: links.length, needsFiles: true,
    ready: READY.includes(t.status), progress: (Number(t.progress) || 0) / 100, state: String(t.status || ''),
    created: String(t.added || ''),
  };
}

export async function list() {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const data = await call('GET', '/torrents', {query: {page, limit: 100}});
    const arr = Array.isArray(data) ? data : [];
    for (const t of arr) if (t && t.id) out.push(item(t));
    if (arr.length < 100) break;
  }
  return out;
}

// Arquivos marcados do torrent; os links vêm na mesma ordem dos arquivos marcados.
export async function details(it) {
  const info = await call('GET', `/torrents/info/${it.id}`);
  const links = Array.isArray(info.links) ? info.links : [];
  const sel = (Array.isArray(info.files) ? info.files : []).filter(f => f.selected);
  let files;
  if (links.length === sel.length) {
    files = sel.map((f, i) => ({id: f.id, name: String(f.path || '').replace(/^\//, ''), short: basename(f.path), size: Number(f.bytes) || 0, link: links[i]}));
  } else {
    // o Real-Debrid juntou os arquivos num pacote: um link por pacote
    files = links.map((l, i) => ({id: i + 1, name: links.length > 1 ? `${it.name} parte ${i + 1}` : it.name, short: it.name, size: links.length === 1 ? it.size : 0, link: l}));
  }
  return {...it, files, needsFiles: false};
}

export async function resolve(job) {
  const r = await call('POST', '/unrestrict/link', {fields: {link: job.link}});
  if (!r || !r.download) throw new Error('O Real-Debrid não gerou o link de download.');
  return {url: r.download, size: Number(r.filesize) || 0};
}

export async function add(link) {
  link = link.trim();
  if (/^magnet:/i.test(link)) {
    const r = await call('POST', '/torrents/addMagnet', {fields: {magnet: link}});
    // o Real-Debrid só baixa depois de escolher os arquivos: marca todos
    for (let i = 0; i < 4; i++) {
      try { await call('POST', `/torrents/selectFiles/${r.id}`, {fields: {files: 'all'}}); break; } catch (e) {
        await new Promise(ok => setTimeout(ok, 1500));
      }
    }
    return {kind: 'torrents', id: r.id};
  }
  if (/^https?:\/\//i.test(link)) {
    const r = await call('POST', '/unrestrict/link', {fields: {link}});
    return {direct: r.download, name: r.filename, size: Number(r.filesize) || 0};
  }
  throw new Error('Link não reconhecido. Use magnet:, http:// ou https://');
}

export async function remove(it) { await call('DELETE', `/torrents/delete/${it.id}`); }
