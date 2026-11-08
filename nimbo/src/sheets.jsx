// Janelas sobrepostas: item da nuvem, escolher pasta, conectar TorBox por QR, confirmar.
import {useEffect, useState} from 'react';
import {View, Text, FocusScope, ScrollView, FileSystem, Keyboard, Svg, Path, useFocus} from '@ps5-react/core';
import {Button, Cover, Pill, Flag} from './ui.jsx';
import {QR} from './qr.jsx';
import {config, useStore, toast, queue, ui} from './store.js';
import {drives} from './drives.js';
import {enqueueTorbox, fmt, watchItem} from './engine.js';
import {provider, PROVIDERS, jobOf} from './debrid/index.js';
import {phoneInfo, refreshPhonePage} from './phone.js';
import {t, tn, LANGS} from './i18n.js';

export function Sheet({title, onClose, children, width = 820}) {
  return (
    <FocusScope trap autoFocus onBack={() => { onClose(); return true; }}>
      <View className="absolute inset-0 bg-shade items-center justify-center">
        <View style={{width}} className="max-h-[640px] rounded-3xl bg-haze2 p-7 gap-4 border-2 border-rim">
          <Text className="font-heavy text-h2 text-cloud">{t(title)}</Text>
          {children}
        </View>
      </View>
    </FocusScope>
  );
}

function Toggle({label, value, onChange}) {
  return (
    <View onPress={() => onChange(!value)} className="flex-row items-center gap-3 px-3 h-[44px] rounded-xl border-2 border-transparent focused:border-sun">
      <View className={value ? 'w-[26px] h-[26px] rounded-md items-center justify-center bg-sun' : 'w-[26px] h-[26px] rounded-md items-center justify-center bg-shade border-2 border-rim'}>
        {value ? <Svg width={26} height={26} viewBox="0 0 26 26" style={{width: 26, height: 26}}><Path d="M6 13 L11 18 L20 8" stroke="#2b1d00" strokeWidth="3" strokeLinecap="round" fill="none" /></Svg> : null}
      </View>
      <Text className="font-semi text-body text-cloud">{t(label)}</Text>
    </View>
  );
}

