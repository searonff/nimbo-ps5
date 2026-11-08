// Nimbo V2 — gerenciador de downloads do TorBox, nativo para PS5 (PS5 React).
import {useEffect, useState, Component} from 'react';
import {AppRegistry, View, Text, Image, FocusScope, ScrollView, Screens, Screen, useFocus, Sound, BackHandler, Keyboard, Svg, Circle, Line} from '@ps5-react/core';
import {useRef} from 'react';
import icon from './sce_sys/icon0.png';
import {useInterfaceSounds} from './sounds.js';
import {config, queue, ui, useStore, toast} from './src/store.js';
import {Background, Speed, Hints, Ring, Bar, Pill, Button, Cover, Toast, hue, hsl} from './src/ui.jsx';
import {ItemSheet, FolderSheet, ConnectSheet, ConfirmSheet, Sheet} from './src/sheets.jsx';
import {QR} from './src/qr.jsx';
import {Files, Storage} from './src/manage.jsx';
import {startPhone, phoneInfo} from './src/phone.js';
import {drives} from './src/drives.js';
import {startEngine, jobAction, taskAction, clearFinished, fmt, fmtSpeed, fmtEta, applyRateLimit} from './src/engine.js';
import {syncMusic, applyMusicVolume} from './src/music.js';

// v2.0.1: música mais baixa também para quem já tinha a configuração salva
if (!config.get().volumeV2) config.set({musicVolume: 0.25, volumeV2: true});
import * as torbox from './src/torbox.js';

const TABS = [['home', 'Painel'], ['cloud', 'Nuvem'], ['downloads', 'Downloads'], ['files', 'Arquivos'], ['storage', 'Armazenamento'], ['settings', 'Ajustes']];

/* ---------- dados da nuvem compartilhados entre telas ---------- */
let cloudLoading = false;
export function loadCloud() {
  if (cloudLoading || !config.get().apiKey) return;
  cloudLoading = true;
  torbox.listAll().then(list => ui.set({cloud: list, cloudError: ''}), e => ui.set({cloudError: e.message}))
    .finally(() => { cloudLoading = false; });
}

/* ---------- Painel ---------- */
function Hero({onOpenCloud, onConnectPhone, onConnect}) {
  const linked = useStore(config, c => !!c.apiKey);
  const jobs = useStore(queue, q => q.jobs);
  const tasks = useStore(queue, q => q.tasks);
  const speed = useStore(ui, s => s.speed);
  const job = jobs.find(j => j.state === 'downloading');
  const task = tasks.find(t => t.state === 'running');
  const waiting = jobs.filter(j => j.state === 'queued').length;

  if (job || task) {
    const isJob = !!job;
    const value = isJob ? (job.size ? job.written / job.size : 0) : (task.total ? task.written / task.total : 0);
    const name = isJob ? job.name : task.name;
    const step = isJob ? 0 : task.type === 'extract' ? 1 : 1;
    const eta = isJob && speed > 0 && job.size ? (job.size - job.written) / speed : 0;
    const steps = isJob && job.extract ? ['Baixar', 'Extrair', 'Pronto'] : isJob ? ['Baixar', 'Pronto'] :
      task.type === 'extract' ? ['Baixado', 'Extrair', 'Pronto'] : ['Copiar', 'Pronto'];
    return (
      <View className="flex-row gap-10 items-center rounded-3xl bg-glass px-10 py-5">
        <Ring size={210} value={value} color={isJob ? '#ffc857' : '#63b3ed'} thick={16}>
          <Text className="font-heavy text-hero text-cloud">{`${Math.floor(value * 100)}%`}</Text>
        </Ring>
        <View className="flex-1 gap-3">
          <Text className="font-semi text-body text-mist">{isJob ? `Baixando agora${waiting ? ` · mais ${waiting} na fila` : ''}` :
            task.type === 'extract' ? 'Extraindo agora' : 'Copiando agora'}</Text>
          <Text className="font-heavy text-h1 text-cloud" numberOfLines={2}>{name}</Text>
          <View className="flex-row gap-6">
            {isJob ? <Text className="font-heavy text-lead text-sun">{fmtSpeed(speed)}</Text> : null}
            {eta ? <Text className="font-semi text-lead text-cloud">{`falta ${fmtEta(eta)}`}</Text> : null}
            <Text className="font-semi text-lead text-mist">{isJob ? `${fmt(job.written)} de ${fmt(job.size)}` : (task.total ? `${fmt(task.written)} de ${fmt(task.total)}` : task.written ? `${fmt(task.written)} extraídos` : 'Lendo o arquivo…')}</Text>
          </View>
          <View className="flex-row gap-2 items-center">
            {steps.map((s, i) => (
              <View key={s} className="flex-row items-center gap-2">
                <Pill text={s} tone={i < step ? 'ok' : i === step ? (isJob ? 'warn' : 'run') : 'muted'} />
                {i < steps.length - 1 ? <Text className="font-heavy text-body text-mist">›</Text> : null}
              </View>
            ))}
          </View>
          <View className="flex-row gap-3 mt-2">
            {isJob ? <Button focusKey="hero-main" small label="Pausar" onPress={() => jobAction(job.id, 'pause')} /> :
              <Button focusKey="hero-main" small label="Cancelar" onPress={() => taskAction(task.id, 'cancel')} />}
          </View>
        </View>
      </View>
    );
  }
  const done = jobs.filter(j => j.state === 'done').length;
  return (
    <View className="flex-row gap-10 items-center rounded-3xl bg-glass px-10 py-5">
      <Ring size={210} value={0} thick={16}>
        <Image source={icon} style={{width: 104, height: 104, borderRadius: 24}} />
      </Ring>
      <View className="flex-1 gap-3">
        <Text className="font-semi text-body text-mist">Tudo em dia</Text>
        <Text className="font-heavy text-h1 text-cloud">Nenhum download em andamento</Text>
        <Text className="font-semi text-lead text-mist">{done ? `${done} concluído${done > 1 ? 's' : ''} recentemente` : 'Escolha algo da sua nuvem para baixar'}</Text>
        <View className="flex-row gap-3 mt-2">
          {linked ? <Button focusKey="hero-main" primary label="Abrir a nuvem" onPress={onOpenCloud} />
            : <Button focusKey="hero-main" primary label="Conectar TorBox (QR code)" onPress={onConnect} />}
          <Button label="Usar pelo celular" onPress={onConnectPhone} />
        </View>
      </View>
    </View>
  );
}

