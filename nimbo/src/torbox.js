// Cliente da API v1 do TorBox (https://api.torbox.app/v1/api) sobre o Http do PS5 React.
import {Http} from '@ps5-react/core';
import {config} from './store.js';

const BASE = 'https://api.torbox.app/v1/api';
export const KINDS = ['torrents', 'webdl', 'usenet'];
const ID_PARAM = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id'};

function base() { return config.get().apiBase || BASE; }

const FRIENDLY = {
  AUTH_ERROR: 'Chave do TorBox inválida. Conecte de novo em Ajustes.',
  BAD_TOKEN: 'Chave do TorBox inválida. Conecte de novo em Ajustes.',
  NO_AUTH: 'Conecte sua conta do TorBox primeiro.',
  PLAN_RESTRICTED_FEATURE: 'Seu plano do TorBox não permite isso.',
  ACTIVE_LIMIT: 'Limite de downloads ativos no TorBox atingido.',
  DOWNLOAD_TOO_LARGE: 'Arquivo grande demais para o seu plano.',
  UNSUPPORTED_SITE: 'Site não suportado pelo TorBox.',
  INVALID_HOSTER: 'Site não suportado pelo TorBox.',
};

async function call(method, path, {query, body, contentType, auth = true} = {}) {
  const key = config.get().apiKey;
  if (auth && !key) throw new Error(FRIENDLY.NO_AUTH);
  const qs = query ? '?' + Object.keys(query).map(k => `${k}=${encodeURIComponent(query[k])}`).join('&') : '';
  const headers = {Accept: 'application/json'};
  if (auth) headers.Authorization = `Bearer ${key}`;
  if (contentType) headers['Content-Type'] = contentType;
  let response;
  try {
    response = await Http.request(`${base()}/${path}${qs}`, {method, headers, body, maxBytes: 4 * 1024 * 1024});
  } catch (error) {
    throw new Error('Sem conexão com o TorBox. Confira a internet do PS5.');
  }
  let json = null;
  try { json = await response.json(); } catch (_) { /* resposta não-JSON */ }
  const ok = json && 'success' in json ? json.success : response.ok;
  if (!ok) {
    if (response.status === 429) throw new Error('O TorBox pediu uma pausa. Tente de novo em instantes.');
    const code = json && json.error;
    const detail = json && json.detail;
    const error = new Error(FRIENDLY[code] || detail || code || `Erro HTTP ${response.status}`);
    error.code = code || '';
    throw error;
  }
  return json || {};
}

function multipart(fields) {
  const boundary = '----nimbo' + Math.random().toString(36).slice(2);
  let body = '';
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  return {body: body + `--${boundary}--\r\n`, contentType: `multipart/form-data; boundary=${boundary}`};
}

function item(kind, it) {
  const files = (Array.isArray(it.files) ? it.files : []).filter(f => f && typeof f === 'object').map(f => ({
    id: f.id, name: String(f.name || f.short_name || ''), short: String(f.short_name || String(f.name || '').split('/').pop()), size: Number(f.size) || 0,
  }));
  const ready = !!(it.download_finished || it.download_present) ||
    ['completed', 'cached', 'uploading'].includes(it.download_state);
  return {
    kind, id: it.id, name: String(it.name || '(sem nome)'), size: Number(it.size) || 0, files, ready,
    progress: typeof it.progress === 'number' ? it.progress : 0, state: String(it.download_state || ''),
    created: String(it.created_at || ''),
  };
}

// Em páginas, para contas grandes não estourarem o limite de 4 MB por resposta.
const PAGE = 100;
export async function list(kind) {
  const out = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const json = await call('GET', `${kind}/mylist`, {query: {bypass_cache: 'true', offset, limit: PAGE}});
    const data = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
    for (const it of data) if (it && typeof it === 'object') out.push(item(kind, it));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function listAll() {
  const errors = [];
  const lists = await Promise.all(KINDS.map(kind => list(kind).catch(e => { errors.push(e); return []; })));
  // Se nenhuma lista veio, mostra o motivo em vez de "nuvem vazia".
  if (errors.length === KINDS.length) throw errors[0];
  return [].concat(...lists).sort((a, b) => (a.created < b.created ? 1 : -1));
}

export async function requestLink(kind, itemId, fileId) {
  const json = await call('GET', `${kind}/requestdl`, {
    query: {token: config.get().apiKey, [ID_PARAM[kind]]: itemId, file_id: fileId, zip_link: 'false'},
  });
  if (typeof json.data !== 'string' || !json.data.startsWith('http')) throw new Error('O TorBox não gerou o link de download.');
  return json.data;
}

export async function add(link) {
  link = link.trim();
  let kind, path, fields, idKey;
  if (/^magnet:/i.test(link)) {
    kind = 'torrents'; path = 'torrents/createtorrent'; idKey = 'torrent_id';
    fields = {magnet: link, seed: '3', allow_zip: 'false'};
  } else if (/\.nzb(\?|$)/i.test(link)) {
    kind = 'usenet'; path = 'usenet/createusenetdownload'; idKey = 'usenetdownload_id';
    fields = {link};
  } else if (/^https?:\/\//i.test(link)) {
    kind = 'webdl'; path = 'webdl/createwebdownload'; idKey = 'webdownload_id';
    fields = {link};
  } else {
    throw new Error('Link não reconhecido. Use magnet:, http:// ou https://');
  }
  const {body, contentType} = multipart(fields);
  const json = await call('POST', path, {body, contentType});
  const detail = String(json.detail || '');
  return {kind, id: json.data && json.data[idKey], cached: /cached/i.test(detail) && !/not cached/i.test(detail)};
}

export async function remove(kind, id) {
  const field = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'webdl_id'}[kind];
  const path = {torrents: 'torrents/controltorrent', usenet: 'usenet/controlusenetdownload', webdl: 'webdl/controlwebdownload'}[kind];
  await call('POST', path, {body: JSON.stringify({[field]: id, operation: 'delete'}), contentType: 'application/json'});
}

export async function me() {
  const json = await call('GET', 'user/me');
  const d = json.data || {};
  return {email: d.email || '', plan: ({0: 'Free', 1: 'Essential', 2: 'Pro', 3: 'Standard'})[d.plan] || ''};
}

// Login por código de dispositivo (QR code): o TorBox mostra um código; o app consulta até o usuário aprovar.
export async function deviceStart() {
  const json = await call('GET', 'user/auth/device/start', {query: {app: 'Nimbo PS5'}, auth: false});
  const d = json.data || {};
  if (!d.device_code) throw new Error('O TorBox não iniciou o login.');
  return {
    deviceCode: d.device_code, code: d.code || '', url: d.verification_url || 'https://torbox.app/oauth/device',
    shortUrl: d.friendly_verification_url || 'tor.box/link', interval: d.interval || 5,
    expiresIn: d.expires_in || 600,
  };
}

export async function deviceToken(deviceCode) {
  try {
    const json = await call('POST', 'user/auth/device/token', {
      body: JSON.stringify({device_code: deviceCode}), contentType: 'application/json', auth: false,
    });
    const token = json.data && json.data.access_token;
    return token ? {token} : {pending: true};
  } catch (error) {
    if (/expire/i.test(error.code || error.message)) return {expired: true};
    return {pending: true};
  }
}