/* item da nuvem: escolher arquivos, destino e extração */
export function ItemSheet({item: initial, onClose, onPickFolder}) {
  const [armed, setArmed] = useState(false);
  // Real-Debrid e AllDebrid só mandam a lista de arquivos quando o item é aberto.
  const [item, setItem] = useState(initial);
  const [loadErr, setLoadErr] = useState('');
  const prov = provider(item.provider);
  useEffect(() => {
    if (!initial.needsFiles || !initial.ready) return;
    prov.details(initial).then(full => { setItem(full); setPicked(new Set(full.files.filter(f => !doneIds.has(f.id)).map(f => f.id))); }, e => setLoadErr(e.message));
  }, []);
  const cfg = useStore(config);
  const jobs = useStore(queue, q => q.jobs);
  const doneIds = new Set(jobs.filter(j => jobOf(j, item) && j.state === 'done').map(j => j.fileId));
  const [picked, setPicked] = useState(() => new Set(item.files.filter(f => !doneIds.has(f.id)).map(f => f.id)));
  const [dest, setDest] = useState(cfg.defaultDest);
  const [extract, setExtract] = useState(cfg.autoExtract);
  const [del, setDel] = useState(cfg.deleteArchive);
  const files = item.files.filter(f => picked.has(f.id));
  const total = files.reduce((a, f) => a + f.size, 0);
  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const start = () => {
    if (!item.ready) {
      watchItem(item.kind, item.id, item.name, dest, {extract, deleteArchive: del}, item.provider || 'torbox');
      toast(`Vou baixar assim que ficar pronto no ${prov.name}`, 'ok');
      onClose();
      return;
    }
    if (item.needsFiles) { toast(loadErr || 'Ainda carregando a lista de arquivos…', loadErr ? 'bad' : 'info'); return; }
    if (!files.length) { toast(t('Marque pelo menos um arquivo'), 'bad'); return; }
    const n = enqueueTorbox(item, files, dest, {extract, deleteArchive: del});
    toast(n ? tn(n, '{n} arquivo na fila', '{n} arquivos na fila') : t('Esses arquivos já estão na fila'), n ? 'ok' : 'info');
    onClose();
  };

  return (
    <Sheet title={item.name} onClose={onClose} width={900}>
      <View className="flex-row gap-5">
        <Cover name={item.name} w={210} h={118} />
        <View className="flex-1 gap-2 justify-center">
          <View className="flex-row gap-3 items-center">
            <Text className="font-semi text-body text-mist">{item.needsFiles ? (item.ready ? `${fmt(item.size)} · ${t(loadErr || 'carregando arquivos…')}` : fmt(item.size)) : `${fmt(item.size)} · ${tn(item.files.length, '{n} arquivo', '{n} arquivos')}`}</Text>
            {item.ready ? <Pill text={t(`Pronto no ${prov.name}`)} tone="ok" /> : <Pill text={t(`No ${prov.name}: ${Math.round(item.progress * 100)}%`)} tone="warn" />}
          </View>
          <View onPress={() => onPickFolder(dest, setDest)} className="flex-row items-center gap-3 px-3 h-[44px] rounded-xl bg-shade border-2 border-transparent focused:border-sun">
            <Text className="font-semi text-cap text-mist">{t('Destino')}</Text>
            <Text className="font-semi text-body text-cloud">{dest}</Text>
          </View>
        </View>
      </View>
      {item.ready && item.files.length > 1 ? (
        <View className="flex-row items-center gap-3">
          <View className="flex-1"><Text className="font-semi text-cap text-mist">{t(`${picked.size} de ${item.files.length} arquivos marcados`)}</Text></View>
          <Button small label={picked.size === item.files.length ? 'Desmarcar todos' : 'Marcar todos'}
            onPress={() => setPicked(picked.size === item.files.length ? new Set() : new Set(item.files.map(f => f.id)))} />
        </View>
      ) : null}
      {item.ready && item.files.length > 1 ? (
        <ScrollView className="max-h-[230px]">
          <View className="gap-1">
            {item.files.map(f => (
              <View key={f.id} onPress={() => toggle(f.id)} className="flex-row items-center gap-3 px-3 h-[40px] rounded-xl border-2 border-transparent focused:border-sun">
                <View className={picked.has(f.id) ? 'w-[22px] h-[22px] rounded-md bg-sun items-center justify-center' : 'w-[22px] h-[22px] rounded-md bg-shade border-2 border-rim'}>
                  {picked.has(f.id) ? <Svg width={30} height={30} viewBox="0 0 26 26" style={{width: 30, height: 30}}><Path d="M6 13 L11 18 L20 8" stroke="#2b1d00" strokeWidth="3" strokeLinecap="round" fill="none" /></Svg> : null}
                </View>
                <View className="flex-1"><Text className="font-body text-cap text-cloud" numberOfLines={1}>{f.short}</Text></View>
                {doneIds.has(f.id) ? <Pill text={t('Já baixado')} tone="ok" /> : null}
                <Text className="font-semi text-cap text-mist">{fmt(f.size)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      <View className="flex-row gap-2">
        <Toggle label={t('Extrair ao terminar')} value={extract} onChange={setExtract} />
        <Toggle label={t('Apagar o compactado depois')} value={del} onChange={setDel} />
      </View>
      <View className="flex-row gap-3 items-center">
        <Button primary focusKey="sheet-go" label={item.ready ? `Baixar ${fmt(total)}` : 'Baixar quando ficar pronto'} onPress={start} />
        <Button focusKey="sheet-cancel" label={t('Cancelar')} onPress={onClose} />
        <View className="flex-1" />
        {/* Apagar do TorBox pede um segundo toque para confirmar. */}
        <Button danger focusKey="sheet-delete" label={armed === 'busy' ? 'Apagando…' : armed ? 'Confirmar exclusão' : 'Apagar da nuvem'}
          onPress={() => {
            if (armed === 'busy') return;
            if (!armed) { setArmed(true); return; }
            setArmed('busy');
            prov.remove(item).then(() => {
              ui.set({cloud: (ui.get().cloud || []).filter(x => !((x.provider || 'torbox') === (item.provider || 'torbox') && x.kind === item.kind && x.id === item.id))});
              toast(`Apagado do ${prov.name}`, 'ok'); onClose();
            }, e => { setArmed(false); toast(e.message, 'bad'); });
          }} />
      </View>
    </Sheet>
  );
}

/* escolher pasta de destino */
export function FolderSheet({start, onPick, onClose}) {
  const list = drives();
  const [path, setPath] = useState(start && FileSystem.exists(start) ? start : (list[0] && list[0].path) || FileSystem.dataDir);
  let entries = [];
  try { entries = FileSystem.readDir(path).filter(e => e.isDirectory && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)); } catch (_) { /* sem acesso */ }
  const drive = list.filter(d => path === d.path || path.startsWith(`${d.path}/`))[0];
  const parent = drive && path !== drive.path ? path.slice(0, path.lastIndexOf('/')) : null;
  const newFolder = async () => {
    try {
      const r = await Keyboard.open({title: t('Nome da nova pasta'), maxLength: 80, type: 'basic'});
      if (r.status === 'done' && r.text.trim()) {
        const p = `${path}/${r.text.trim().replace(/[<>:"\\|?*/]/g, '_')}`;
        FileSystem.mkdir(p, {recursive: true});
        setPath(p);
      }
    } catch (e) { toast(String(e.message || e), 'bad'); }
  };
  return (
    <Sheet title={t('Escolher pasta')} onClose={onClose}>
      <View className="flex-row gap-2 flex-wrap">
        {list.map(d => (
          <View key={d.path} onPress={() => setPath(d.path)} selected={drive === d}
            className="px-4 py-2 rounded-xl bg-shade border-2 border-transparent selected:border-sky focused:border-sun">
            <Text className="font-heavy text-cap text-cloud">{t(d.label)}</Text>
            <Text className="font-semi text-xs2 text-mist">{t(`${fmt(d.free)} livres`)}</Text>
          </View>
        ))}
      </View>
      <Text className="font-semi text-body text-mist">{path}</Text>
      <ScrollView className="max-h-[300px]">
        <View className="gap-1">
          {parent ? <View onPress={() => setPath(parent)} className="px-4 h-[42px] justify-center rounded-xl border-2 border-transparent focused:border-sun">
            <Text className="font-semi text-body text-mist">{t('‹ Pasta acima')}</Text></View> : null}
          {entries.map(e => (
            <View key={e.name} onPress={() => setPath(`${path}/${e.name}`)} className="px-4 h-[42px] justify-center rounded-xl border-2 border-transparent focused:border-sun">
              <Text className="font-semi text-body text-cloud">{e.name}</Text>
            </View>
          ))}
          {!entries.length ? <Text className="font-body text-cap text-mist px-4">{t('Nenhuma subpasta')}</Text> : null}
        </View>
      </ScrollView>
      <View className="flex-row gap-3">
        <Button primary label={t('Usar esta pasta')} onPress={() => { onPick(path); onClose(); }} />
        <Button label={t('Nova pasta')} onPress={newFolder} />
      </View>
    </Sheet>
  );
}

/* conectar TorBox por QR code */
// Logo simples do serviço: sigla na cor dele.
export function ServiceBadge({p, big}) {
  return (
    <View className={big ? 'w-[64px] h-[64px] rounded-2xl items-center justify-center' : 'w-[44px] h-[30px] rounded-lg items-center justify-center'} style={{backgroundColor: p.color}}>
      <Text className={big ? 'font-heavy text-h2 text-night' : 'font-heavy text-cap text-night'}>{p.short}</Text>
    </View>
  );
}

// Idioma do app (o nome de cada um aparece no próprio idioma).
export function LangSheet({onClose}) {
  const cur = useStore(config, c => c.lang || 'pt');
  const {focus} = useFocus();
  useEffect(() => { setTimeout(() => focus('lang-cur'), 0); }, []);
  return (
    <Sheet title={t('Idioma')} onClose={onClose} width={640}>
      <View className="gap-2">
        {LANGS.map(([code, name, flag]) => (
          <View key={code} focusKey={code === cur ? 'lang-cur' : undefined} onPress={() => { config.set({lang: code}); refreshPhonePage(); onClose(); }}
            className={code === cur ? 'flex-row items-center gap-4 rounded-2xl bg-haze2 px-5 py-3 border-[3px] border-sky focused:border-sun' : 'flex-row items-center gap-4 rounded-2xl bg-shade px-5 py-3 border-[3px] border-transparent focused:border-sun'}>
            <Flag code={flag} w={54} />
            <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{name}</Text></View>
            {code === cur ? <Svg width={30} height={30} viewBox="0 0 26 26" style={{width: 30, height: 30}}><Path d="M6 13 L11 18 L20 8" stroke="#ffc857" strokeWidth="3" strokeLinecap="round" fill="none" /></Svg> : null}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

// Escolher qual serviço conectar.
export function ServicesSheet({onPick, onClose}) {
  return (
    <Sheet title={t('Conectar um serviço')} onClose={onClose} width={760}>
      <Text className="font-semi text-body text-mist">{t('Use quantos quiser: a aba Nuvem junta todos.')}</Text>
      <View className="gap-2">
        {PROVIDERS.map((p, i) => (
          <View key={p.id} focusKey={i === 0 ? 'svc-first' : undefined} onPress={() => onPick(p.id)}
            className="flex-row items-center gap-4 rounded-2xl bg-shade px-4 py-3 border-[3px] border-transparent focused:border-sun">
            <ServiceBadge p={p} />
            <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{p.name}</Text></View>
            <Text className={p.linked() ? 'font-heavy text-cap text-ok' : 'font-semi text-cap text-mist'}>{t(p.linked() ? 'Conectado' : p.auth === 'key' ? 'Com chave da API' : 'Com QR code')}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row"><Button label={t('Fechar')} onPress={onClose} /></View>
    </Sheet>
  );
}

export function ConnectSheet({providerId, onClose}) {
  const p = provider(providerId);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const begin = () => {
    setError(''); setInfo(null);
    if (p.auth !== 'device') return;
    p.start().then(d => { setInfo(d); setLeft(d.expiresIn); }, e => setError(e.message));
  };
  useEffect(begin, []);
  useEffect(() => {
    if (!info) return undefined;
    let alive = true;
    const started = Date.now();
    const poll = async () => {
      if (!alive) return;
      if (info.expiresIn - Math.floor((Date.now() - started) / 1000) <= 0) return;
      const r = await p.poll(info.handle).catch(() => ({pending: true}));
      if (!alive) return;
      if (r.done) { toast(`${p.name} conectado!`, 'ok'); onClose(true); return; }
      if (r.expired) { setError('O código expirou.'); return; }
      setTimeout(poll, Math.max(3, info.interval) * 1000);
    };
    const tm = setTimeout(poll, 3000);
    // Contagem regressiva própria, segundo a segundo (a consulta ao serviço roda em outro ritmo).
    const tick = setInterval(() => {
      const remaining = info.expiresIn - Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { clearInterval(tick); setError('O código expirou.'); }
    }, 1000);
    return () => { alive = false; clearTimeout(t); clearInterval(tick); };
  }, [info]);

  // Premiumize: chave da API, digitada aqui ou colada pelo celular.
  if (p.auth === 'key') {
    const phone = phoneInfo();
    const phoneUrl = phone.address ? `http://${phone.address}:${phone.port}` : '';
    const typeKey = async () => {
      const r = await Keyboard.open({title: t(`Chave da API do ${p.name}`), type: 'basic', maxLength: 64});
      if (r.status !== 'done' || !r.text) return;
      setError('Conferindo a chave…');
      p.setKey(r.text).then(() => { toast(`${p.name} conectado!`, 'ok'); onClose(true); }, e => setError(e.message));
    };
    useEffect(() => {   // colada pelo celular: fecha sozinho quando a chave chega
      const tm = setInterval(() => { if (p.linked()) { clearInterval(tm); toast(`${p.name} conectado!`, 'ok'); onClose(true); } }, 1000);
      return () => clearInterval(tm);
    }, []);
    return (
      <Sheet title={t(`Conectar ${p.name}`)} onClose={() => onClose(false)} width={820}>
        <View className="flex-row gap-7 items-center">
          {phoneUrl ? <View className="rounded-2xl bg-cloud p-3"><QR text={phoneUrl} size={230} /></View> : null}
          <View className="flex-1 gap-3">
            <Text className="font-semi text-body text-mist">{t(`1. Pegue sua chave em ${p.keyUrl}`)}</Text>
            <Text className="font-semi text-body text-mist">{phoneUrl ? '2. Escaneie o QR, entre com o PIN e cole a chave em "Contas"' : '2. Digite a chave aqui no PS5'}</Text>
            {phoneUrl ? <Text className="font-heavy text-lead text-sun">{t(`${phone.address}:${phone.port} · PIN ${phone.pin}`)}</Text> : null}
            {error ? <Text className="font-semi text-cap text-mist">{t(error)}</Text> : null}
          </View>
        </View>
        <View className="flex-row gap-3">
          <Button primary label={t('Digitar a chave no PS5')} onPress={typeKey} />
          <Button label={t('Fechar')} onPress={() => onClose(false)} />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={t(`Conectar ${p.name}`)} onClose={() => onClose(false)} width={760}>
      {info ? (
        <View className="flex-row gap-7 items-center">
          <View className="rounded-2xl bg-cloud p-3"><QR text={info.qrUrl || info.url} size={240} /></View>
          <View className="flex-1 gap-3">
            <Text className="font-semi text-body text-mist">{t('1. Escaneie com o celular')}</Text>
            <Text className="font-semi text-cap text-mist">{t(`ou abra ${info.shortUrl}`)}</Text>
            <Text className="font-semi text-body text-mist">{t('2. Faça login e confirme o código')}</Text>
            <Text className="font-heavy text-h1 text-sun" numberOfLines={1}>{info.code}</Text>
            <Text className="font-semi text-cap text-mist">
              {error || `Aguardando aprovação… expira em ${Math.floor(left / 60)}:${String(Math.max(0, left % 60)).padStart(2, '0')}`}
            </Text>
          </View>
        </View>
      ) : <Text className="font-semi text-body text-mist">{error || 'Gerando código…'}</Text>}
      <View className="flex-row gap-3">
        {error ? <Button primary label={t('Gerar outro código')} onPress={begin} /> : null}
        <Button label={t('Fechar')} onPress={() => onClose(false)} />
      </View>
    </Sheet>
  );
}

export function ConfirmSheet({title, text, ok = 'Confirmar', onOk, onClose}) {
  const {focus} = useFocus();
  useEffect(() => { setTimeout(() => focus('confirm-cancel'), 0); }, []);   // ação perigosa nunca é o padrão
  return (
    <Sheet title={title} onClose={onClose} width={640}>
      <Text className="font-body text-body text-cloud">{t(text)}</Text>
      <View className="flex-row gap-3">
        <Button danger label={ok} onPress={() => { onOk(); onClose(); }} />
        <Button focusKey="confirm-cancel" label={t('Cancelar')} onPress={onClose} />
      </View>
    </Sheet>
  );
}
