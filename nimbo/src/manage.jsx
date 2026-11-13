// Arquivos (gerenciador) e Armazenamento (análise de espaço).
import {useEffect, useRef, useState} from 'react';
import {View, Text, ScrollView, VirtualList, FileSystem, Keyboard, Platform, useFocus, FocusScope, Svg, Path, Circle} from '@ps5-react/core';
import {Bar, Button, Pill, ButtonGlyph, TypeGlyph, TYPE_COLOR, tint} from './ui.jsx';
import {Sheet} from './sheets.jsx';
import {drives, fsBusy, removeSafely} from './drives.js';
import {config, queue, toast, ui, useStore} from './store.js';
import {archiveKind, enqueueCopy, enqueueExtract, flattenInto, fmt, firstVolume, stripArchive, basename, dirname} from './engine.js';
import {t, tn, lang, fmtDate} from './i18n.js';

// Enquanto uma exclusão prende o disco, mostra a última listagem em vez de ler de novo.
const listCache = {};
function list(path, sort = 'name') {
  if (fsBusy()) return listCache[`${path}|${sort}`] || [];
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => (b.size || 0) - (a.size || 0),
    date: (a, b) => (b.modified || 0) - (a.modified || 0),
  }[sort] || ((a, b) => a.name.localeCompare(b.name));
  try {
    return (listCache[`${path}|${sort}`] = FileSystem.readDir(path).filter(e => !e.name.startsWith('.') && !/\.(part|resume|partial|complete)$/.test(e.name))
      .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : by(a, b))));
  } catch (_) { return null; }
}
const SORTS = [['name', 'Nome'], ['date', 'Mais novos'], ['size', 'Maiores']];
// Filtro por tipo (usa as mesmas categorias do Armazenamento). Pastas aparecem em "Todos" e "Pastas".
const SHOW = [['all', 'Todos'], ['dir', 'Pastas'], ['video', 'Vídeos'], ['archive', 'Compactados'],
  ['package', 'Pacotes e imagens'], ['audio', 'Áudio'], ['image', 'Imagens'], ['other', 'Outros']];
function shows(e, f) { return f === 'all' || (f === 'dir' ? e.isDirectory : !e.isDirectory && category(e.name) === f); }

function TypeIcon({entry}) {
  const kind = entry.isDirectory ? 'dir' : category(entry.name);
  const c = TYPE_COLOR[kind] || TYPE_COLOR.other;
  return (
    <View className="w-[38px] h-[38px] rounded-xl items-center justify-center" style={{backgroundColor: tint(c, 0.14)}}>
      <TypeGlyph kind={kind} size={24} />
    </View>
  );
}