function UpNext() {
  const jobs = useStore(queue, q => q.jobs);
  const tasks = useStore(queue, q => q.tasks);
  const next = jobs.filter(j => ['queued', 'paused'].includes(j.state)).slice(0, 4);
  const failed = jobs.filter(j => j.state === 'error').length + tasks.filter(t => t.state === 'error').length;
  return (
    <View className="flex-1 gap-2 rounded-3xl bg-glass px-6 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud">A seguir</Text></View>
        {failed ? <Pill text={`${failed} com erro · veja em Downloads`} tone="bad" /> : null}
      </View>
      {next.length ? next.map(j => (
        <View key={j.id} className="flex-row items-center gap-3">
          <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{j.name}</Text></View>
          <Text className="font-semi text-cap text-mist">{fmt(j.size)}</Text>
          <Pill text={j.state === 'queued' ? 'Na fila' : 'Pausado'} tone="muted" />
        </View>
      )) : <Text className="font-body text-body text-mist">A fila está vazia.</Text>}
    </View>
  );
}

function Drives() {
  const [list, setList] = useState(drives());
  useEffect(() => { const t = setInterval(() => setList(drives()), 10000); return () => clearInterval(t); }, []);
  return (
    <View className="flex-1 gap-2 rounded-3xl bg-glass px-6 py-4">
      <Text className="font-heavy text-lead text-cloud">Unidades</Text>
      {list.map(d => (
        <View key={d.path} className="gap-2">
          <View className="flex-row justify-between">
            <Text className="font-semi text-body text-cloud">{d.label}</Text>
            <Text className="font-semi text-body text-mist">{`${fmt(d.free)} livres de ${fmt(d.total)}`}</Text>
          </View>
          <Bar value={(d.total - d.free) / d.total} color={d.free / d.total < 0.1 ? 'bad' : 'sky'} h={12} />
        </View>
      ))}
    </View>
  );
}

