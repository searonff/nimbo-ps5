// Idiomas do app. O texto em português é a própria chave: t('Baixar') procura a tradução
// do idioma escolhido em i18n/strings.js e volta para o português se faltar alguma.
// Partes variáveis vão entre chaves: t('{n} arquivos', {n: 3}).
import {DeviceInfo} from '@ps5-react/core';
import {config} from './store.js';
import STRINGS from './i18n/strings.js';

// [código, nome no próprio idioma, bandeira]
export const LANGS = [
  ['pt', 'Português (Brasil)', 'br'],
  ['en', 'English', 'us'],
  ['es', 'Español', 'es'],
  ['fr', 'Français', 'fr'],
  ['de', 'Deutsch', 'de'],
  ['it', 'Italiano', 'it'],
];

// Primeira vez: segue o idioma do PS5 se for um dos que o app tem.
export function systemLang() {
  try {
    const tag = String((DeviceInfo.get() || {}).language || '').toLowerCase().slice(0, 2);
    if (LANGS.some(l => l[0] === tag)) return tag;
  } catch (_) {}
  return 'pt';
}

export function lang() { return config.get().lang || 'pt'; }

// Chaves com {1}, {2}… valem para textos já montados: "TorBox conectado!" casa com
// "{1} conectado!". Cada pedaço variável também é traduzido se for uma chave conhecida.
const patterns = {};
function compiled(l) {
  if (patterns[l]) return patterns[l];
  const out = [];
  // Só chaves com {1}, {2}… (vindas de textos montados); {n}, {a}… são preenchidas com t(chave, valores).
  // As mais específicas primeiro, para "{1} usados de {2}" ganhar de algo mais genérico.
  const ks = Object.keys(STRINGS[l] || {}).filter(k => /\{\d+\}/.test(k))
    .sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length);
  for (const k of ks) {
    const names = [];
    const src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '([\\s\\S]*?)'; });
    out.push([new RegExp(`^${src}$`), names, STRINGS[l][k]]);
  }
  return (patterns[l] = out);
}

export function t(s, vars) {
  if (s == null) return '';
  s = String(s);
  const l = lang();
  const dict = l === 'pt' ? null : STRINGS[l];
  let out = dict && dict[s];
  if (!out && dict && !vars) {
    const c = cache[l] || (cache[l] = new Map());
    if (c.has(s)) return c.get(s);
    if (c.size > 3000) c.clear();
    const r = matchPattern(l, dict, s);
    c.set(s, r);
    return r;
  }
  out = out || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

const cache = {};
function matchPattern(l, dict, s) {
  {
    for (const [re, names, tr] of compiled(l)) {
      const m = re.exec(s);
      if (!m) continue;
      const v = {};
      names.forEach((n, i) => { v[n] = dict[m[i + 1]] || m[i + 1]; });
      return tr.replace(/\{(\w+)\}/g, (x, k) => (k in v ? v[k] : x));
    }
  }
  return s;
}

// Plural simples: t1(n, '{n} item', '{n} itens').
export function tn(n, one, many, vars) { return t(n === 1 ? one : many, {n, ...(vars || {})}); }

// Data curta no formato do idioma (sem objetos Date, que o app não tem).
export function fmtDate(ms) {
  if (!(ms > 0)) return '';
  const days = Math.floor(ms / 86400000);
  // Dias desde 1970 → ano/mês/dia (algoritmo civil de Howard Hinnant).
  const z = days + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9, y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const p = n => String(n).padStart(2, '0');
  const l = lang();
  if (l === 'en') return `${m}/${d}/${y}`;
  if (l === 'de') return `${p(d)}.${p(m)}.${y}`;
  return `${p(d)}/${p(m)}/${y}`;
}
