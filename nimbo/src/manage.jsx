// Arquivos (gerenciador) e Armazenamento (análise de espaço).
import {useEffect, useRef, useState} from 'react';
import {View, Text, ScrollView, FileSystem, Keyboard, Platform, useFocus, FocusScope, Svg, Path} from '@ps5-react/core';
import {Bar, Button, Pill, ButtonGlyph} from './ui.jsx';
import {Sheet} from './sheets.jsx';
import {drives} from './drives.js';
import {config, queue, toast, ui, useStore} from './store.js';
import {archiveKind, enqueueCopy, enqueueExtract, fmt, firstVolume, stripArchive, basename, dirname} from './engine.js';
import {t, tn} from './i18n.js';

function list(path, sort = 'name') {
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => (b.size || 0) - (a.size || 0),
    date: (a, b) => (b.modified || 0) - (a.modified || 0),
  }[sort] || ((a, b) => a.name.localeCompare(b.name));
  try {
    return FileSystem.readDir(path).filter(e => !e.name.startsWith('.') && !/\.(part|resume|partial|complete)$/.test(e.name))
      .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : by(a, b)));
  } catch (_) { return null; }
}
const SORTS = [['name', 'Nome'], ['date', 'Mais novos'], ['size', 'Maiores']];

// Ícone por tipo: cor + sigla curta, legível de longe na TV.
const TYPE_BADGE = {
  video: ['VÍD', '#63b3ed'], archive: ['ZIP', '#ffc857'], package: ['PKG', '#e58bd8'], audio: ['SOM', '#57d9a3'],
  image: ['IMG', '#9be7ff'], partial: ['...', '#ff7a7a'], other: ['ARQ', '#6f84a3'],
};
function TypeIcon({entry}) {
  if (entry.isDirectory) {
    return (
      <View className="w-[34px] h-[26px] justify-end">
        <View className="w-[16px] h-[6px] rounded-md" style={{backgroundColor: '#4f9fe0'}} />
        <View className="w-[34px] h-[20px] rounded-md" style={{backgroundColor: '#63b3ed'}} />
      </View>
    );
  }
  const [label, color] = TYPE_BADGE[category(entry.name)] || TYPE_BADGE.other;
  return (
    <View className="w-[34px] h-[26px] rounded-md items-center justify-center" style={{backgroundColor: color}}>
      <Text className="font-heavy text-xs2 text-night">{t(label)}</Text>
    </View>
  );
}