/* ---------- nomes de jogos (PPSA/CUSA no nome do arquivo) ---------- */
function appsRoot() { return Platform.OS === 'ps5' ? '/user' : `${FileSystem.dataDir}/fake-user`; }
const LANG_TAG = {pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT'};
const appCache = {};
// Título e versão a partir de /user/appmeta/<id>/param.json (SSD interno, rápido).
function appInfo(id) {
  if (appCache[id]) return appCache[id];
  const info = {title: '', version: ''};
  try {
    const txt = FileSystem.readFile(`${appsRoot()}/appmeta/${id}/param.json`);
    const j = JSON.parse(txt.slice(txt.indexOf('{')));
    const lp = j.localizedParameters || {};
    const l = lp[LANG_TAG[lang()]] || lp['en-US'] || lp[lp.defaultLanguage] || {};
    info.title = l.titleName || '';
    info.version = String(j.contentVersion || j.masterVersion || '').replace(/^0+(\d)/, '$1');
  } catch (_) { /* jogo de PS4, não instalado ou sem metadados */ }
  return (appCache[id] = info);
}
const ID_RE = /(?:^|[^A-Z0-9])((?:PPSA|CUSA|PPSB|CUSB)\d{5})(?!\d)/;
export function titleIdOf(name) { const m = ID_RE.exec(name || ''); return m ? m[1] : ''; }
export function gameTitle(name) { const id = titleIdOf(name); return id ? appInfo(id).title : ''; }

/* ---------- Arquivos ---------- */
export function Files({pickFolder, confirm}) {
  const all = drives();
  const [path, setPath] = useState(all[0] ? all[0].path : FileSystem.dataDir);
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(null);
  const sort = useStore(config, c => c.filesSort || 'name');
  const show = useStore(config, c => (SHOW.some(x => x[0] === c.filesShow) ? c.filesShow : 'all'));
  // Seleção múltipla: □ marca/desmarca o item com o cursor (arquivo ou pasta, em qualquer pasta).
  const [sel, setSel] = useState(() => new Map());   // caminho completo -> {name, isDirectory, size}
  const [selMode, setSelMode] = useState(false);
  const [actions, setActions] = useState(false);   // menu de ações da seleção (Triângulo)
  const focused = useRef(null);
  const listRef = useRef(null);
  const toggle = e => setSel(m => {
    const n = new Map(m), full = `${path}/${e.name}`;
    if (n.has(full)) n.delete(full); else n.set(full, {name: e.name, isDirectory: e.isDirectory, size: e.size || 0});
    return n;
  });
  const clearSel = () => { setSel(new Map()); setSelMode(false); ui.set({filesSel: false}); };
  const enterSel = () => { setSelMode(true); ui.set({filesSel: true}); };
  useEffect(() => () => ui.set({filesSel: false}), []);
  // Ao entrar numa pasta, o cursor vai para o primeiro item dela (e não cai lá em cima).
  const {focus} = useFocus();
  const moved = useRef(false);
  const openDir = p => { moved.current = true; setPath(p); };
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    // Primeira linha por índice: na lista virtual ela pode não estar montada ainda.
    setTimeout(() => { if (!entries.length || !(listRef.current && listRef.current.focusIndex(0))) focus(entries.length ? 'frow:0' : 'files-up'); }, 0);
  }, [path]);
  const tasks = useStore(queue, q => q.tasks);
  const fsTick = useStore(ui, x => x.fsTick || 0);
  useEffect(() => setTick(n => n + 1), [tasks.length, fsTick]);
  const listed = list(path, sort) || [];
  const entries = show === 'all' ? listed : listed.filter(e => shows(e, show));
  const drive = all.filter(d => path === d.path || path.startsWith(`${d.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const up = drive && path !== drive.path ? dirname(path) : null;
  useEffect(() => { ui.set({filesUp: !!up}); }, [up]);
  const refresh = () => setTick(t => t + 1);
  const rename = async e => {
    const r = await Keyboard.open({title: t('Novo nome'), text: e.name, maxLength: 200, type: 'basic'});
    if (r.status !== 'done' || !r.text || r.text === e.name) return;
    try { FileSystem.rename(`${path}/${e.name}`, `${path}/${r.text.replace(/[/\\<>:"|?*]/g, '_')}`); refresh(); } catch (err) { toast(String(err.message || err), 'bad'); }
  };
  const renameAt = async full => {
    const name = basename(full);
    const r = await Keyboard.open({title: t('Novo nome'), text: name, maxLength: 200, type: 'basic'});
    if (r.status !== 'done' || !r.text || r.text === name) return;
    try { FileSystem.rename(full, `${dirname(full)}/${r.text.replace(/[/\\<>:"|?*]/g, '_')}`); refresh(); } catch (err) { toast(String(err.message || err), 'bad'); }
  };
  const remove = e => confirm('Apagar', `${e.isDirectory ? t('Apagar a pasta “{1}” e tudo dentro dela?', {1: e.name}) : t('Apagar “{1}”?', {1: e.name})} ${t('Não dá para desfazer.')}`, 'Apagar', () => {
    toast(t('Apagando…'));
    removeSafely(`${path}/${e.name}`).then(() => { toast(t('Apagado'), 'ok'); refresh(); }, err => toast(String(err.message || err), 'bad'));
  });
  void tick;
  const picked = [...sel.entries()].map(([full, e]) => ({full, ...e}));
  const pickedBytes = picked.reduce((n, e) => n + (e.isDirectory ? 0 : e.size), 0);
  const pickedArchives = [...new Set(picked.filter(e => !e.isDirectory && archiveKind(e.name)).map(e => firstVolume(e.full)))];
  const batchCopy = move => pickFolder(path, dest => {
    for (const e of picked) enqueueCopy(e.full, dest, move);
    toast(move ? tn(picked.length, '{n} item na fila para mover', '{n} itens na fila para mover') : tn(picked.length, '{n} item na fila para copiar', '{n} itens na fila para copiar'), 'ok');
    clearSel();
  });
  const batchRemove = () => confirm('Apagar', `${tn(picked.length, 'Apagar {n} item selecionado?', 'Apagar {n} itens selecionados?')}${picked.some(e => e.isDirectory) ? ` ${t('As pastas vão com tudo dentro.')}` : ''} ${t('Não dá para desfazer.')}`, 'Apagar', async () => {
    let fails = 0;
    toast(t('Apagando…'));
    for (const e of picked) { try { await removeSafely(e.full); } catch (_) { fails++; } }
    toast(fails ? `${fails} não puderam ser apagados` : 'Apagados', fails ? 'bad' : 'ok');
    clearSel(); refresh();
  });
  const batchExtract = () => {
    for (const first of pickedArchives) enqueueExtract(first, {deleteArchive: config.get().deleteArchive, flatten: config.get().flatten});
    toast(tn(pickedArchives.length, '{n} extração na fila (veja em Downloads)', '{n} extrações na fila (veja em Downloads)'), 'ok');
    clearSel();
  };
  const selectAll = () => setSel(m => {
    const n = new Map(m);
    for (const e of entries) n.set(`${path}/${e.name}`, {name: e.name, isDirectory: e.isDirectory, size: e.size || 0});
    return n;
  });
  return (
    <FocusScope onAction={a => {
      // △ troca o filtro de qualquer ponto da lista (sem subir até o botão).
      if (a === 'triangle' && selMode) { if (sel.size) setActions(true); else toast(t('Marque algum item com o Quadrado'), 'info'); return true; }
      if (a === 'triangle') { config.set({filesShow: SHOW[(SHOW.findIndex(x => x[0] === show) + 1) % SHOW.length][0]}); return true; }
      if (a !== 'square') return false;
      const e = entries.find(x => x.name === focused.current);
      if (!selMode) enterSel();
      if (e) toggle(e);
      return true;
    }} onBack={() => {
      if (selMode) { clearSel(); return true; }
      // ○ sobe uma pasta; na raiz da unidade, deixa o ○ voltar para a barra de abas.
      if (up) { openDir(up); return true; }
      return false;
    }}>
    <View className="flex-1 px-10 gap-3">
      <View className="flex-row gap-2 items-center">
        {all.map(d => (
          <View key={d.path} focusKey={`drive:${d.label}`} selected={drive === d} onPress={() => setPath(d.path)}
            className="px-4 py-2 rounded-xl bg-glass border-[3px] border-line selected:border-sky focused:border-sun">
            <Text className="font-heavy text-cap text-cloud">{t(d.label)}</Text>
            <Text className="font-semi text-xs2 text-mist">{t(`${fmt(d.free)} livres`)}</Text>
          </View>
        ))}
        <View className="flex-1" />
        {up ? <Button small focusKey="files-up" label={t('Voltar uma pasta')} onPress={() => openDir(up)} /> : null}
        <Button small label={t(`Ordem: ${SORTS.find(x => x[0] === sort)[1]}`)} onPress={() => config.set({filesSort: SORTS[(SORTS.findIndex(x => x[0] === sort) + 1) % SORTS.length][0]})} />
        <Button small label={t(`Mostrar: ${SHOW.find(x => x[0] === show)[1]}`)} onPress={() => config.set({filesShow: SHOW[(SHOW.findIndex(x => x[0] === show) + 1) % SHOW.length][0]})} />
        <Button small focusKey="files-select" label={selMode ? 'Sair da seleção' : 'Selecionar'} onPress={() => { if (selMode) clearSel(); else { enterSel(); if (entries.length) setTimeout(() => { if (!(listRef.current && listRef.current.focusIndex(0))) focus('frow:0'); }, 0); } }} />
        <Button small label={t('Nova pasta')} onPress={async () => {
          const r = await Keyboard.open({title: t('Nome da nova pasta'), maxLength: 80, type: 'basic'});
          if (r.status === 'done' && r.text.trim()) { FileSystem.mkdir(`${path}/${r.text.trim().replace(/[/\\<>:"|?*]/g, '_')}`, {recursive: true}); refresh(); }
        }} />
      </View>
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-semi text-body text-mist" numberOfLines={1}>{path}</Text></View>
      </View>
      <ScrollView className="flex-1">
        <View className="gap-1 pb-24">
          {!entries.length ? <Text className="font-semi text-body text-mist">{listed.length ? t('Nada deste tipo nesta pasta.') : t('Pasta vazia.')}</Text> : null}
          {/* VirtualList: só as linhas perto da tela ficam montadas. O renderizador desenha no máximo
              128 <Svg> ao mesmo tempo; com uma linha por arquivo, os ícones sumiam no meio da lista. */}
          <VirtualList ref={listRef} data={entries} keyExtractor={e => e.name} itemHeight={54} rowGap={4} renderItem={({item: e, index: i}) => {
            const kind = e.isDirectory ? '' : archiveKind(e.name);
            return (
              <View key={e.name} focusKey={`frow:${i}`} onFocus={() => { focused.current = e.name; }}
                onPress={() => (selMode ? toggle(e) : e.isDirectory ? openDir(`${path}/${e.name}`) : setMenu(e))}
                className={sel.has(`${path}/${e.name}`) ? 'flex-row items-center gap-4 rounded-xl bg-haze2 px-5 h-[54px] border-[3px] border-sky focused:border-sun' : 'flex-row items-center gap-4 rounded-xl bg-glass px-5 h-[54px] border-[3px] border-line focused:border-sun'}>
                {selMode ? (
                  <View className={sel.has(`${path}/${e.name}`) ? 'w-[24px] h-[24px] rounded-md bg-sun items-center justify-center' : 'w-[24px] h-[24px] rounded-md bg-shade border-2 border-rim'}>
                    {sel.has(`${path}/${e.name}`) ? <Svg width={30} height={30} viewBox="0 0 26 26" style={{width: 30, height: 30}}><Path d="M6 13 L11 18 L20 8" stroke="#2b1d00" strokeWidth="3" strokeLinecap="round" fill="none" /></Svg> : null}
                  </View>
                ) : null}
                <TypeIcon entry={e} />
                {/* Nome e jogo com largura limitada: sem isso um nome longo (CUSA…) passava por cima da data e do tamanho. */}
                <View className="flex-1 min-w-0 flex-row items-center gap-3">
                  <View className="flex-1 min-w-0"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{e.name}</Text></View>
                  {gameTitle(e.name) ? <View className="shrink max-w-[340px]"><Text className="font-heavy text-cap text-sky" numberOfLines={1}>{gameTitle(e.name)}</Text></View> : null}
                </View>
                {e.isDirectory ? null : <Text className="font-semi text-cap text-mist">{fmtDate(e.modified)}</Text>}
                {kind === 'first' ? <Pill text={t('Compactado')} tone="warn" /> : null}
                <Text className="font-semi text-cap text-mist">{e.isDirectory ? t('Pasta') : fmt(e.size)}</Text>
              </View>
            );
          }} />
        </View>
      </ScrollView>
      {selMode ? (
        <View className="flex-row gap-3 items-center rounded-2xl bg-haze2 px-5 py-3 mb-[64px] border-2 border-sun">
          <Text className="font-heavy text-lead text-cloud">{sel.size ? `${tn(sel.size, '{n} selecionado', '{n} selecionados')}${pickedBytes ? ` · ${fmt(pickedBytes)}` : ''}` : t('Marque os itens com')}</Text>
          {!sel.size ? <ButtonGlyph name="square" /> : null}
          <View className="flex-1" />
          {sel.size ? <View className="flex-row items-center gap-2"><ButtonGlyph name="triangle" /><Text className="font-heavy text-body text-cloud">{t('Ações')}</Text></View> : null}
          <View className="flex-row items-center gap-2"><ButtonGlyph name="circle" /><Text className="font-semi text-body text-mist">{t('Sair da seleção')}</Text></View>
        </View>
      ) : null}
      {actions ? (
        <Sheet title={tn(sel.size, '{n} selecionado', '{n} selecionados')} onClose={() => setActions(false)} width={620}>
          <View className="gap-2">
            {pickedArchives.length ? <Button primary label={t('Extrair')} onPress={() => { setActions(false); batchExtract(); }} /> : null}
            {picked.some(e => e.isDirectory) ? <Button label={t('Tirar arquivos das pastas')} onPress={async () => {
              setActions(false);
              const dirs = picked.filter(e => e.isDirectory);
              toast(t('Tirando os arquivos das pastas…'));
              let n = 0;
              for (const d of dirs) n += await flattenInto(d.full, path);
              toast(tn(n, '{n} arquivo agora solto nesta pasta', '{n} arquivos agora soltos nesta pasta'), 'ok');
              clearSel(); refresh();
            }} /> : null}
            <Button label={t('Copiar para…')} onPress={() => { setActions(false); batchCopy(false); }} />
            <Button label={t('Mover para…')} onPress={() => { setActions(false); batchCopy(true); }} />
            {sel.size === 1 ? <Button label={t('Renomear')} onPress={() => { const e = picked[0]; setActions(false); clearSel(); renameAt(e.full); }} /> : null}
            <Button label={sel.size === entries.length && entries.length ? 'Desmarcar tudo' : 'Marcar tudo nesta pasta'} onPress={() => { setActions(false); if (sel.size === entries.length && entries.length) setSel(new Map()); else selectAll(); }} />
            <Button danger label={t('Apagar')} onPress={() => { setActions(false); batchRemove(); }} />
          </View>
        </Sheet>
      ) : null}
      {menu ? (
        <Sheet title={menu.name} onClose={() => setMenu(null)} width={700}>
          <Text className="font-semi text-body text-mist">{`${fmt(menu.size)} · ${path}`}</Text>
          <View className="gap-2">
            {archiveKind(menu.name) ? <Button primary label={t('Extrair aqui')} onPress={() => {
              const first = firstVolume(`${path}/${menu.name}`);
              enqueueExtract(first, {deleteArchive: config.get().deleteArchive, flatten: config.get().flatten});
              toast(t('Extração na fila (veja em Downloads)'), 'ok'); setMenu(null);
            }} /> : null}
            <Button label={t('Copiar para…')} onPress={() => { const src = `${path}/${menu.name}`; setMenu(null);
              pickFolder(path, dest => { enqueueCopy(src, dest, false); toast(t('Cópia na fila'), 'ok'); }); }} />
            <Button label={t('Mover para…')} onPress={() => { const src = `${path}/${menu.name}`; setMenu(null);
              pickFolder(path, dest => { enqueueCopy(src, dest, true); toast(t('Movendo…'), 'ok'); }); }} />
            <Button label={t('Renomear')} onPress={() => { const e = menu; setMenu(null); rename(e); }} />
            <Button danger label={t('Apagar')} onPress={() => { const e = menu; setMenu(null); remove(e); }} />
          </View>
        </Sheet>
      ) : null}
    </View>
    </FocusScope>
  );
}

/* ---------- Armazenamento ---------- */
const CATS = [
  ['video', 'Vídeos', '#63b3ed', /\.(mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv)$/i],
  ['archive', 'Compactados', '#ffc857', /\.(rar|zip|7z|tar|tgz|gz|xz|\d{3}|r\d\d)$/i],
  ['package', 'Pacotes e imagens', '#e58bd8', /\.(pkg|exfat|ffpkg|ffpfs|ffpfsc|iso|img)$/i],
  ['audio', 'Áudio', '#57d9a3', /\.(mp3|flac|m4a|ogg|wav|aac)$/i],
  ['image', 'Imagens', '#9be7ff', /\.(jpe?g|png|gif|webp|bmp)$/i],
  ['partial', 'Downloads parciais', '#ff7a7a', /\.(part|partial)$/i],
];
const OTHER = ['other', 'Outros', '#6f84a3'];
function category(name) { for (const c of CATS) if (c[3].test(name)) return c[0]; return 'other'; }

// Leitura do disco em fatias curtas, cedendo a vez para a tela e a música a cada fatia.
// Durante uma exclusão (disco preso) a análise espera em vez de travar o app.
function useScan() {
  const [state, setState] = useState(null);
  const job = useRef(null);
  const start = root => {
    if (job.current) job.current.stop = true;
    const me = {stop: false};
    job.current = me;
    const cats = {}, top = [], dirs = {}, suggestions = [];
    let files = 0, bytes = 0;
    const stack = [[root, null]];
    const pending = new Set(queue.get().jobs.filter(j => j.state !== 'done').map(j => j.path));
    const step = () => {
      if (me.stop) return;
      if (fsBusy()) { setTimeout(step, 500); return; }
      const t0 = Date.now();
      while (stack.length && Date.now() - t0 < 8) {
        const [dir, topName] = stack.pop();
        let entries;
        try { entries = FileSystem.readDir(dir); } catch (_) { continue; }
        for (const e of entries) {
          const full = `${dir}/${e.name}`;
          const bucket = topName || e.name;
          if (e.isDirectory) { stack.push([full, bucket]); continue; }
          files++; bytes += e.size;
          const c = category(e.name);
          cats[c] = (cats[c] || 0) + e.size;
          dirs[bucket] = (dirs[bucket] || 0) + e.size;
          const item = {path: full, name: e.name, size: e.size, modified: e.modified, cat: c, bucket};
          if (top.length < 25 || e.size > top[top.length - 1].size) {
            top.push(item);
            top.sort((a, b) => b.size - a.size);
            if (top.length > 25) top.pop();
          }
          if (c === 'partial' && !pending.has(full.replace(/\.(part|partial)$/, ''))) {
            suggestions.push({...item, why: 'Download parcial abandonado'});
          } else if (archiveKind(e.name)) {
            const first = firstVolume(full);
            if (first && FileSystem.exists(`${dirname(full)}/${stripArchive(basename(first))}`)) {
              suggestions.push({...item, why: 'Compactado que parece já ter sido extraído'});
            }
          }
        }
      }
      setState({root, running: stack.length > 0, files, bytes, cats: {...cats}, top: top.slice(), suggestions: suggestions.slice().sort((a, b) => b.size - a.size).slice(0, 40),
        dirs: Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 12)});
      if (stack.length) setTimeout(step, 20);
    };
    step();
  };
  // Tira um arquivo apagado do resultado sem reler o disco inteiro.
  const drop = item => setState(s => {
    if (!s) return s;
    const cats = {...s.cats};
    if (item.cat) cats[item.cat] = Math.max(0, (cats[item.cat] || 0) - item.size);
    return {...s, files: Math.max(0, s.files - 1), bytes: Math.max(0, s.bytes - item.size), cats,
      top: s.top.filter(x => x.path !== item.path), suggestions: s.suggestions.filter(x => x.path !== item.path),
      dirs: s.dirs.map(([n, v]) => [n, n === item.bucket ? Math.max(0, v - item.size) : v]).sort((a, b) => b[1] - a[1])};
  });
  useEffect(() => () => { if (job.current) job.current.stop = true; }, []);
  return [state, start, () => { if (job.current) job.current.stop = true; setState(s => (s ? {...s, running: false} : s)); }, drop];
}

// Soma o tamanho de várias pastas em fatias curtas; chama onDone(tamanhos) no fim.
function sizeLater(paths, onDone, isStopped) {
  const sizes = paths.map(() => 0);
  const stack = paths.map((p, i) => [p, i]);
  const step = () => {
    if (isStopped()) return;
    const t0 = Date.now();
    while (stack.length && Date.now() - t0 < 8) {
      const [dir, i] = stack.pop();
      let entries;
      try { entries = FileSystem.readDir(dir); } catch (_) { continue; }
      for (const e of entries) { if (e.isDirectory) stack.push([`${dir}/${e.name}`, i]); else sizes[i] += e.size; }
    }
    if (stack.length) setTimeout(step, 20); else onDone(sizes);
  };
  step();
}
function statTime(path) { try { const st = FileSystem.stat(path); return st ? st.modified : 0; } catch (_) { return 0; } }

// Segunda linha de um arquivo: nome do jogo (quando o nome tem PPSA/CUSA) e data.
function FileMeta({item, extra}) {
  const title = gameTitle(item.name);
  const parts = [title, extra, item.modified ? t('modificado em {d}', {d: fmtDate(item.modified)}) : ''].filter(Boolean);
  return parts.length ? <Text className="font-semi text-cap text-mist" numberOfLines={1}>{parts.join(' · ')}</Text> : null;
}

export function Storage({confirm}) {
  const all = drives();
  useStore(ui, x => x.fsTick || 0);
  const busy = useStore(ui, x => (x.fsBusy || 0) > 0);
  const [scan, start, stop, drop] = useScan();
  const [apps, setApps] = useState(null);
  const [deleting, setDeleting] = useState({});
  const [detail, setDetail] = useState(null);
  // Duas vistas no topo: unidades (análise de espaço) e jogos instalados; assim nada fica
  // escondido no fim de uma página comprida.
  const [view, setView] = useState('drives');
  const appsJob = useRef(null);
  useEffect(() => () => { if (appsJob.current) appsJob.current.stop = true; }, []);
  const total = scan ? scan.bytes || 1 : 1;
  const remove = s => confirm('Apagar', `${t('Apagar “{1}”?', {1: s.name})} ${t('Não dá para desfazer.')}`, 'Apagar', () => {
    setDeleting(d => ({...d, [s.path]: true}));
    removeSafely(s.path).then(() => { toast(t('Apagado'), 'ok'); drop(s); },
      e => toast(String(e.message || e), 'bad'))
      .then(() => setDeleting(d => { const n = {...d}; delete n[s.path]; return n; }));
  });
  const loadApps = () => {
    if (appsJob.current) appsJob.current.stop = true;
    const me = {stop: false};
    appsJob.current = me;
    const root = appsRoot();
    let ids = [];
    try { ids = FileSystem.readDir(`${root}/app`).filter(e => e.isDirectory && /^[A-Z]{4}\d{5}$/.test(e.name)).map(e => e.name); } catch (_) { /* nenhum */ }
    ids = ids.filter(id => id !== 'PPSA48921');
    const out = [];
    setApps({loading: true, done: 0, total: ids.length, list: []});
    let i = 0;
    const next = () => {
      if (me.stop) return;
      if (i >= ids.length) { setApps({loading: false, list: out.slice().sort((a, b) => b.size - a.size)}); return; }
      const id = ids[i++];
      sizeLater([`${root}/app/${id}`, `${root}/patch/${id}`, `${root}/addcont/${id}`], ([app, patch, dlc]) => {
        const info = appInfo(id);
        out.push({id, title: info.title || id, version: info.version, installed: statTime(`${root}/app/${id}`), app, patch, dlc, size: app + patch + dlc});
        setApps({loading: true, done: i, total: ids.length, list: out.slice().sort((a, b) => b.size - a.size)});
        setTimeout(next, 20);
      }, () => me.stop);
    };
    setTimeout(next, 20);
  };
  const appList = apps ? apps.list : [];
  // Ao abrir a vista de jogos pela primeira vez, já calcula (em fatias, sem travar a tela).
  const openApps = () => { setView('apps'); if (!apps) loadApps(); };
  return (
    <View className="flex-1">
    <ScrollView className="flex-1 px-10">
      <View className="gap-4 pb-24">
        <View className="flex-row gap-3">
          <Button small primary={view === 'drives'} label={t('Unidades')} onPress={() => setView('drives')} />
          <Button small primary={view === 'apps'} label={appList.length ? t('Jogos instalados ({n})', {n: appList.length}) : t('Jogos instalados')} onPress={openApps} />
        </View>
        {view === 'drives' ? (
          <View className="gap-4">
            <View className="flex-row flex-wrap gap-4">
              {all.map(d => (
                <View key={d.path} className="w-[388px] gap-2 rounded-3xl bg-glass border-2 border-line px-6 py-4">
                  <Text className="font-heavy text-lead text-cloud">{t(d.label)}</Text>
                  <Text className="font-heavy text-h1 text-cloud">{t(`${fmt(d.free)} livres`)}</Text>
                  <Text className="font-semi text-cap text-mist">{t(`${fmt(d.total - d.free)} usados de ${fmt(d.total)}`)}</Text>
                  <Bar value={(d.total - d.free) / d.total} color={d.free / d.total < 0.1 ? 'bad' : 'sky'} h={12} />
                  <View className="flex-row mt-1"><Button small primary label={scan && scan.running && scan.root === d.path ? 'Analisando…' : 'Analisar'} onPress={() => start(d.path)} /></View>
                </View>
              ))}
            </View>
            {busy ? <Text className="font-semi text-body text-sun">{t('Apagando… o disco fica ocupado até terminar.')}</Text> : null}
            {scan ? (
              <View className="gap-3 rounded-3xl bg-glass border-2 border-line px-6 py-5">
                <View className="flex-row items-center gap-3">
                  <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{t(scan.running ? 'Analisando {r}: {b} em {n} arquivos' : 'Uso de {r}: {b} em {n} arquivos', {r: scan.root, b: fmt(scan.bytes), n: scan.files})}</Text></View>
                  {scan.running ? <Button small label={t('Parar')} onPress={stop} /> : null}
                </View>
                <View className="flex-row w-full h-[24px] rounded-full overflow-hidden bg-shade">
                  {CATS.concat([OTHER]).filter(c => scan.cats[c[0]]).map(c => (
                    <View key={c[0]} style={{width: `${(scan.cats[c[0]] / total * 100).toFixed(2)}%`, backgroundColor: c[2]}} />
                  ))}
                </View>
                <View className="flex-row flex-wrap gap-5">
                  {CATS.concat([OTHER]).filter(c => scan.cats[c[0]]).map(c => (
                    <View key={c[0]} className="flex-row items-center gap-2">
                      <View className="w-[16px] h-[16px] rounded-md" style={{backgroundColor: c[2]}} />
                      <Text className="font-semi text-cap text-cloud">{`${t(c[1])} · ${fmt(scan.cats[c[0]])}`}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : <Text className="font-semi text-body text-mist">{t('Escolha uma unidade e aperte Analisar para ver o que está ocupando espaço.')}</Text>}
            {scan && scan.suggestions.length ? (
              <View className="gap-3 rounded-3xl bg-glass border-2 border-line px-6 py-5">
                <Text className="font-heavy text-lead text-cloud">{t(`Sugestões de limpeza · até ${fmt(scan.suggestions.reduce((a, s) => a + s.size, 0))}`)}</Text>
                {scan.suggestions.slice(0, 12).map(s => (
                  <View key={s.path} className="flex-row items-center gap-3">
                    <View className="flex-1 gap-1">
                      <Text className="font-semi text-body text-cloud" numberOfLines={1}>{s.name}</Text>
                      <FileMeta item={s} extra={t(s.why)} />
                    </View>
                    <Text className="font-heavy text-body text-cloud">{fmt(s.size)}</Text>
                    {deleting[s.path] ? <Text className="font-semi text-cap text-sun">{t('Apagando…')}</Text>
                      : <Button small danger label={t('Apagar')} onPress={() => remove(s)} />}
                  </View>
                ))}
              </View>
            ) : null}
            {scan && scan.top.length ? (
              <View className="gap-3 rounded-3xl bg-glass border-2 border-line px-6 py-5">
                <View className="flex-row items-center gap-3">
                  <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{t('Maiores arquivos')}</Text></View>
                  <View className="flex-row items-center gap-2"><ButtonGlyph name="cross" /><Text className="font-semi text-cap text-mist">{t('para apagar')}</Text></View>
                </View>
                {scan.top.slice(0, 15).map(f => (
                  <View key={f.path} onPress={() => (deleting[f.path] ? null : remove(f))}
                    className="flex-row items-center gap-4 rounded-xl px-3 py-2 border-2 border-transparent focused:border-bad">
                    <View className="flex-1 gap-1">
                      <Text className="font-semi text-body text-cloud" numberOfLines={1}>{gameTitle(f.name) || f.name}</Text>
                      <FileMeta item={gameTitle(f.name) ? {...f, name: ''} : f} extra={gameTitle(f.name) ? f.name : (f.bucket === f.name ? '' : f.bucket)} />
                    </View>
                    <Text className="font-heavy text-body text-cloud">{deleting[f.path] ? t('Apagando…') : fmt(f.size)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {scan && scan.dirs.length ? (
              <View className="gap-2 rounded-3xl bg-glass border-2 border-line px-6 py-5">
                <Text className="font-heavy text-lead text-cloud">{t('Maiores pastas')}</Text>
                {scan.dirs.map(([name, size]) => (
                  // Focável só para a rolagem pelo controle chegar até aqui (sem isso a seção ficava fora de alcance).
                  <View key={name} onPress={() => {}} className="gap-1 rounded-xl px-3 py-1 border-2 border-transparent focused:border-rim">
                    <View className="flex-row justify-between gap-3">
                      <View className="flex-1 min-w-0 flex-row items-center gap-3">
                        <View className="flex-1 min-w-0"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{name}</Text></View>
                        {gameTitle(name) ? <View className="shrink max-w-[340px]"><Text className="font-heavy text-cap text-sky" numberOfLines={1}>{gameTitle(name)}</Text></View> : null}
                      </View>
                      <Text className="font-heavy text-body text-cloud">{fmt(size)}</Text>
                    </View>
                    <Bar value={size / (scan.dirs[0][1] || 1)} h={8} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View className="gap-3 rounded-3xl bg-glass border-2 border-line px-6 py-5">
            <View className="flex-row items-center gap-3">
              <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{t('Jogos e apps instalados')}</Text></View>
              <Button small label={apps && apps.loading ? t('Calculando… {a} de {b}', {a: apps.done, b: apps.total}) : apps ? 'Recalcular' : 'Calcular'} onPress={loadApps} />
            </View>
            <Text className="font-semi text-cap text-mist">{t('Jogo + atualizações + DLCs. Só visualização.')}</Text>
            {apps && !apps.loading && !appList.length ? <Text className="font-semi text-body text-mist">{t('Nenhum encontrado.')}</Text> : null}
            {appList.map(a => (
              <View key={a.id} onPress={() => setDetail(a)}
                className="gap-1 rounded-xl px-3 py-2 border-2 border-transparent focused:border-sun">
                <View className="flex-row justify-between gap-3">
                  <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{a.title}</Text></View>
                  <Text className="font-heavy text-body text-cloud">{fmt(a.size)}</Text>
                </View>
                <Text className="font-semi text-cap text-mist" numberOfLines={1}>{[
                  a.id,
                  a.version ? t('versão {v}', {v: a.version}) : '',
                  a.installed ? t('instalado em {d}', {d: fmtDate(a.installed)}) : '',
                  t('jogo {a}', {a: fmt(a.app)}),
                  a.patch ? t('atualização {a}', {a: fmt(a.patch)}) : '',
                  a.dlc ? t('DLC {a}', {a: fmt(a.dlc)}) : '',
                ].filter(Boolean).join(' · ')}</Text>
                <Bar value={a.size / (appList[0].size || 1)} h={8} color="sky" />
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
    {detail ? (
      <Sheet title={detail.title} onClose={() => setDetail(null)} width={700}>
        {[
          ['ID', detail.id],
          detail.version ? [t('Versão'), detail.version] : null,
          detail.installed ? [t('Instalado em'), fmtDate(detail.installed)] : null,
          [t('Jogo'), fmt(detail.app)],
          [t('Atualização'), fmt(detail.patch)],
          [t('DLC'), fmt(detail.dlc)],
          [t('Total'), fmt(detail.size)],
          [t('Pasta'), `${appsRoot()}/app/${detail.id}`],
        ].filter(Boolean).map(([k, v]) => (
          <View key={k} onPress={() => {}} className="flex-row justify-between gap-4 rounded-xl px-2 border-2 border-transparent focused:border-rim">
            <Text className="font-semi text-body text-mist">{k}</Text>
            <View className="flex-1 items-end"><Text className="font-heavy text-body text-cloud" numberOfLines={1}>{v}</Text></View>
          </View>
        ))}
      </Sheet>
    ) : null}
    </View>
  );
}