function CloudCard({item, onOpen, focusKey}) {
  const jobs = useStore(queue, q => q.jobs);
  const mine = jobs.filter(j => j.tbKind === item.kind && j.itemId === item.id);
  const done = mine.length && mine.filter(j => j.state === 'done').length === item.files.length;
  const busy = mine.some(j => j.state !== 'done');
  return (
    <View focusKey={focusKey} onPress={() => onOpen(item)}
      className="w-[220px] rounded-2xl bg-haze border-[3px] border-transparent focused:border-sun focused:scale-105 transition-transform duration-150">
      <Cover name={item.name} w={327} h={132} radius={14} />
      <View className="p-3 gap-1">
        <Text className="font-heavy text-body text-cloud" numberOfLines={1}>{item.name}</Text>
        <View className="flex-row gap-2 items-center">
          <Text className="font-semi text-cap text-mist">{fmt(item.size)}</Text>
          {done ? <Pill text="Já baixado" tone="ok" /> : mine.some(j => j.state === 'downloading') ? <Pill text="Baixando" tone="warn" /> : busy ? <Pill text="Na fila" tone="run" /> :
            item.ready ? <Pill text="Pronto" tone="ok" /> : <Pill text={`${Math.round(item.progress * 100)}%`} tone="warn" />}
        </View>
      </View>
    </View>
  );
}

