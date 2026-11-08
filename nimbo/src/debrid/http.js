// Chamadas HTTP comuns aos serviços Debrid: formulários, query string e erros em português.
import {Http} from '@ps5-react/core';

export function form(fields) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(x)}`);
    else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

// Faz a requisição e devolve {status, json}. Rede fora vira mensagem amigável com o nome do serviço.
export async function request(service, url, {method = 'GET', query, fields, headers = {}} = {}) {
  const qs = query ? `${url.includes('?') ? '&' : '?'}${form(query)}` : '';
  const opts = {method, headers: {Accept: 'application/json', 'User-Agent': 'NimboDownloader-PS5', ...headers}, maxBytes: 4 * 1024 * 1024};
  if (fields) {
    opts.body = form(fields);
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  let res;
  try {
    res = await Http.request(url + qs, opts);
  } catch (_) {
    throw new Error(`Sem conexão com o ${service}. Confira a internet do PS5.`);
  }
  let json = null;
  try { json = await res.json(); } catch (_) { /* sem corpo ou não-JSON */ }
  if (res.status === 429) throw new Error(`O ${service} pediu uma pausa. Tente de novo em instantes.`);
  return {status: res.status, ok: res.ok, json};
}

export const basename = p => String(p || '').split('/').filter(Boolean).pop() || String(p || '');

// Segundos Unix -> "AAAA-MM-DDThh:mm:ssZ" sem usar Date (o PS5 React só tem Date.now()).
export function isoFromEpoch(sec) {
  sec = Math.floor(Number(sec) || 0);
  if (sec <= 0) return '';
  const days = Math.floor(sec / 86400), rem = sec - days * 86400;
  // algoritmo "civil from days" (Howard Hinnant)
  const z = days + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const p = n => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}T${p(Math.floor(rem / 3600))}:${p(Math.floor(rem % 3600 / 60))}:${p(rem % 60)}Z`;
}
