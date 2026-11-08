// Janelas sobrepostas: item da nuvem, escolher pasta, conectar TorBox por QR, confirmar.
import {useEffect, useState} from 'react';
import {View, Text, FocusScope, ScrollView, FileSystem, Keyboard, Svg, Path, useFocus} from '@ps5-react/core';
import {Button, Cover, Pill} from './ui.jsx';
import {QR} from './qr.jsx';
import {config, useStore, toast, queue, ui} from './store.js';
import {drives} from './drives.js';
import {enqueueTorbox, fmt, watchItem} from './engine.js';
import * as torbox from './torbox.js';

export function Sheet({title, onClose, children, width = 820}) {
  return (
    <FocusScope trap autoFocus onBack={() => { onClose(); return true; }}>
      <View className="absolute inset-0 bg-shade items-center justify-center">
        <View style={{width}} className="max-h-[640px] rounded-3xl bg-haze2 p-7 gap-4 border-2 border-rim">
          <Text className="font-heavy text-h2 text-cloud">{title}</Text>
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
      <Text className="font-semi text-body text-cloud">{label}</Text>
    </View>
  );
}

/* item da nuvem: escolher arquivos, destino e extração */
export function ItemSheet({item, onClose, onPickFolder}) {
  const [armed, setArmed] = useState(false);
  const cfg = useStore(config);
  const jobs = useStore(queue, q => q.jobs);
  const doneIds = new Set(jobs.filter(j => j.tbKind === item.kind && j.itemId === item.id && j.state === 'done').map(j => j.fileId));
  const [picked, setPicked] = useState(() => new Set(item.files.filter(f => !doneIds.has(f.id)).map(f => f.id)));
  const [dest, setDest] = useState(cfg.defaultDest);
  const [extract, setExtract] = useState(cfg.autoExtract);
  const [del, setDel] = useState(cfg.deleteArchive);
  const files = item.files.filter(f => picked.has(f.id));
  const total = files.reduce((a, f) => a + f.size, 0);
  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const start = () => {
    if (!item.ready) {
      watchItem(item.kind, item.id, item.name, dest, {extract, deleteArchive: del});
      toast('Vou baixar assim que ficar pronto no TorBox', 'ok');
      onClose();
      return;
    }
    if (!files.length) { toast('Marque pelo menos um arquivo', 'bad'); return; }
    const n = enqueueTorbox(item, files, dest, {extract, deleteArchive: del});
    toast(n ? `${n} ${n > 1 ? 'arquivos' : 'arquivo'} na fila` : 'Esses arquivos já estão na fila', n ? 'ok' : 'info');
    onClose();
  };

  return (
    <Sheet title={item.name} onClose={onClose} width={900}>
      <View className="flex-row gap-5">
        <Cover name={item.name} w={210} h={118} />
        <View className="flex-1 gap-2 justify-center">
          <View className="flex-row gap-3 items-center">
            <Text className="font-semi text-body text-mist">{`${fmt(item.size)} · ${item.files.length} arquivo${item.files.length > 1 ? 's' : ''}`}</Text>
            {item.ready ? <Pill text="Pronto no TorBox" tone="ok" /> : <Pill text={`No TorBox: ${Math.round(item.progress * 100)}%`} tone="warn" />}
          </View>
          <View onPress={() => onPickFolder(dest, setDest)} className="flex-row items-center gap-3 px-3 h-[44px] rounded-xl bg-shade border-2 border-transparent focused:border-sun">
            <Text className="font-semi text-cap text-mist">Destino</Text>
            <Text className="font-semi text-body text-cloud">{dest}</Text>
          </View>
        </View>
      </View>
      {item.ready && item.files.length > 1 ? (
        <View className="flex-row items-center gap-3">
          <View className="flex-1"><Text className="font-semi text-cap text-mist">{`${picked.size} de ${item.files.length} arquivos marcados`}</Text></View>
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
                {doneIds.has(f.id) ? <Pill text="Já baixado" tone="ok" /> : null}
                <Text className="font-semi text-cap text-mist">{fmt(f.size)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      <View className="flex-row gap-2">
        <Toggle label="Extrair ao terminar" value={extract} onChange={setExtract} />
        <Toggle label="Apagar o compactado depois" value={del} onChange={setDel} />
      </View>
      <View className="flex-row gap-3 items-center">
        <Button primary focusKey="sheet-go" label={item.ready ? `Baixar ${fmt(total)}` : 'Baixar quando ficar pronto'} onPress={start} />
        <Button focusKey="sheet-cancel" label="Cancelar" onPress={onClose} />
        <View className="flex-1" />
        {/* Apagar do TorBox pede um segundo toque para confirmar. */}
        <Button danger focusKey="sheet-delete" label={armed === 'busy' ? 'Apagando…' : armed ? 'Confirmar exclusão' : 'Apagar do TorBox'}
          onPress={() => {
            if (armed === 'busy') return;
            if (!armed) { setArmed(true); return; }
            setArmed('busy');
            torbox.remove(item.kind, item.id).then(() => {
              ui.set({cloud: (ui.get().cloud || []).filter(x => !(x.kind === item.kind && x.id === item.id))});
              toast('Apagado do TorBox', 'ok'); onClose();
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
      const r = await Keyboard.open({title: 'Nome da nova pasta', maxLength: 80, type: 'basic'});
      if (r.status === 'done' && r.text.trim()) {
        const p = `${path}/${r.text.trim().replace(/[<>:"\\|?*/]/g, '_')}`;
        FileSystem.mkdir(p, {recursive: true});
        setPath(p);
      }
    } catch (e) { toast(String(e.message || e), 'bad'); }
  };
  return (
    <Sheet title="Escolher pasta" onClose={onClose}>
      <View className="flex-row gap-2 flex-wrap">
        {list.map(d => (
          <View key={d.path} onPress={() => setPath(d.path)} selected={drive === d}
            className="px-4 py-2 rounded-xl bg-shade border-2 border-transparent selected:border-sky focused:border-sun">
            <Text className="font-heavy text-cap text-cloud">{d.label}</Text>
            <Text className="font-semi text-xs2 text-mist">{`${fmt(d.free)} livres`}</Text>
          </View>
        ))}
      </View>
      <Text className="font-semi text-body text-mist">{path}</Text>
      <ScrollView className="max-h-[300px]">
        <View className="gap-1">
          {parent ? <View onPress={() => setPath(parent)} className="px-4 h-[42px] justify-center rounded-xl border-2 border-transparent focused:border-sun">
            <Text className="font-semi text-body text-mist">‹ Pasta acima</Text></View> : null}
          {entries.map(e => (
            <View key={e.name} onPress={() => setPath(`${path}/${e.name}`)} className="px-4 h-[42px] justify-center rounded-xl border-2 border-transparent focused:border-sun">
              <Text className="font-semi text-body text-cloud">{e.name}</Text>
            </View>
          ))}
          {!entries.length ? <Text className="font-body text-cap text-mist px-4">Nenhuma subpasta</Text> : null}
        </View>
      </ScrollView>
      <View className="flex-row gap-3">
        <Button primary label="Usar esta pasta" onPress={() => { onPick(path); onClose(); }} />
        <Button label="Nova pasta" onPress={newFolder} />
      </View>
    </Sheet>
  );
}

/* conectar TorBox por QR code */
export function ConnectSheet({onClose}) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const begin = () => {
    setError(''); setInfo(null);
    torbox.deviceStart().then(d => { setInfo(d); setLeft(d.expiresIn); }, e => setError(e.message));
  };
  useEffect(begin, []);
  useEffect(() => {
    if (!info) return undefined;
    let alive = true;
    const started = Date.now();
    const poll = async () => {
      if (!alive) return;
      if (info.expiresIn - Math.floor((Date.now() - started) / 1000) <= 0) return;
      const r = await torbox.deviceToken(info.deviceCode);
      if (!alive) return;
      if (r.token) {
        config.set({apiKey: r.token});
        toast('TorBox conectado!', 'ok');
        onClose(true);
        return;
      }
      if (r.expired) { setError('O código expirou.'); return; }
      setTimeout(poll, Math.max(2, info.interval) * 1000);
    };
    const t = setTimeout(poll, 2000);
    // Contagem regressiva própria, segundo a segundo (a consulta ao TorBox roda em outro ritmo).
    const tick = setInterval(() => {
      const remaining = info.expiresIn - Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { clearInterval(tick); setError('O código expirou.'); }
    }, 1000);
    return () => { alive = false; clearTimeout(t); clearInterval(tick); };
  }, [info]);
  return (
    <Sheet title="Conectar TorBox" onClose={() => onClose(false)} width={760}>
      {info ? (
        <View className="flex-row gap-7 items-center">
          <QR text={info.url} size={260} />
          <View className="flex-1 gap-3">
            <Text className="font-semi text-body text-mist">1. Escaneie com o celular</Text>
            <Text className="font-semi text-cap text-mist">{`ou abra ${info.shortUrl}`}</Text>
            <Text className="font-semi text-body text-mist">2. Faça login e digite o código</Text>
            <Text className="font-heavy text-hero text-sun">{info.code}</Text>
            <Text className="font-semi text-cap text-mist">
              {error || `Aguardando aprovação… expira em ${Math.floor(left / 60)}:${String(Math.max(0, left % 60)).padStart(2, '0')}`}
            </Text>
          </View>
        </View>
      ) : <Text className="font-semi text-body text-mist">{error || 'Gerando código…'}</Text>}
      <View className="flex-row gap-3">
        {error ? <Button primary label="Gerar outro código" onPress={begin} /> : null}
        <Button label="Fechar" onPress={() => onClose(false)} />
      </View>
    </Sheet>
  );
}

export function ConfirmSheet({title, text, ok = 'Confirmar', onOk, onClose}) {
  const {focus} = useFocus();
  useEffect(() => { setTimeout(() => focus('confirm-cancel'), 0); }, []);   // ação perigosa nunca é o padrão
  return (
    <Sheet title={title} onClose={onClose} width={640}>
      <Text className="font-body text-body text-cloud">{text}</Text>
      <View className="flex-row gap-3">
        <Button danger label={ok} onPress={() => { onOk(); onClose(); }} />
        <Button focusKey="confirm-cancel" label="Cancelar" onPress={onClose} />
      </View>
    </Sheet>
  );
}