function Home({openItem, goCloud, connectPhone, openConnect}) {
  const cloud = useStore(ui, s => s.cloud);
  const recent = (cloud || []).slice(0, 8);
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-4 pb-24">
        <Hero onOpenCloud={goCloud} onConnectPhone={connectPhone} onConnect={openConnect} />
        <View className="flex-row gap-6">
          <UpNext />
          <Drives />
        </View>
        {recent.length ? (
          <View className="gap-3">
            <Text className="font-heavy text-lead text-cloud">Recentes na nuvem</Text>
            <View className="flex-row gap-5">
              {recent.slice(0, 5).map(it => <CloudCard key={`${it.kind}:${it.id}`} focusKey={`card:${it.kind}:${it.id}`} item={it} onOpen={openItem} />)}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/* Se uma tela quebrar, mostra o erro em vez de ficar em branco. */
class Guard extends Component {
  constructor(props) { super(props); this.state = {error: null}; }
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) { console.log('[nimbo] tela quebrou:', error && error.stack || error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View className="px-10 gap-3 items-start">
        <Text className="font-heavy text-h2 text-bad">Algo deu errado nesta tela</Text>
        <Text className="font-semi text-body text-mist">{String(this.state.error && this.state.error.message || this.state.error)}</Text>
        <Button primary label="Tentar de novo" onPress={() => this.setState({error: null})} />
      </View>
    );
  }
}

/* ---------- Nuvem ---------- */
const KIND_LABEL = {torrents: 'Torrent', webdl: 'Web', usenet: 'Usenet'};
// Busca da Nuvem: teclado do PS5; sem diferenciar maiúsculas nem acentos.
const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
async function searchCloud() {
  const r = await Keyboard.open({title: 'Buscar na nuvem', text: ui.get().cloudQuery || '', type: 'basic', maxLength: 100});
  if (r.status === 'done') ui.set({cloudQuery: (r.text || '').trim()});
}
const FILTERS = [['all', 'Todos'], ['ready', 'Prontos'], ['busy', 'No TorBox'], ['torrents', 'Torrent'], ['webdl', 'Web'], ['usenet', 'Usenet']];
const SORTS = [['recent', 'Mais recentes'], ['name', 'Nome'], ['size', 'Maiores']];

function Chip({label, on, onPress, focusKey}) {
  return (
    <View focusKey={focusKey} onPress={onPress}
      className={on ? 'px-4 h-[38px] justify-center rounded-full bg-sun border-2 border-transparent focused:border-cloud' : 'px-4 h-[38px] justify-center rounded-full bg-glass border-2 border-transparent focused:border-sun'}>
      <Text className={on ? 'font-heavy text-cap text-night' : 'font-heavy text-cap text-cloud'}>{label}</Text>
    </View>
  );
}

function SearchGlyph() {
  return (
    <Svg width={30} height={30} viewBox="0 0 28 28" style={{width: 30, height: 30}}>
      <Circle cx="12" cy="12" r="7" stroke="#f2f5f9" strokeWidth="2.6" fill="none" />
      <Line x1="17.5" y1="17.5" x2="23" y2="23" stroke="#f2f5f9" strokeWidth="2.8" strokeLinecap="round" />
    </Svg>
  );
}

function Cloud({openItem, openConnect}) {
  const [limit, setLimit] = useState(40);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const linked = useStore(config, c => !!c.apiKey);
  const cloud = useStore(ui, s => s.cloud);
  const error = useStore(ui, s => s.cloudError);
  const query = useStore(ui, s => s.cloudQuery || '');
  const jobs = useStore(queue, q => q.jobs);
  if (!linked) return (
    <View className="px-10 gap-4 items-start">
      <Text className="font-heavy text-h1 text-cloud">Conecte o TorBox para ver sua nuvem</Text>
      <Text className="font-semi text-lead text-mist">O resto do app (Arquivos, Armazenamento, links diretos pelo celular) já funciona sem conta.</Text>
      <Button primary focusKey="cloud-connect" label="Conectar TorBox (QR code)" onPress={openConnect} />
    </View>
  );
  if (error) return (
    <View className="px-10 gap-4 items-start">
      <Text className="font-heavy text-h2 text-bad">Não deu para carregar a nuvem</Text>
      <Text className="font-semi text-lead text-mist">{error}</Text>
      <Button primary focusKey="cloud-retry" label="Tentar de novo" onPress={() => { ui.set({cloudError: '', cloud: null}); loadCloud(); }} />
    </View>
  );
  if (!cloud) return <View className="px-10"><Text className="font-semi text-lead text-mist">Carregando sua nuvem…</Text></View>;
  if (!cloud.length) return <View className="px-10"><Text className="font-semi text-lead text-mist">Sua nuvem está vazia. Mande um link pelo celular.</Text></View>;
  const q = fold(query);
  let list = cloud.filter(it => (!q || fold(it.name).includes(q) || it.files.some(f => fold(f.short).includes(q))) &&
    (filter === 'all' || (filter === 'ready' ? it.ready : filter === 'busy' ? !it.ready : it.kind === filter)));
  if (sort === 'name') list = list.slice().sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  if (sort === 'size') list = list.slice().sort((a, b) => b.size - a.size);
  const shown = list.slice(0, limit);
  const nextSort = () => setSort(SORTS[(SORTS.findIndex(x => x[0] === sort) + 1) % SORTS.length][0]);
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-2 pb-24">
        <View className="flex-row items-center gap-2 flex-wrap mb-1">
          <View focusKey="cloud-search" onPress={searchCloud}
            className="flex-row items-center gap-2 pl-3 pr-4 h-[38px] rounded-full bg-haze2 border-2 border-transparent focused:border-sun">
            <SearchGlyph />
            <Text className={query ? 'font-heavy text-cap text-cloud' : 'font-heavy text-cap text-mist'}>{query ? `“${query}”` : 'Buscar'}</Text>
          </View>
          {query ? <Chip label="Limpar busca" onPress={() => ui.set({cloudQuery: ''})} /> : null}
          <View className="w-[8px]" />
          {FILTERS.map(([id, label]) => <Chip key={id} label={label} on={filter === id} onPress={() => { setFilter(id); setLimit(40); }} />)}
          <View className="flex-1" />
          <Chip label={`Ordem: ${SORTS.find(x => x[0] === sort)[1]}`} onPress={nextSort} />
        </View>
        <Text className="font-semi text-cap text-mist">{list.length === cloud.length ? `${cloud.length} ite${cloud.length > 1 ? 'ns' : 'm'} na nuvem` : `${list.length} de ${cloud.length} itens`}</Text>
        {!list.length ? <Text className="font-semi text-lead text-mist mt-4">{query ? `Nada encontrado para “${query}”.` : 'Nenhum item neste filtro.'}</Text> : null}
        {shown.map(it => {
          const mine = jobs.filter(j => j.tbKind === it.kind && j.itemId === it.id);
          const done = mine.length && mine.filter(j => j.state === 'done').length === it.files.length;
          return (
            <View key={`${it.kind}:${it.id}`} onPress={() => openItem(it)}
              className="flex-row items-center gap-5 rounded-2xl bg-glass px-4 py-3 border-[3px] border-transparent focused:border-sun">
              <Cover name={it.name} w={150} h={84} radius={10} />
              <View className="flex-1 gap-1">
                <Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{it.name}</Text>
                <Text className="font-semi text-cap text-mist">{`${KIND_LABEL[it.kind]} · ${fmt(it.size)} · ${it.files.length} arquivo${it.files.length > 1 ? 's' : ''}`}</Text>
              </View>
              {done ? <Pill text="Já baixado" tone="ok" /> : mine.some(j => j.state !== 'done') ? <Pill text="Na fila" tone="run" /> : null}
              {it.ready ? <Pill text="Pronto" tone="ok" /> : <Pill text={`No TorBox ${Math.round(it.progress * 100)}%`} tone="warn" />}
            </View>
          );
        })}
        {list.length > limit ? <View className="flex-row"><Button label={`Mostrar mais (${list.length - limit} restantes)`} onPress={() => setLimit(n => n + 40)} /></View> : null}
      </View>
    </ScrollView>
  );
}

/* ---------- Downloads ---------- */
const STATE = {queued: ['Na fila', 'muted'], downloading: ['Baixando', 'warn'], paused: ['Pausado', 'muted'], done: ['Concluído', 'ok'], error: ['Erro', 'bad']};
const TSTATE = {queued: ['Na fila', 'muted'], running: ['Em andamento', 'run'], done: ['Concluído', 'ok'], error: ['Erro', 'bad'], canceled: ['Cancelado', 'muted']};
const TTYPE = {extract: 'Extrair', copy: 'Copiar', move: 'Mover'};
function JobRow({j, speed}) {
  const v = j.size ? j.written / j.size : j.state === 'done' ? 1 : 0;
  const [label, tone] = STATE[j.state];
  return (
    <View className="gap-2 rounded-2xl bg-glass px-5 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{j.name}</Text></View>
        <Pill text={label} tone={tone} />
      </View>
      <Bar value={v} color={j.state === 'done' ? 'ok' : j.state === 'error' ? 'bad' : j.state === 'downloading' ? 'sun' : 'rim'} />
      <View className="flex-row items-center gap-4">
        <View className="flex-1"><Text className="font-semi text-cap text-mist" numberOfLines={1}>
          {j.error || `${fmt(j.written)} de ${fmt(j.size)}${j.state === 'downloading' && speed ? ` · ${fmtSpeed(speed)}` : ''} · ${j.path}`}
        </Text></View>
        {j.state === 'downloading' ? <Button small label="Pausar" onPress={() => jobAction(j.id, 'pause')} /> : null}
        {['paused', 'error'].includes(j.state) ? <Button small label="Retomar" onPress={() => jobAction(j.id, 'resume')} /> : null}
        {j.state === 'queued' ? <Button small label="Baixar primeiro" onPress={() => jobAction(j.id, 'first')} /> : null}
        {j.state !== 'done' ? <Button small label="Cancelar" onPress={() => jobAction(j.id, 'cancel')} /> : null}
      </View>
    </View>
  );
}

function TaskRow({t}) {
  const [label, tone] = TSTATE[t.state];
  const v = t.state === 'done' ? 1 : t.total ? t.written / t.total : 0;
  return (
    <View className="gap-2 rounded-2xl bg-glass px-5 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{`${TTYPE[t.type]}: ${t.name}`}</Text></View>
        {t.auto ? <Pill text="automático" /> : null}
        <Pill text={label} tone={tone} />
      </View>
      <Bar value={v} color={t.state === 'error' ? 'bad' : 'sky'} />
      <View className="flex-row items-center gap-4">
        <View className="flex-1"><Text className="font-semi text-cap text-mist" numberOfLines={1}>{t.error || t.result || t.dest}</Text></View>
        {t.state === 'running' || t.state === 'queued' ? <Button small label="Cancelar" onPress={() => taskAction(t.id, 'cancel')} /> : null}
        {t.state === 'error' ? <Button small label="Tentar de novo" onPress={() => taskAction(t.id, 'retry')} /> : null}
      </View>
    </View>
  );
}

function Downloads() {
  const q = useStore(queue);
  const speed = useStore(ui, s => s.speed);
  const active = q.jobs.filter(j => j.state !== 'done');
  const done = q.jobs.filter(j => j.state === 'done').slice(-6).reverse();
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-3 pb-24">
        <View className="flex-row items-center justify-between">
          <Text className="font-heavy text-h2 text-cloud">Baixando</Text>
          <Button small label="Limpar concluídos" onPress={clearFinished} />
        </View>
        {active.length ? active.map(j => <JobRow key={j.id} j={j} speed={speed} />) :
          <Text className="font-semi text-body text-mist">Nada baixando agora.</Text>}
        {q.watches.length ? <Text className="font-semi text-body text-sky">{`Aguardando ficar pronto no TorBox: ${q.watches.map(w => w.name).join(', ')}`}</Text> : null}
        <Text className="font-heavy text-h2 text-cloud mt-4">Extraindo e copiando</Text>
        {q.tasks.length ? q.tasks.slice().reverse().map(t => <TaskRow key={t.id} t={t} />) :
          <Text className="font-semi text-body text-mist">Nenhuma tarefa.</Text>}
        {done.length ? <Text className="font-heavy text-h2 text-cloud mt-4">Concluídos</Text> : null}
        {done.map(j => <JobRow key={j.id} j={j} />)}
      </View>
    </ScrollView>
  );
}