/* ---------- Arquivos ---------- */
export function Files({pickFolder, confirm}) {
  const all = drives();
  const [path, setPath] = useState(all[0] ? all[0].path : FileSystem.dataDir);
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(null);
  const sort = useStore(config, c => c.filesSort || 'name');
  // Seleção múltipla: □ marca/desmarca o item com o cursor (arquivo ou pasta, em qualquer pasta).
  const [sel, setSel] = useState(() => new Map());   // caminho completo -> {name, isDirectory, size}
  const [selMode, setSelMode] = useState(false);
  const focused = useRef(null);
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
    const target = entries.length ? 'frow:0' : 'files-up';
    setTimeout(() => focus(target), 0);
  }, [path]);
  const tasks = useStore(queue, q => q.tasks);
  useEffect(() => setTick(t => t + 1), [tasks.length]);
  const entries = list(path, sort) || [];
  const drive = all.filter(d => path === d.path || path.startsWith(`${d.path}/`))[0];
  const up = drive && path !== drive.path ? dirname(path) : null;
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
    FileSystem.removeAsync(`${path}/${e.name}`).then(() => { toast(t('Apagado'), 'ok'); refresh(); }, err => toast(String(err.message || err), 'bad'));
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
    for (const e of picked) { try { await FileSystem.removeAsync(e.full); } catch (_) { fails++; } }
    toast(fails ? `${fails} não puderam ser apagados` : 'Apagados', fails ? 'bad' : 'ok');
    clearSel(); refresh();
  });
  const batchExtract = () => {
    for (const first of pickedArchives) enqueueExtract(first, {deleteArchive: config.get().deleteArchive});
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
      if (a !== 'square') return false;
      const e = entries.find(x => x.name === focused.current);
      if (!selMode) enterSel();
      if (e) toggle(e);
      return true;
    }} onBack={() => { if (selMode) { clearSel(); return true; } return false; }}>
    <View className="flex-1 px-10 gap-3">
      <View className="flex-row gap-2 items-center">
        {all.map(d => (
          <View key={d.path} selected={drive === d} onPress={() => setPath(d.path)}
            className="px-4 py-2 rounded-xl bg-glass border-[3px] border-transparent selected:border-sky focused:border-sun">
            <Text className="font-heavy text-cap text-cloud">{t(d.label)}</Text>
            <Text className="font-semi text-xs2 text-mist">{t(`${fmt(d.free)} livres`)}</Text>
          </View>
        ))}
        <View className="flex-1" />
        {up ? <Button small focusKey="files-up" label={t('Voltar uma pasta')} onPress={() => openDir(up)} /> : null}
        <Button small label={t(`Ordem: ${SORTS.find(x => x[0] === sort)[1]}`)} onPress={() => config.set({filesSort: SORTS[(SORTS.findIndex(x => x[0] === sort) + 1) % SORTS.length][0]})} />
        <Button small focusKey="files-select" label={selMode ? 'Sair da seleção' : 'Selecionar'} onPress={() => { if (selMode) clearSel(); else { enterSel(); if (entries.length) setTimeout(() => focus('frow:0'), 0); } }} />
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
          {!entries.length ? <Text className="font-semi text-body text-mist">{t('Pasta vazia.')}</Text> : null}
          {entries.slice(0, 400).map((e, i) => {
            const kind = e.isDirectory ? '' : archiveKind(e.name);
            return (
              <View key={e.name} focusKey={`frow:${i}`} onFocus={() => { focused.current = e.name; }}
                onPress={() => (selMode ? toggle(e) : e.isDirectory ? openDir(`${path}/${e.name}`) : setMenu(e))}
                className={sel.has(`${path}/${e.name}`) ? 'flex-row items-center gap-4 rounded-xl bg-haze2 px-5 h-[54px] border-[3px] border-sky focused:border-sun' : 'flex-row items-center gap-4 rounded-xl bg-glass px-5 h-[54px] border-[3px] border-transparent focused:border-sun'}>
                {selMode ? (
                  <View className={sel.has(`${path}/${e.name}`) ? 'w-[24px] h-[24px] rounded-md bg-sun items-center justify-center' : 'w-[24px] h-[24px] rounded-md bg-shade border-2 border-rim'}>
                    {sel.has(`${path}/${e.name}`) ? <Svg width={30} height={30} viewBox="0 0 26 26" style={{width: 30, height: 30}}><Path d="M6 13 L11 18 L20 8" stroke="#2b1d00" strokeWidth="3" strokeLinecap="round" fill="none" /></Svg> : null}
                  </View>
                ) : null}
                <TypeIcon entry={e} />
                <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{e.name}</Text></View>
                {kind === 'first' ? <Pill text={t('Compactado')} tone="warn" /> : null}
                <Text className="font-semi text-cap text-mist">{e.isDirectory ? t('Pasta') : fmt(e.size)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      {selMode ? (
        <View className="flex-row gap-2 items-center rounded-2xl bg-haze2 px-4 py-2 mb-[64px] border-2 border-sun">
          <Text className="font-heavy text-lead text-cloud">{sel.size ? `${tn(sel.size, '{n} selecionado', '{n} selecionados')}${pickedBytes ? ` · ${fmt(pickedBytes)}` : ''}` : t('Marque os itens com')}</Text>
          {!sel.size ? <ButtonGlyph name="cross" /> : null}
          <View className="flex-1" />
          {pickedArchives.length ? <Button small primary label={t('Extrair')} onPress={batchExtract} /> : null}
          {sel.size ? <Button small label={t('Copiar para…')} onPress={() => batchCopy(false)} /> : null}
          {sel.size ? <Button small label={t('Mover para…')} onPress={() => batchCopy(true)} /> : null}
          {sel.size === 1 ? <Button small label={t('Renomear')} onPress={() => { const e = picked[0]; clearSel(); renameAt(e.full); }} /> : null}
          {sel.size ? <Button small danger label={t('Apagar')} onPress={batchRemove} /> : null}
          <Button small label={sel.size === entries.length && entries.length ? 'Desmarcar tudo' : 'Tudo aqui'} onPress={() => (sel.size === entries.length && entries.length ? setSel(new Map()) : selectAll())} />
          <Button small label={t('Cancelar')} onPress={clearSel} />
        </View>
      ) : null}
      {menu ? (
        <Sheet title={menu.name} onClose={() => setMenu(null)} width={700}>
          <Text className="font-semi text-body text-mist">{`${fmt(menu.size)} · ${path}`}</Text>
          <View className="gap-2">
            {archiveKind(menu.name) ? <Button primary label={t('Extrair aqui')} onPress={() => {
              const first = firstVolume(`${path}/${menu.name}`);
              enqueueExtract(first, {deleteArchive: config.get().deleteArchive});
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
      const t0 = Date.now();
      while (stack.length && Date.now() - t0 < 12) {
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
          if (top.length < 25 || e.size > top[top.length - 1].size) {
            top.push({path: full, name: e.name, size: e.size});
            top.sort((a, b) => b.size - a.size);
            if (top.length > 25) top.pop();
          }
          if (c === 'partial' && !pending.has(full.replace(/\.(part|partial)$/, ''))) {
            suggestions.push({path: full, name: e.name, size: e.size, why: 'Download parcial abandonado'});
          } else if (archiveKind(e.name)) {
            const first = firstVolume(full);
            if (first && FileSystem.exists(`${dirname(full)}/${stripArchive(basename(first))}`)) {
              suggestions.push({path: full, name: e.name, size: e.size, why: 'Compactado que parece já ter sido extraído'});
            }
          }
        }
      }
      setState({root, running: stack.length > 0, files, bytes, cats: {...cats}, top: top.slice(), suggestions: suggestions.slice(0, 40),
        dirs: Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 12)});
      if (stack.length) setTimeout(step, 0);
    };
    step();
  };
  useEffect(() => () => { if (job.current) job.current.stop = true; }, []);
  return [state, start, () => { if (job.current) job.current.stop = true; setState(s => (s ? {...s, running: false} : s)); }];
}

function appsRoot() { return Platform.OS === 'ps5' ? '/user' : `${FileSystem.dataDir}/fake-user`; }
function dirSize(path, depth = 0) {
  let s = 0;
  try {
    for (const e of FileSystem.readDir(path)) s += e.isDirectory ? (depth < 12 ? dirSize(`${path}/${e.name}`, depth + 1) : 0) : e.size;
  } catch (_) { /* sem acesso */ }
  return s;
}
function titleOf(id) {
  const root = appsRoot();
  try {
    const txt = FileSystem.readFile(`${root}/appmeta/${id}/param.json`);
    const j = JSON.parse(txt.slice(txt.indexOf('{')));
    const lp = j.localizedParameters || {};
    const l = lp['pt-BR'] || lp[lp.defaultLanguage] || {};
    if (l.titleName) return l.titleName;
  } catch (_) { /* jogo de PS4 ou sem metadados */ }
  return id;
}

export function Storage({confirm}) {
  const all = drives();
  const [scan, start, stop] = useScan();
  const [apps, setApps] = useState(null);
  const total = scan ? scan.bytes || 1 : 1;
  const remove = s => confirm('Apagar', `${t('Apagar “{1}”?', {1: s.name})} ${t('Não dá para desfazer.')}`, 'Apagar', () => {
    FileSystem.removeAsync(s.path).then(() => { toast(t('Apagado'), 'ok'); start(scan.root); }, e => toast(String(e.message || e), 'bad'));
  });
  const loadApps = () => {
    setApps('loading');
    setTimeout(() => {
      const root = appsRoot();
      let ids = [];
      try { ids = FileSystem.readDir(`${root}/app`).filter(e => e.isDirectory && /^[A-Z]{4}\d{5}$/.test(e.name)).map(e => e.name); } catch (_) { /* nenhum */ }
      const out = ids.filter(id => id !== 'PPSA48921').map(id => {
        const app = dirSize(`${root}/app/${id}`), patch = dirSize(`${root}/patch/${id}`), dlc = dirSize(`${root}/addcont/${id}`);
        return {id, title: titleOf(id), app, patch, dlc, size: app + patch + dlc};
      }).sort((a, b) => b.size - a.size);
      setApps(out);
    }, 30);
  };
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-4 pb-24">
        <View className="flex-row flex-wrap gap-4">
          {all.map(d => (
            <View key={d.path} className="w-[388px] gap-2 rounded-3xl bg-glass px-6 py-4">
              <Text className="font-heavy text-lead text-cloud">{t(d.label)}</Text>
              <Text className="font-heavy text-h1 text-cloud">{t(`${fmt(d.free)} livres`)}</Text>
              <Text className="font-semi text-cap text-mist">{t(`${fmt(d.total - d.free)} usados de ${fmt(d.total)}`)}</Text>
              <Bar value={(d.total - d.free) / d.total} color={d.free / d.total < 0.1 ? 'bad' : 'sky'} h={12} />
              <View className="flex-row mt-1"><Button small primary label={scan && scan.running && scan.root === d.path ? 'Analisando…' : 'Analisar'} onPress={() => start(d.path)} /></View>
            </View>
          ))}
        </View>
        {scan ? (
          <View className="gap-3 rounded-3xl bg-glass px-6 py-5">
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
                  <Text className="font-semi text-cap text-cloud">{`${c[1]} · ${fmt(scan.cats[c[0]])}`}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : <Text className="font-semi text-body text-mist">{t('Escolha uma unidade e aperte Analisar para ver o que está ocupando espaço.')}</Text>}
        {scan && scan.suggestions.length ? (
          <View className="gap-2 rounded-3xl bg-glass px-6 py-5">
            <Text className="font-heavy text-lead text-cloud">{t(`Sugestões de limpeza · até ${fmt(scan.suggestions.reduce((a, s) => a + s.size, 0))}`)}</Text>
            {scan.suggestions.slice(0, 12).map(s => (
              <View key={s.path} className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="font-semi text-body text-cloud" numberOfLines={1}>{s.name}</Text>
                  <Text className="font-semi text-cap text-mist">{t(s.why)}</Text>
                </View>
                <Text className="font-heavy text-body text-cloud">{fmt(s.size)}</Text>
                <Button small danger label={t('Apagar')} onPress={() => remove(s)} />
              </View>
            ))}
          </View>
        ) : null}
        {scan && scan.dirs.length ? (
          <View className="flex-row gap-4">
            <View className="flex-1 gap-2 rounded-3xl bg-glass px-6 py-5">
              <Text className="font-heavy text-lead text-cloud">{t('Maiores pastas')}</Text>
              {scan.dirs.map(([name, size]) => (
                <View key={name} className="gap-1">
                  <View className="flex-row justify-between"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{name}</Text>
                    <Text className="font-heavy text-body text-cloud">{fmt(size)}</Text></View>
                  <Bar value={size / scan.dirs[0][1]} h={8} />
                </View>
              ))}
            </View>
            <View className="flex-1 gap-2 rounded-3xl bg-glass px-6 py-5">
              <Text className="font-heavy text-lead text-cloud">{t('Maiores arquivos')}</Text>
              {scan.top.slice(0, 12).map(f => (
                <View key={f.path} onPress={() => remove(f)} className="flex-row justify-between rounded-lg px-2 border-2 border-transparent focused:border-bad">
                  <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{f.name}</Text></View>
                  <Text className="font-heavy text-body text-cloud">{fmt(f.size)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <View className="gap-2 rounded-3xl bg-glass px-6 py-5">
          <View className="flex-row items-center gap-3">
            <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{t('Jogos e apps instalados')}</Text></View>
            <Button small label={apps === 'loading' ? 'Calculando…' : 'Calcular'} onPress={loadApps} />
          </View>
          <Text className="font-semi text-cap text-mist">{t('Jogo + atualizações + DLCs. Só visualização.')}</Text>
          {Array.isArray(apps) && !apps.length ? <Text className="font-semi text-body text-mist">{t('Nenhum encontrado.')}</Text> : null}
          {Array.isArray(apps) ? apps.slice(0, 40).map(a => (
            <View key={a.id} className="gap-1">
              <View className="flex-row justify-between gap-3">
                <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{`${a.title}  ·  ${a.id}`}</Text></View>
                <Text className="font-heavy text-body text-cloud">{fmt(a.size)}</Text>
              </View>
              <Bar value={a.size / apps[0].size} h={8} color="sky" />
            </View>
          )) : null}
        </View>
      </View>
    </ScrollView>
  );
}
