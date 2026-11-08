// Registro dos serviços de nuvem. Cada um expõe o mesmo formato:
// id, name, short, color, auth ('device' | 'key'), linked(), logout(), start()/poll() ou setKey(),
// account(), list(), details(item), resolve(job), add(link), remove(item).
import {config} from '../store.js';
import * as torbox from '../torbox.js';
import * as realdebrid from './realdebrid.js';
import * as alldebrid from './alldebrid.js';
import * as premiumize from './premiumize.js';

const tb = {
  id: 'torbox', name: 'TorBox', short: 'TB', color: '#57d9a3', auth: 'device',
  linked: () => !!config.get().apiKey,
  logout: () => config.set({apiKey: ''}),
  async start() {
    const d = await torbox.deviceStart();
    return {handle: d.deviceCode, code: d.code, url: d.url, shortUrl: d.shortUrl, qrUrl: d.url, interval: d.interval, expiresIn: d.expiresIn};
  },
  async poll(handle) {
    const r = await torbox.deviceToken(handle);
    if (r.token) { config.set({apiKey: r.token}); return {done: true}; }
    return r;
  },
  async account() { const a = await torbox.me(); return `${a.email} · ${a.plan}`; },
  async list() { return (await torbox.listAll()).map(it => ({...it, provider: 'torbox', fileCount: it.files.length})); },
  async details(it) { return it; },
  async add(link) { return torbox.add(link); },
  async remove(it) { return torbox.remove(it.kind, it.id); },
};

export const PROVIDERS = [tb, realdebrid, alldebrid, premiumize];
export const provider = id => PROVIDERS.find(p => p.id === (id || 'torbox')) || tb;
export const linkedProviders = () => PROVIDERS.filter(p => p.linked());

// Chave única de um item na nuvem unificada.
export const itemKey = it => `${it.provider || 'torbox'}:${it.kind}:${it.id}`;
// O job pertence a este item?
export const jobOf = (j, it) => (j.provider || 'torbox') === (it.provider || 'torbox') && j.tbKind === it.kind && j.itemId === it.id;

// Lê todas as nuvens conectadas; erros de um serviço não escondem os outros.
export async function listAll() {
  const ps = linkedProviders();
  const errors = {};
  const lists = await Promise.all(ps.map(p => p.list().catch(e => { errors[p.id] = e.message; return []; })));
  if (ps.length && Object.keys(errors).length === ps.length) throw new Error(Object.values(errors)[0]);
  const items = [].concat(...lists).sort((a, b) => (a.created < b.created ? 1 : -1));
  return {items, errors};
}