/* ---------- Ajustes ---------- */
function Row({label, value, onPress}) {
  return (
    <View onPress={onPress} className="flex-row items-center justify-between rounded-2xl bg-glass px-6 h-[64px] border-[3px] border-transparent focused:border-sun">
      <Text className="font-semi text-lead text-cloud">{label}</Text>
      <Text className="font-heavy text-lead text-sun">{value}</Text>
    </View>
  );
}
function Settings({openConnect, pickFolder, confirm}) {
  const c = useStore(config);
  const flip = k => () => { config.set({[k]: !c[k]}); if (k === 'music') setTimeout(syncMusic, 0); if (k === 'speedLimitOn') setTimeout(applyRateLimit, 0); };
  const onOff = v => (v ? 'Ligado' : 'Desligado');
  const cycle = (k, list) => () => { const i = list.indexOf(c[k]); config.set({[k]: list[(i + 1) % list.length]}); setTimeout(applyRateLimit, 0); };
  const [account, setAccount] = useState('');
  useEffect(() => { if (c.apiKey) torbox.me().then(a => setAccount(`${a.email} · ${a.plan}`), () => setAccount('')); }, [c.apiKey]);
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-3 pb-24">
        <Text className="font-heavy text-h2 text-cloud">TorBox</Text>
        <Row label={c.apiKey ? `Conta: ${account || 'conectada'}` : 'Conta não conectada'} value={c.apiKey ? 'Reconectar' : 'Conectar'} onPress={openConnect} />
        <Text className="font-heavy text-h2 text-cloud mt-3">Downloads</Text>
        <Row label="Pasta padrão" value={c.defaultDest} onPress={() => pickFolder(c.defaultDest, p => config.set({defaultDest: p}))} />
        <Row label="Conexões por download" value={String(c.connections)} onPress={cycle('connections', [4, 8, 16, 32])} />
        <Row label="Limitar velocidade" value={c.speedLimitOn ? 'Ligado' : 'Desligado'} onPress={flip('speedLimitOn')} />
        {c.speedLimitOn ? <Row label="Velocidade máxima" value={`${c.speedLimitMB} MB/s`} onPress={cycle('speedLimitMB', [1, 2, 5, 10, 20, 50])} /> : null}
        <Row label="Impedir o modo de repouso" value={onOff(c.keepAwake)} onPress={flip('keepAwake')} />
        <Row label="Apagar do TorBox depois de baixar" value={onOff(c.deleteFromCloud)} onPress={flip('deleteFromCloud')} />
        <Text className="font-heavy text-h2 text-cloud mt-3">Extração</Text>
        <Row label="Extrair automaticamente" value={onOff(c.autoExtract)} onPress={flip('autoExtract')} />
        <Row label="Apagar o compactado depois" value={onOff(c.deleteArchive)} onPress={flip('deleteArchive')} />
        <Row label="Senhas cadastradas" value={`${c.passwords.length} · adicionar`} onPress={async () => {
          const r = await Keyboard.open({title: 'Nova senha de arquivo', type: 'basic', maxLength: 200});
          if (r.status === 'done' && r.text) { config.set({passwords: [...new Set(c.passwords.concat([r.text]))]}); toast('Senha adicionada', 'ok'); }
        }} />
        {c.passwords.length ? <Row label="Apagar todas as senhas" value="Apagar" onPress={() => confirm('Apagar senhas', 'Apagar todas as senhas cadastradas?', 'Apagar', () => config.set({passwords: []}))} /> : null}
        <Text className="font-heavy text-h2 text-cloud mt-3">Som</Text>
        <Row label="Música de fundo" value={onOff(c.music)} onPress={flip('music')} />
        <Row label="Volume da música" value={`${Math.round(c.musicVolume * 100)}%`} onPress={() => { cycle('musicVolume', [0.1, 0.25, 0.4, 0.6, 0.8])(); applyMusicVolume(); }} />
        <Row label="Sons da interface" value={onOff(c.sfx)} onPress={flip('sfx')} />
        <Text className="font-semi text-cap text-mist mt-4">Nimbo Downloader 2.0.1 · música e arte originais · interface com PS5 React</Text>
      </View>
    </ScrollView>
  );
}

/* ---------- celular ---------- */
function PhoneSheet({onClose}) {
  const [info, setInfo] = useState(phoneInfo());
  useEffect(() => { const t = setInterval(() => setInfo(phoneInfo()), 1000); return () => clearInterval(t); }, []);
  const url = info.address && info.port ? `http://${info.address}:${info.port}` : '';
  return (
    <Sheet title="Usar pelo celular" onClose={onClose} width={820}>
      {url ? (
        <View className="flex-row gap-7 items-center">
          <QR text={url} size={250} />
          <View className="flex-1 gap-3">
            <Text className="font-semi text-body text-mist">Aponte a câmera do celular (mesmo Wi-Fi do PS5) ou abra:</Text>
            <Text className="font-heavy text-lead text-cloud">{url}</Text>
            <Text className="font-semi text-body text-mist">PIN</Text>
            <Text className="font-heavy text-hero text-sun">{info.pin}</Text>
            <Text className="font-semi text-cap text-mist">Pelo celular dá para mandar links, ver a fila e baixar da nuvem.</Text>
          </View>
        </View>
      ) : <Text className="font-semi text-body text-mist">{info.state === 'failed' ? 'Não consegui abrir a porta do celular.' : 'Ligando o servidor do celular…'}</Text>}
      <View className="flex-row"><Button primary label="Fechar" onPress={onClose} /></View>
    </Sheet>
  );
}

/* ---------- casca do app ---------- */
// Deslize com direção: sai rápido para um lado, entra desacelerando pelo outro.
const ENTER_T = {type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1]};
const LEAVE_T = {type: 'tween', duration: 0.13, ease: 'easeIn'};
const SLIDE_RIGHT = {hidden: {x: 120, opacity: 0}, shown: {x: 0, opacity: 1, transition: ENTER_T}, gone: {x: -120, opacity: 0, transition: LEAVE_T}};
const SLIDE_LEFT = {hidden: {x: -120, opacity: 0}, shown: {x: 0, opacity: 1, transition: ENTER_T}, gone: {x: 120, opacity: 0, transition: LEAVE_T}};

function App() {
  const c = useStore(config);
  const [{tab, dir}, setNav] = useState({tab: 0, dir: 1});
  // Troca de aba com direção: R1/direita entra pela direita, L1/esquerda entra pela esquerda.
  const setTab = next => setNav(cur => {
    const to = typeof next === 'function' ? next(cur.tab) : next;
    if (to === cur.tab) return cur;
    return {tab: to, dir: to > cur.tab ? 1 : -1};
  });
  const tabFocused = useRef(false);
  // Contorno: a primeira troca de aba às vezes não anima até a tela ser redesenhada; um redesenho
  // logo depois da troca destrava a animação de saída.
  const [, kick] = useState(0);
  useEffect(() => { const t = setTimeout(() => kick(k => k + 1), 40); return () => clearTimeout(t); }, [tab]);
  const [sheet, setSheet] = useState(null);
  const {focus} = useFocus();
  useInterfaceSounds();

  useEffect(() => {
    startEngine();
    startPhone();
    syncMusic();
    loadCloud();
    const t = setInterval(loadCloud, 60000);
    return () => clearInterval(t);
  }, []);

  const openItem = item => setSheet({type: 'item', item});
  const pickFolder = (start, onPick) => setSheet({type: 'folder', start, onPick, back: sheet});
  const openConnect = () => setSheet({type: 'connect'});
  const confirm = (title, text, ok, onOk) => setSheet({type: 'confirm', title, text, ok, onOk});
  const close = () => setSheet(null);
  // Ir para uma aba por um botão: o cursor vai junto (para não cair na aba antiga e
  // desfazer a troca) e entra no conteúdo quando a tela nova termina de chegar.
  const goTab = to => {
    setNav(cur => (cur.tab === to ? cur : {tab: to, dir: to > cur.tab ? 1 : -1}));
    focus(`tab:${TABS[to][0]}`);
    setTimeout(() => focus('content'), 520);
  };
  const switchTab = step => {
    const to = (tab + step + TABS.length) % TABS.length;
    setNav({tab: to, dir: step});
    // O cursor acompanha a aba quando está na barra de cima: um indicador só.
    if (tabFocused.current) focus(`tab:${TABS[to][0]}`);
    return true;
  };
  const tint = null;

  return (
    <View className="w-screen h-screen bg-night">
      <Background tint={tint} />
      <FocusScope autoFocus onAction={a => (a === 'l1' ? switchTab(-1) : a === 'r1' ? switchTab(1) : a === 'triangle' ? (loadCloud(), toast('Atualizando a nuvem…'), true) : a === 'square' && tab === 1 ? (searchCloud(), true) : false)}
        onBack={() => { if (tab !== 0) { setNav({tab: 0, dir: -1}); focus(`tab:${TABS[0][0]}`); return true; } BackHandler.exitApp && BackHandler.exitApp(); return true; }}>
        <View className="flex-row items-center gap-6 px-10 h-[84px]">
          <Image source={icon} style={{width: 54, height: 54, borderRadius: 14}} />
          <Text className="font-heavy text-h2 text-cloud">Nimbo Downloader</Text>
          <View className="flex-row items-center gap-1 ml-4">
            <Text className="font-heavy text-xs2 text-mist px-2 py-1 rounded-md border border-mist">L1</Text>
            {TABS.map(([id, label], i) => (
              <View key={id} focusKey={`tab:${id}`} selected={i === tab}
                onFocus={() => { tabFocused.current = true; setTab(i); }} onBlur={() => { tabFocused.current = false; }}
                onPress={() => focus('content')}
                className="px-4 h-[44px] justify-center rounded-full border-2 border-transparent focused:border-sun focused:bg-haze2">
                <Text className={i === tab ? 'font-heavy text-lead text-cloud' : 'font-heavy text-lead text-mist'}>{label}</Text>
                {i === tab ? <View className="absolute left-4 right-4 bottom-[3px] h-[3px] rounded-full bg-sun" /> : null}
              </View>
            ))}
            <Text className="font-heavy text-xs2 text-mist px-2 py-1 rounded-md border border-mist">R1</Text>
          </View>
          <View className="flex-1" />
          <Speed />
        </View>
        {(
          <View className="flex-1">
          <Screens active={tab} variants={dir > 0 ? SLIDE_RIGHT : SLIDE_LEFT} focusKey="content" onBack={() => { focus(`tab:${TABS[tab][0]}`); return true; }}>
            <Screen id={0}><Guard><Home openItem={openItem} goCloud={() => goTab(1)} connectPhone={() => setSheet({type: 'phone'})} openConnect={openConnect} /></Guard></Screen>
            <Screen id={1}><Guard><Cloud openItem={openItem} openConnect={openConnect} /></Guard></Screen>
            <Screen id={2}><Guard><Downloads /></Guard></Screen>
            <Screen id={3}><Guard><Files pickFolder={pickFolder} confirm={confirm} /></Guard></Screen>
            <Screen id={4}><Guard><Storage confirm={confirm} /></Guard></Screen>
            <Screen id={5}><Guard><Settings openConnect={openConnect} pickFolder={pickFolder} confirm={confirm} /></Guard></Screen>
          </Screens>
          </View>
        )}
      </FocusScope>
      <Hints items={[[['cross'], 'Selecionar'],
        ...(tab === 1 ? [[['square'], 'Buscar']] : tab === 3 ? [[['square'], 'Marcar vários']] : []),
        ...(tab <= 1 ? [[['triangle'], 'Atualizar nuvem']] : []),
        [['L1', 'R1'], 'Trocar aba'], [['circle'], 'Voltar']]} />
      <Toast />
      {sheet && sheet.type === 'item' ? <ItemSheet item={sheet.item} onClose={close} onPickFolder={(s, cb) => setSheet({...sheet, folder: {start: s, cb}})} /> : null}
      {sheet && sheet.folder ? <FolderSheet start={sheet.folder.start} onPick={p => sheet.folder.cb(p)} onClose={() => setSheet({...sheet, folder: null})} /> : null}
      {sheet && sheet.type === 'folder' ? <FolderSheet start={sheet.start} onPick={sheet.onPick} onClose={close} /> : null}
      {sheet && sheet.type === 'connect' ? <ConnectSheet onClose={ok => { close(); if (ok) loadCloud(); }} /> : null}
      {sheet && sheet.type === 'confirm' ? <ConfirmSheet {...sheet} onClose={close} /> : null}
      {sheet && sheet.type === 'phone' ? <PhoneSheet onClose={close} /> : null}
    </View>
  );
}

AppRegistry.registerComponent('nimbo', () => App);
