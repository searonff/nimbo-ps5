// Nimbo V2 — gerenciador de downloads da nuvem (TorBox, Real-Debrid, AllDebrid, Premiumize), nativo para PS5 (PS5 React).
import {useEffect, useState, Component} from 'react';
import {AppRegistry, View, Text, Image, FocusScope, ScrollView, Screens, Screen, useIsScreenActive, useFocus, Sound, BackHandler, Keyboard, Notifications, Svg, Circle, Line} from '@ps5-react/core';
import {useRef} from 'react';
import icon from './sce_sys/icon0.png';
import {useInterfaceSounds} from './sounds.js';
import {config, queue, ui, useStore, toast} from './src/store.js';
import {Background, Speed, Hints, Ring, Bar, Pill, Button, Cover, Toast, hue, hsl, Flag} from './src/ui.jsx';
import {ItemSheet, FolderSheet, ConnectSheet, ServicesSheet, ServiceBadge, ConfirmSheet, Sheet, LangSheet, PasswordsSheet, NotesSheet} from './src/sheets.jsx';
import {PROVIDERS, provider, linkedProviders, listAll as listClouds, jobOf, itemKey} from './src/debrid/index.js';
import {QR} from './src/qr.jsx';
import {Files, Storage} from './src/manage.jsx';
import {startPhone, phoneInfo} from './src/phone.js';
import {drives} from './src/drives.js';
import {startEngine, jobAction, taskAction, clearFinished, fmt, fmtSpeed, fmtEta, applyRateLimit, friendlyError} from './src/engine.js';
import {BackgroundMusic, MUSIC_CREDIT} from './src/music.jsx';
import {startLightBar, resetLightBar} from './src/lightbar.js';
import {APP_VERSION, REPO_URL, checkUpdate, installUpdate, installDir, backupVersion, rollback, fetchNotes} from './src/update.js';
import {engineBusy} from './src/engine.js';

// v2.0.1: música mais baixa também para quem já tinha a configuração salva
if (!config.get().volumeV2) config.set({musicVolume: 0.3, volumeV2: true});
import * as torbox from './src/torbox.js';
import {t, tn, LANGS, systemLang, fmtDate} from './src/i18n.js';
if (!config.get().lang) config.set({lang: systemLang()});

const TABS = [['home', 'Painel'], ['cloud', 'Nuvem'], ['downloads', 'Downloads'], ['files', 'Arquivos'], ['storage', 'Armazenamento'], ['settings', 'Ajustes'], ['about', 'Sobre']];

/* ---------- dados da nuvem compartilhados entre telas ---------- */
let cloudLoading = false;
export function loadCloud() {
  if (cloudLoading || !linkedProviders().length) return;
  cloudLoading = true;
  listClouds().then(({items, errors}) => ui.set({cloud: items, cloudErrors: errors, cloudError: ''}), e => ui.set({cloudError: e.message}))
    .finally(() => { cloudLoading = false; });
}

/* ---------- Painel ---------- */
function Hero({onOpenCloud, onConnectPhone, onConnect}) {
  const linked = useStore(config, () => linkedProviders().length > 0);
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
      <View className="flex-row gap-10 items-center rounded-3xl bg-glass border-2 border-line px-10 py-5">
        <Ring size={210} value={value} color={isJob ? '#ffc857' : '#63b3ed'} thick={16}>
          <Text className="font-heavy text-hero text-cloud">{`${Math.floor(value * 100)}%`}</Text>
        </Ring>
        <View className="flex-1 gap-3">
          <Text className="font-semi text-body text-mist">{isJob ? (waiting ? t('Baixando agora · mais {n} na fila', {n: waiting}) : t('Baixando agora')) :
            t(task.type === 'extract' ? 'Extraindo agora' : 'Copiando agora')}</Text>
          <Text className="font-heavy text-h1 text-cloud" numberOfLines={2}>{name}</Text>
          <View className="flex-row gap-6">
            {isJob ? <Text className="font-heavy text-lead text-sun">{fmtSpeed(speed)}</Text> : null}
            {eta ? <Text className="font-semi text-lead text-cloud">{t('falta {a}', {a: fmtEta(eta)})}</Text> : null}
            <Text className="font-semi text-lead text-mist">{isJob ? t('{a} de {b}', {a: fmt(job.written), b: fmt(job.size)}) : (task.total ? t('{a} de {b}', {a: fmt(task.written), b: fmt(task.total)}) : task.written ? t('{a} extraídos', {a: fmt(task.written)}) : t('Lendo o arquivo…'))}</Text>
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
            {isJob ? <Button focusKey="hero-main" small label={t('Pausar')} onPress={() => jobAction(job.id, 'pause')} /> :
              <Button focusKey="hero-main" small label={t('Cancelar')} onPress={() => taskAction(task.id, 'cancel')} />}
          </View>
        </View>
      </View>
    );
  }
  const done = jobs.filter(j => j.state === 'done').length;
  return (
    <View className="flex-row gap-10 items-center rounded-3xl bg-glass border-2 border-line px-10 py-5">
      <Ring size={210} value={0} thick={16}>
        <Image source={icon} style={{width: 104, height: 104, borderRadius: 24}} />
      </Ring>
      <View className="flex-1 gap-3">
        <Text className="font-semi text-body text-mist">{t('Tudo em dia')}</Text>
        <Text className="font-heavy text-h1 text-cloud">{t('Nenhum download em andamento')}</Text>
        <Text className="font-semi text-lead text-mist">{done ? tn(done, '{n} concluído recentemente', '{n} concluídos recentemente') : t('Escolha algo da sua nuvem para baixar')}</Text>
        <View className="flex-row gap-3 mt-2">
          {linked ? <Button focusKey="hero-main" primary label={t('Abrir a nuvem')} onPress={onOpenCloud} />
            : <Button focusKey="hero-main" primary label={t('Conectar um serviço')} onPress={onConnect} />}
          <Button label={t('Usar pelo celular')} onPress={onConnectPhone} />
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
    <View className="flex-1 gap-2 rounded-3xl bg-glass border-2 border-line px-6 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud">{t('A seguir')}</Text></View>
        {failed ? <Pill text={t(`${failed} com erro · veja em Downloads`)} tone="bad" /> : null}
      </View>
      {next.length ? next.map(j => (
        <View key={j.id} className="flex-row items-center gap-3">
          <View className="flex-1"><Text className="font-semi text-body text-cloud" numberOfLines={1}>{j.name}</Text></View>
          <Text className="font-semi text-cap text-mist">{fmt(j.size)}</Text>
          <Pill text={j.state === 'queued' ? 'Na fila' : 'Pausado'} tone="muted" />
        </View>
      )) : <Text className="font-body text-body text-mist">{t('A fila está vazia.')}</Text>}
    </View>
  );
}

function Drives() {
  const [list, setList] = useState(drives());
  useEffect(() => { const t = setInterval(() => setList(drives()), 10000); return () => clearInterval(t); }, []);
  return (
    <View className="flex-1 gap-2 rounded-3xl bg-glass border-2 border-line px-6 py-4">
      <Text className="font-heavy text-lead text-cloud">{t('Unidades')}</Text>
      {list.map(d => (
        <View key={d.path} className="gap-2">
          <View className="flex-row justify-between">
            <Text className="font-semi text-body text-cloud">{t(d.label)}</Text>
            <Text className="font-semi text-body text-mist">{t(`${fmt(d.free)} livres de ${fmt(d.total)}`)}</Text>
          </View>
          <Bar value={(d.total - d.free) / d.total} color={d.free / d.total < 0.1 ? 'bad' : 'sky'} h={12} />
        </View>
      ))}
    </View>
  );
}

function CloudCard({item, onOpen, focusKey}) {
  const jobs = useStore(queue, q => q.jobs);
  const mine = jobs.filter(j => jobOf(j, item));
  const done = mine.length && mine.filter(j => j.state === 'done').length === (item.fileCount || item.files.length);
  const busy = mine.some(j => j.state !== 'done');
  return (
    <View focusKey={focusKey} onPress={() => onOpen(item)}
      className="w-[220px] rounded-2xl bg-haze border-[3px] border-transparent focused:border-sun focused:scale-105 transition-transform duration-150">
      <Cover name={item.name} w={327} h={132} radius={14} />
      <View className="p-3 gap-1">
        <Text className="font-heavy text-body text-cloud" numberOfLines={1}>{item.name}</Text>
        <View className="flex-row gap-2 items-center">
          <Text className="font-semi text-cap text-mist">{fmt(item.size)}</Text>
          {done ? <Pill text={t('Já baixado')} tone="ok" /> : mine.some(j => j.state === 'downloading') ? <Pill text={t('Baixando')} tone="warn" /> : busy ? <Pill text={t('Na fila')} tone="run" /> :
            item.ready ? <Pill text={t('Pronto')} tone="ok" /> : <Pill text={`${Math.round(item.progress * 100)}%`} tone="warn" />}
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
            <Text className="font-heavy text-lead text-cloud">{t('Recentes na nuvem')}</Text>
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
        <Text className="font-heavy text-h2 text-bad">{t('Algo deu errado nesta tela')}</Text>
        <Text className="font-semi text-body text-mist">{t(String(this.state.error && this.state.error.message || this.state.error))}</Text>
        <Button primary label={t('Tentar de novo')} onPress={() => this.setState({error: null})} />
      </View>
    );
  }
}

/* ---------- Nuvem ---------- */
const KIND_LABEL = {torrents: 'Torrent', webdl: 'Web', usenet: 'Usenet'};
// Busca da Nuvem: teclado do PS5; sem diferenciar maiúsculas nem acentos.
const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
async function searchCloud() {
  const r = await Keyboard.open({title: t('Buscar na nuvem'), text: ui.get().cloudQuery || '', type: 'basic', maxLength: 100});
  if (r.status === 'done') ui.set({cloudQuery: (r.text || '').trim()});
}
const FILTERS = [['all', 'Todos'], ['ready', 'Prontos'], ['busy', 'Ainda na nuvem']];
const SORTS = [['recent', 'Mais recentes'], ['name', 'Nome'], ['size', 'Maiores']];

function Chip({label, on, onPress, focusKey}) {
  return (
    <View focusKey={focusKey} onPress={onPress}
      className={on ? 'px-4 h-[38px] justify-center rounded-full bg-sun border-2 border-transparent focused:border-cloud' : 'px-4 h-[38px] justify-center rounded-full bg-glass border-2 border-line focused:border-sun'}>
      <Text className={on ? 'font-heavy text-cap text-night' : 'font-heavy text-cap text-cloud'}>{t(label)}</Text>
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
  const linkedIds = useStore(config, () => linkedProviders().map(p => p.id).join(','));
  const linked = linkedIds ? linkedIds.split(',').map(provider) : [];
  const multi = linked.length > 1;
  const partial = useStore(ui, s => s.cloudErrors || {});
  const cloud = useStore(ui, s => s.cloud);
  const error = useStore(ui, s => s.cloudError);
  const query = useStore(ui, s => s.cloudQuery || '');
  const jobs = useStore(queue, q => q.jobs);
  if (!linked.length) return (
    <View className="px-10 gap-4 items-start">
      <Text className="font-heavy text-h1 text-cloud">{t('Conecte um serviço para ver sua nuvem')}</Text>
      <Text className="font-semi text-lead text-mist">{t('TorBox, Real-Debrid, AllDebrid ou Premiumize. Pode usar mais de um: a Nuvem junta todos.')}</Text>
      <Text className="font-semi text-lead text-mist">{t('O resto do app (Arquivos, Armazenamento, links diretos pelo celular) já funciona sem conta.')}</Text>
      <Button primary focusKey="cloud-connect" label={t('Conectar um serviço')} onPress={openConnect} />
    </View>
  );
  if (error) return (
    <View className="px-10 gap-4 items-start">
      <Text className="font-heavy text-h2 text-bad">{t('Não deu para carregar a nuvem')}</Text>
      <Text className="font-semi text-lead text-mist">{t(error)}</Text>
      <Button primary focusKey="cloud-retry" label={t('Tentar de novo')} onPress={() => { ui.set({cloudError: '', cloud: null}); loadCloud(); }} />
    </View>
  );
  if (!cloud) return <View className="px-10"><Text className="font-semi text-lead text-mist">{t('Carregando sua nuvem…')}</Text></View>;
  if (!cloud.length) return <View className="px-10"><Text className="font-semi text-lead text-mist">{t('Sua nuvem está vazia. Mande um link pelo celular.')}</Text></View>;
  const q = fold(query);
  let list = cloud.filter(it => (!q || fold(it.name).includes(q) || it.files.some(f => fold(f.short).includes(q))) &&
    (filter === 'all' || (filter === 'ready' ? it.ready : filter === 'busy' ? !it.ready : (it.provider || 'torbox') === filter)));
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
            <Text className={query ? 'font-heavy text-cap text-cloud' : 'font-heavy text-cap text-mist'}>{query ? `“${query}”` : t('Buscar')}</Text>
          </View>
          {query ? <Chip label={t('Limpar busca')} onPress={() => ui.set({cloudQuery: ''})} /> : null}
          <View className="w-[8px]" />
          {FILTERS.concat(multi ? linked.map(p => [p.id, p.name]) : []).map(([id, label]) => <Chip key={id} focusKey={`chip:${id}`} label={label} on={filter === id} onPress={() => { setFilter(id); setLimit(40); }} />)}
          <View className="flex-1" />
          <Chip label={t(`Ordem: ${SORTS.find(x => x[0] === sort)[1]}`)} onPress={nextSort} />
        </View>
        {Object.keys(partial).map(pid => <Text key={pid} className="font-semi text-cap text-bad">{`${provider(pid).name}: ${t(partial[pid])}`}</Text>)}
        <Text className="font-semi text-cap text-mist">{list.length === cloud.length ? tn(cloud.length, '{n} item na nuvem', '{n} itens na nuvem') : t('{a} de {b} itens', {a: list.length, b: cloud.length})}</Text>
        {!list.length ? <Text className="font-semi text-lead text-mist mt-4">{query ? t('Nada encontrado para “{q}”.', {q: query}) : t('Nenhum item neste filtro.')}</Text> : null}
        {shown.map(it => {
          const mine = jobs.filter(j => jobOf(j, it));
          const done = mine.length && mine.filter(j => j.state === 'done').length === (it.fileCount || it.files.length);
          return (
            <View key={itemKey(it)} onPress={() => openItem(it)}
              className="flex-row items-center gap-5 rounded-2xl bg-glass px-4 py-3 border-[3px] border-line focused:border-sun">
              <Cover name={it.name} w={150} h={84} radius={10} />
              <View className="flex-1 gap-1">
                <Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{it.name}</Text>
                <View className="flex-row items-center gap-2">
                  {multi ? <ServiceBadge p={provider(it.provider)} /> : null}
                  <Text className="font-semi text-cap text-mist">{`${t(KIND_LABEL[it.kind] || provider(it.provider).name)} · ${fmt(it.size)}${it.fileCount ? ` · ${tn(it.fileCount, '{n} arquivo', '{n} arquivos')}` : ''}`}</Text>
                </View>
              </View>
              {done ? <Pill text={t('Já baixado')} tone="ok" /> : mine.some(j => j.state !== 'done') ? <Pill text={t('Na fila')} tone="run" /> : null}
              {it.ready ? <Pill text={t('Pronto')} tone="ok" /> : <Pill text={t(`Na nuvem ${Math.round(it.progress * 100)}%`)} tone="warn" />}
            </View>
          );
        })}
        {list.length > limit ? <View className="flex-row"><Button label={t(`Mostrar mais (${list.length - limit} restantes)`)} onPress={() => setLimit(n => n + 40)} /></View> : null}
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
    <View className="gap-2 rounded-2xl bg-glass border-2 border-line px-5 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{j.name}</Text></View>
        <Pill text={label} tone={tone} />
      </View>
      <Bar value={v} color={j.state === 'done' ? 'ok' : j.state === 'error' ? 'bad' : j.state === 'downloading' ? 'sun' : 'rim'} />
      <View className="flex-row items-center gap-4">
        <View className="flex-1"><Text className="font-semi text-cap text-mist" numberOfLines={1}>
          {(j.error && t(friendlyError(j.error))) || `${t('{a} de {b}', {a: fmt(j.written), b: fmt(j.size)})}${j.state === 'downloading' && speed ? ` · ${fmtSpeed(speed)}` : ''} · ${j.path}`}
        </Text></View>
        {j.state === 'downloading' ? <Button small label={t('Pausar')} onPress={() => jobAction(j.id, 'pause')} /> : null}
        {['paused', 'error'].includes(j.state) ? <Button small label={t('Retomar')} onPress={() => jobAction(j.id, 'resume')} /> : null}
        {j.state === 'queued' ? <Button small label={t('Baixar primeiro')} onPress={() => jobAction(j.id, 'first')} /> : null}
        {j.state !== 'done' ? <Button small label={t('Cancelar')} onPress={() => jobAction(j.id, 'cancel')} /> : null}
      </View>
    </View>
  );
}

function TaskRow({t: tk}) {
  const [label, tone] = TSTATE[tk.state];
  const v = tk.state === 'done' ? 1 : tk.total ? tk.written / tk.total : 0;
  return (
    <View className="gap-2 rounded-2xl bg-glass border-2 border-line px-5 py-4">
      <View className="flex-row items-center gap-3">
        <View className="flex-1"><Text className="font-heavy text-lead text-cloud" numberOfLines={1}>{`${t(TTYPE[tk.type])}: ${tk.name}`}</Text></View>
        {tk.auto ? <Pill text={t('automático')} /> : null}
        <Pill text={label} tone={tone} />
      </View>
      <Bar value={v} color={tk.state === 'error' ? 'bad' : 'sky'} />
      <View className="flex-row items-center gap-4">
        <View className="flex-1"><Text className="font-semi text-cap text-mist" numberOfLines={1}>{t((tk.error && friendlyError(tk.error)) || tk.result || tk.dest)}</Text></View>
        {tk.state === 'running' || tk.state === 'queued' ? <Button small label={t('Cancelar')} onPress={() => taskAction(tk.id, 'cancel')} /> : null}
        {tk.state === 'error' ? <Button small label={t('Tentar de novo')} onPress={() => taskAction(tk.id, 'retry')} /> : null}
        {tk.state === 'error' ? <Button small label={t('Remover')} onPress={() => taskAction(tk.id, 'remove')} /> : null}
      </View>
    </View>
  );
}

function Downloads() {
  const q = useStore(queue);
  const speed = useStore(ui, s => s.speed);
  const active = q.jobs.filter(j => j.state !== 'done' && j.state !== 'error');
  const done = q.jobs.filter(j => j.state === 'done').slice(-6).reverse();
  const badJobs = q.jobs.filter(j => j.state === 'error');
  const badTasks = q.tasks.filter(t => t.state === 'error');
  const retryAll = () => { badJobs.forEach(j => jobAction(j.id, 'resume')); badTasks.forEach(t => taskAction(t.id, 'retry')); };
  // Tira da lista tudo o que falhou: download com erro é cancelado (apaga o pedaço baixado),
  // extração/cópia com erro só sai da fila (os arquivos já extraídos ficam).
  const clearFailed = () => { badJobs.forEach(j => jobAction(j.id, 'cancel')); badTasks.forEach(t => taskAction(t.id, 'remove')); };
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-3 pb-24">
        {badJobs.length + badTasks.length ? (
          <View className="gap-3 rounded-3xl px-5 py-4 border-2 border-bad" style={{backgroundColor: 'rgba(255,122,122,0.10)'}}>
            <View className="flex-row items-center gap-3">
              <View className="flex-1"><Text className="font-heavy text-h2 text-cloud">{t(`Precisa de atenção (${badJobs.length + badTasks.length})`)}</Text></View>
              <Button small primary label={t('Tentar todos de novo')} onPress={retryAll} />
              <Button small label={t('Limpar falhas')} onPress={clearFailed} />
            </View>
            {badJobs.map(j => <JobRow key={j.id} j={j} />)}
            {badTasks.map(t => <TaskRow key={t.id} t={t} />)}
          </View>
        ) : null}
        <View className="flex-row items-center justify-between">
          <Text className="font-heavy text-h2 text-cloud">{t('Baixando')}</Text>
          <Button small label={t('Limpar concluídos')} onPress={clearFinished} />
        </View>
        {active.length ? active.map(j => <JobRow key={j.id} j={j} speed={speed} />) :
          <Text className="font-semi text-body text-mist">{t('Nada baixando agora.')}</Text>}
        {q.watches.length ? <Text className="font-semi text-body text-sky">{t(`Aguardando ficar pronto na nuvem: ${q.watches.map(w => w.name).join(', ')}`)}</Text> : null}
        <Text className="font-heavy text-h2 text-cloud mt-4">{t('Extraindo e copiando')}</Text>
        {q.tasks.some(t => t.state !== 'error') ? q.tasks.filter(t => t.state !== 'error').reverse().map(t => <TaskRow key={t.id} t={t} />) :
          <Text className="font-semi text-body text-mist">{t('Nenhuma tarefa.')}</Text>}
        {done.length ? <Text className="font-heavy text-h2 text-cloud mt-4">{t('Concluídos')}</Text> : null}
        {done.map(j => <JobRow key={j.id} j={j} />)}
      </View>
    </ScrollView>
  );
}

// Fecha o app gravando antes o que ainda estava esperando para ir ao disco.
function quit() { resetLightBar(); config.flush(); queue.flush(); if (BackHandler.exitApp) BackHandler.exitApp(); }

/* ---------- Sobre ---------- */
// Procura atualização ao abrir e a cada 6 h. Com "Atualizar sozinho", instala em segundo plano
// quando não há downloads nem extrações rodando; a versão nova vale ao reabrir o app.
let autoBusy = false;
function autoCheckUpdate(force) {
  const c = config.get();
  if (autoBusy || c.autoUpdate === false) return;
  if (!force && Date.now() - (c.updateCheckedAt || 0) < 6 * 3600 * 1000 && !(ui.get().update && ui.get().update.available)) return;
  autoBusy = true;
  const done = () => { autoBusy = false; };
  const pending = info => info && info.available && config.get().updateInstalled !== info.version;
  (ui.get().update && pending(ui.get().update) ? Promise.resolve(ui.get().update) : checkUpdate()).then(info => {
    ui.set({update: info});
    if (!pending(info)) return done();
    // Avisa uma vez por versão (faixa no topo + notificação do PS5), se o aviso estiver ligado.
    if (config.get().updateNotify !== false && config.get().updateNotified !== info.version) {
      config.set({updateNotified: info.version});
      try { Notifications.show(t('Atualização disponível'), t(`Nimbo ${info.version} está pronto para instalar.`)); } catch (_) { /* desktop */ }
    }
    if (config.get().autoInstall === false || !installDir()) return done();
    const q = queue.get();
    if (engineBusy() || q.jobs.some(j => ['queued', 'downloading'].includes(j.state)) || q.tasks.some(t => ['queued', 'running'].includes(t.state))) {
      setTimeout(() => autoCheckUpdate(true), 10 * 60 * 1000);   // fila ocupada: tenta de novo em 10 min
      return done();
    }
    installUpdate(info, () => {}).then(() => { ui.set({updateReady: info.version}); done(); },
      e => { toast(e.message, 'bad'); done(); });
  }, done);
}

// Faixa no topo: versão nova disponível (com aviso ligado) ou já instalada em segundo plano.
function UpdateBanner({onOpen}) {
  const ready = useStore(ui, s => s.updateReady || '');
  const info = useStore(ui, s => s.update || null);
  const notify = useStore(config, c => c.updateNotify !== false);
  const installed = useStore(config, c => c.updateInstalled || '');
  const dismissed = useStore(ui, s => s.updateDismissed || '');
  const avail = info && info.available && installed !== info.version && dismissed !== info.version ? info.version : '';
  if (!ready && !(notify && avail)) return null;
  if (!ready) {
    return (
      <View className="flex-row items-center gap-4 mx-10 mb-2 rounded-2xl bg-haze2 px-5 py-2 border-2 border-sun">
        <View className="flex-1"><Text className="font-heavy text-body text-cloud">{t(`Nimbo ${avail} disponível.`)}</Text></View>
        <Button small primary focusKey="banner-open" label={t('Ver atualização')} onPress={onOpen} />
        <Button small label={t('Depois')} onPress={() => ui.set({updateDismissed: avail})} />
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-4 mx-10 mb-2 rounded-2xl bg-haze2 px-5 py-2 border-2 border-ok">
      <View className="flex-1"><Text className="font-heavy text-body text-cloud">{t(`Nimbo ${ready} instalado. Feche e abra o app para usar a versão nova.`)}</Text></View>
      <Button small primary focusKey="banner-close" label={t('Fechar o app')} onPress={() => quit()} />
      <Button small label={t('Depois')} onPress={() => ui.set({updateReady: ''})} />
    </View>
  );
}

function About({openNotes}) {
  const info = useStore(ui, s => s.update || null);
  const auto = useStore(config, c => c.autoUpdate !== false);
  const autoInstall = useStore(config, c => c.autoInstall !== false);
  const checkedAt = useStore(config, c => c.updateCheckedAt || 0);
  const notify = useStore(config, c => c.updateNotify !== false);
  const lastError = useStore(config, c => c.updateError || '');
  const [state, setState] = useState({phase: 'idle', text: '', frac: 0});
  const phone = phoneInfo();
  const check = () => {
    setState({phase: 'checking', text: 'Procurando no GitHub…', frac: 0});
    checkUpdate().then(i => {
      ui.set({update: i});
      setState({phase: 'idle', text: i.available ? '' : `Você já tem a versão mais recente (${i.version || APP_VERSION}).`, frac: 0});
    }, e => setState({phase: 'idle', text: e.message, frac: 0}));
  };
  const install = () => {
    setState({phase: 'installing', text: 'Preparando…', frac: 0});
    installUpdate(info, (text, frac) => setState({phase: 'installing', text, frac}))
      .then(() => setState({phase: 'done', text: `Nimbo ${info.version} instalado. Feche e abra o app para usar a versão nova.`, frac: 1}),
        e => setState({phase: 'idle', text: e.message, frac: 0}));
  };
  const busy = state.phase === 'checking' || state.phase === 'installing';
  return (
    <ScrollView className="flex-1 px-10">
      <View className="flex-row gap-6 pb-24">
        <View className="flex-1 gap-4 rounded-3xl bg-glass border-2 border-line px-8 py-6">
          <View className="flex-row items-center gap-5">
            <Image source={icon} style={{width: 132, height: 132, borderRadius: 30}} />
            <View className="gap-1">
              <Text className="font-heavy text-h1 text-cloud">{t('Nimbo Downloader')}</Text>
              <Text className="font-semi text-lead text-mist">{t(`Versão ${APP_VERSION} · para PS5 com etaHEN`)}</Text>
            </View>
          </View>
          <View className="h-[2px] bg-rim" />
          <Text className="font-heavy text-h2 text-cloud">{t('Atualizações')}</Text>
          {info && info.available && state.phase !== 'done' ? (
            <View className="gap-3 rounded-2xl bg-haze2 px-5 py-4 border-2 border-sun">
              <Text className="font-heavy text-lead text-cloud">{t(`Versão ${info.version} disponível${info.asset && info.asset.size ? ` · ${fmt(info.asset.size)}` : ''}`)}</Text>
              {info.notes ? <Text className="font-body text-body text-mist" numberOfLines={4}>{info.notes.replace(/[#*`_]/g, '')}</Text> : null}
              {!busy ? (
                <View className="flex-row gap-3">
                  <Button primary focusKey="about-update" label={t(`Atualizar para ${info.version}`)} onPress={install} />
                  {info.notes ? <Button label={t('O que há de novo')} onPress={() => openNotes(t(`Novidades da versão ${info.version}`), info.notes)} /> : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {state.phase === 'installing' ? (
            <View className="gap-2">
              <Text className="font-semi text-body text-cloud" numberOfLines={1}>{t(state.text)}</Text>
              <Bar value={state.frac} color="sun" h={14} />
              <Text className="font-semi text-cap text-mist">{t('Não feche o app até terminar.')}</Text>
            </View>
          ) : state.text ? <Text className={state.phase === 'done' ? 'font-heavy text-lead text-ok' : 'font-semi text-body text-mist'}>{t(state.text)}</Text> : null}
          {checkedAt && !busy ? (
            <Text className={lastError ? 'font-semi text-cap text-bad' : 'font-semi text-cap text-mist'}>
              {t('Última procura: {d}', {d: fmtDate(checkedAt)})}{lastError && !state.text ? ` · ${t(lastError)}` : ''}
            </Text>
          ) : null}
          <View className="flex-row gap-3">
            {state.phase === 'done'
              ? <Button primary focusKey="about-close" label={t('Fechar o app')} onPress={() => quit()} />
              : <Button focusKey="about-check" label={state.phase === 'checking' ? 'Procurando…' : 'Procurar atualização'} onPress={busy ? () => {} : check} />}
            <Button label={t(`Atualizar sozinho: ${auto && autoInstall ? 'Ligado' : 'Desligado'}`)} onPress={() => config.set({autoUpdate: true, autoInstall: !(auto && autoInstall)})} />
            <Button label={t(`Avisar versão nova: ${notify ? 'Ligado' : 'Desligado'}`)} onPress={() => config.set({updateNotify: !notify, autoUpdate: true})} />
          </View>
          {backupVersion() && backupVersion() !== APP_VERSION && !busy ? (
            <View className="flex-row"><Button label={t(`Voltar para a versão anterior (${backupVersion()})`)} onPress={() => {
              setState({phase: 'installing', text: 'Restaurando…', frac: 0});
              rollback((text, frac) => setState({phase: 'installing', text, frac}))
                .then(() => setState({phase: 'done', text: 'Versão anterior restaurada. Feche e abra o app.', frac: 1}), e => setState({phase: 'idle', text: e.message, frac: 0}));
            }} /></View>
          ) : null}
          {!installDir() ? <Text className="font-semi text-cap text-mist">{t('A atualização pelo app precisa do Nimbo instalado em /data/homebrew (ShadowMount+).')}</Text> : null}
        </View>
        <View className="w-[360px] gap-4 rounded-3xl bg-glass border-2 border-line px-6 py-6 items-center">
          <Text className="font-heavy text-lead text-cloud">{t('Projeto no GitHub')}</Text>
          <View className="rounded-2xl bg-cloud p-3"><QR text={REPO_URL} size={220} /></View>
          <Text className="font-semi text-cap text-mist">{t('github.com/searonff/nimbo-ps5')}</Text>
          <View className="h-[2px] bg-rim self-stretch" />
          <Text className="font-semi text-cap text-mist">{t('Endereço do PS5')}</Text>
          <Text className="font-heavy text-lead text-cloud">{phone.address ? `${phone.address}${phone.port ? `:${phone.port}` : ''}` : 'Sem rede'}</Text>
          <Text className="font-body text-xs2 text-mist">{t('PS5 React, de half144 e colaboradores · fonte Nunito (OFL) · licença GPLv3')}</Text>
          <Text className="font-body text-xs2 text-mist">{t('Música: {m} · sons: Google Material Design (CC BY 4.0)', {m: t(MUSIC_CREDIT)})}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

/* ---------- Ajustes ---------- */
function Row({label, value, onPress, focusKey}) {
  return (
    <View focusKey={focusKey} onPress={onPress} className="flex-row items-center justify-between rounded-2xl bg-glass px-6 h-[64px] border-[3px] border-line focused:border-sun">
      <Text className="font-semi text-lead text-cloud">{t(label)}</Text>
      <Text className="font-heavy text-lead text-sun">{t(value)}</Text>
    </View>
  );
}
function LangRow({onPress}) {
  const code = useStore(config, c => c.lang || 'pt');
  const [, name, flag] = LANGS.find(l => l[0] === code) || LANGS[0];
  return (
    <View focusKey="set-lang" onPress={onPress} className="flex-row items-center justify-between rounded-2xl bg-glass px-6 h-[64px] border-[3px] border-line focused:border-sun">
      <Text className="font-semi text-lead text-cloud">{t('Idioma')}</Text>
      <View className="flex-row items-center gap-3"><Flag code={flag} w={42} /><Text className="font-heavy text-lead text-sun">{name}</Text></View>
    </View>
  );
}
function Settings({openConnect, pickFolder, confirm, openLang, openPasswords}) {
  const c = useStore(config);
  const flip = k => () => { config.set({[k]: !c[k]}); if (k === 'speedLimitOn') setTimeout(applyRateLimit, 0); };
  const onOff = v => (v ? 'Ligado' : 'Desligado');
  const cycle = (k, list) => () => { const i = list.indexOf(c[k]); config.set({[k]: list[(i + 1) % list.length]}); setTimeout(applyRateLimit, 0); };
  // Conta de cada serviço conectado (e-mail/usuário e plano).
  const linkedIds = linkedProviders().map(p => p.id).join(',');
  const [accounts, setAccounts] = useState({});
  useEffect(() => {
    for (const p of linkedProviders()) p.account().then(a => setAccounts(x => ({...x, [p.id]: a})), e => setAccounts(x => ({...x, [p.id]: e.message})));
  }, [linkedIds]);
  return (
    <ScrollView className="flex-1 px-10">
      <View className="gap-3 pb-24">
        <Text className="font-heavy text-h2 text-cloud">{t('Geral')}</Text>
        <LangRow onPress={openLang} />
        <Text className="font-heavy text-h2 text-cloud mt-3">{t('Serviços de nuvem')}</Text>
        {PROVIDERS.map(p => (
          <Row key={p.id} label={p.linked() ? `${p.name}: ${t(accounts[p.id] || 'Conectado')}` : `${p.name}: não conectado`}
            value={p.linked() ? 'Desconectar' : 'Conectar'}
            onPress={() => (p.linked()
              ? confirm(`Desconectar ${p.name}`, `Sair da conta do ${p.name} neste PS5? Os itens dele somem da Nuvem até você conectar de novo.`, 'Desconectar', () => { p.logout(); ui.set({cloud: (ui.get().cloud || []).filter(x => (x.provider || 'torbox') !== p.id)}); })
              : openConnect(p.id))} />
        ))}
        <Text className="font-heavy text-h2 text-cloud mt-3">{t('Downloads')}</Text>
        <Row label={t('Pasta padrão')} value={c.defaultDest} onPress={() => pickFolder(c.defaultDest, p => config.set({defaultDest: p}))} />
        <Row label={t('Conexões por download')} value={String(c.connections)} onPress={cycle('connections', [4, 8, 16, 32])} />
        <Row label={t('Limitar velocidade')} value={c.speedLimitOn ? 'Ligado' : 'Desligado'} onPress={flip('speedLimitOn')} />
        {c.speedLimitOn ? <Row label={t('Velocidade máxima')} value={t(`${c.speedLimitMB} MB/s`)} onPress={cycle('speedLimitMB', [1, 2, 5, 10, 20, 50])} /> : null}
        <Row label={t('Impedir o modo de repouso')} value={onOff(c.keepAwake)} onPress={flip('keepAwake')} />
        <Row label={t('Luz do controle mostra o andamento')} value={onOff(c.lightBar !== false)} onPress={() => config.set({lightBar: c.lightBar === false})} />
        <Row label={t('Apagar da nuvem depois de baixar')} value={onOff(c.deleteFromCloud)} onPress={flip('deleteFromCloud')} />
        <Text className="font-heavy text-h2 text-cloud mt-3">{t('Extração')}</Text>
        <Row label={t('Extrair automaticamente')} value={onOff(c.autoExtract)} onPress={flip('autoExtract')} />
        <Row label={t('Apagar o compactado depois')} value={onOff(c.deleteArchive)} onPress={flip('deleteArchive')} />
        <Row label={t('Extrair durante o download')} value={onOff(c.extractWhileDownloading)} onPress={flip('extractWhileDownloading')} />
        {c.extractWhileDownloading ? <Text className="font-semi text-cap text-mist px-2">{t('A extração roda junto com o próximo download. Os dois ficam um pouco mais lentos, e o disco precisa de espaço para os dois.')}</Text> : null}
        <Row focusKey="set-passwords" label={t('Senhas de arquivos')} value={c.passwords.length ? tn(c.passwords.length, '{n} salva', '{n} salvas') : t('Adicionar')} onPress={() => openPasswords()} />
        <Text className="font-heavy text-h2 text-cloud mt-3">{t('Som')}</Text>
        <Row label={t('Música de fundo')} value={onOff(c.music)} onPress={flip('music')} />
        <Row label={t('Volume da música')} value={`${Math.round(c.musicVolume * 100)}%`} onPress={() => config.set({musicVolume: Math.round((c.musicVolume || 0) * 10) >= 10 ? 0.1 : (Math.round((c.musicVolume || 0) * 10) + 1) / 10})} />
        <Row label={t('Sons da interface')} value={onOff(c.sfx)} onPress={flip('sfx')} />
        <Text className="font-semi text-cap text-mist mt-4">{`Nimbo Downloader ${APP_VERSION} · PS5 React`}</Text>
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
    <Sheet title={t('Usar pelo celular')} onClose={onClose} width={820}>
      {url ? (
        <View className="flex-row gap-7 items-center">
          <QR text={url} size={250} />
          <View className="flex-1 gap-3">
            <Text className="font-semi text-body text-mist">{t('Aponte a câmera do celular (mesmo Wi-Fi do PS5) ou abra:')}</Text>
            <Text className="font-heavy text-lead text-cloud">{url}</Text>
            <Text className="font-semi text-body text-mist">{t('PIN')}</Text>
            <Text className="font-heavy text-hero text-sun">{info.pin}</Text>
            <Text className="font-semi text-cap text-mist">{t('Pelo celular dá para mandar links, ver a fila e baixar da nuvem.')}</Text>
          </View>
        </View>
      ) : <Text className="font-semi text-body text-mist">{info.state === 'failed' ? 'Não consegui abrir a porta do celular.' : 'Ligando o servidor do celular…'}</Text>}
      <View className="flex-row"><Button primary label={t('Fechar')} onPress={onClose} /></View>
    </Sheet>
  );
}

/* ---------- casca do app ---------- */
// Cada tela avisa quando está de fato no palco; a casca usa isso para detectar troca presa.
let liveScreen = 0;
function LiveMark({id}) {
  const live = useIsScreenActive();
  useEffect(() => { if (live) liveScreen = id; }, [live]);
  return null;
}

// Deslize com direção: sai rápido para um lado, entra desacelerando pelo outro.
const ENTER_T = {type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1]};
const LEAVE_T = {type: 'tween', duration: 0.13, ease: 'easeIn'};
const SLIDE_RIGHT = {hidden: {x: 120, opacity: 0}, shown: {x: 0, opacity: 1, transition: ENTER_T}, gone: {x: -120, opacity: 0, transition: LEAVE_T}};
const SLIDE_LEFT = {hidden: {x: -120, opacity: 0}, shown: {x: 0, opacity: 1, transition: ENTER_T}, gone: {x: 120, opacity: 0, transition: LEAVE_T}};

function App() {
  useStore(config, c => c.lang);   // trocar o idioma redesenha tudo
  const c = useStore(config);
  const [{tab, dir}, setNav] = useState({tab: 0, dir: 1});
  const filesSel = useStore(ui, s => !!s.filesSel);
  // Troca de aba com direção: R1/direita entra pela direita, L1/esquerda entra pela esquerda.
  const setTab = next => setNav(cur => {
    const to = typeof next === 'function' ? next(cur.tab) : next;
    if (to === cur.tab) return cur;
    return {tab: to, dir: to > cur.tab ? 1 : -1};
  });
  const tabFocused = useRef(false);
  // Subir do conteúdo leva o cursor para a aba que estiver geometricamente acima dele, e focar
  // uma aba troca de tela. Por isso, vindo de fora da barra, o cursor é posto na aba atual;
  // só goTab/voltar (que avisam em expectTab) podem cair direto em outra aba.
  const tabBlurAt = useRef(0);
  const expectTab = useRef(-1);
  // Contorno: a primeira troca de aba às vezes não anima até a tela ser redesenhada; um redesenho
  // logo depois da troca destrava a animação de saída.
  const [, kick] = useState(0);
  // Várias trocas seguidas (R1 R1 R1) logo ao abrir deixavam a tela antiga presa: a animação de
  // saída do <Screens> não terminava e a nova nunca entrava. A tela só segue a aba quando as trocas
  // param por um instante, então uma rajada vira uma troca só. A barra de abas responde na hora.
  const [shownTab, setShownTab] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShownTab(tab), 90); return () => clearTimeout(t); }, [tab]);
  useEffect(() => { const t = setTimeout(() => kick(k => k + 1), 40); return () => clearTimeout(t); }, [shownTab]);
  // Rede de segurança: se mesmo assim a tela nova não entrar em 1,2 s, recria o <Screens>
  // (ele nasce já mostrando a aba certa). As outras telas perdem o estado guardado, só isso.
  const [screensKey, setScreensKey] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { if (liveScreen !== shownTab) setScreensKey(k => k + 1); }, 1200);
    return () => clearTimeout(t);
  }, [shownTab, screensKey]);
  const [sheet, setSheet] = useState(null);
  const {focus} = useFocus();
  useInterfaceSounds();

  useEffect(() => {
    startEngine();
    startLightBar();
    startPhone();
    loadCloud();
    setTimeout(autoCheckUpdate, 8000);
    // Primeira abertura depois de atualizar: mostra as novidades desta versão (texto da release).
    const seen = config.get().seenVersion;
    if (seen !== APP_VERSION) {
      config.set({seenVersion: APP_VERSION});
      if (seen) setTimeout(() => fetchNotes(APP_VERSION).then(notes => {
        if (notes) setSheet(cur => cur || {type: 'notes', title: t(`Novidades da versão ${APP_VERSION}`), notes});
      }, () => {}), 2500);
    }
    if (config.get().restoredFromBackup) setTimeout(() => toast(t("Login e ajustes restaurados da cópia de segurança"), "ok"), 1500);
    const upd = setInterval(() => autoCheckUpdate(), 6 * 3600 * 1000);
    // a chave chegou pelo celular (ou outro login): recarrega a nuvem
    let lastRefresh = 0;
    ui.subscribe && ui.subscribe(st => { if (st.cloudRefresh && st.cloudRefresh !== lastRefresh) { lastRefresh = st.cloudRefresh; loadCloud(); } });
    const cloudTimer = setInterval(loadCloud, 60000);
    return () => { clearInterval(cloudTimer); clearInterval(upd); };
  }, []);

  const openItem = item => setSheet({type: 'item', item});
  const pickFolder = (start, onPick) => setSheet({type: 'folder', start, onPick, back: sheet});
  // Sem serviço escolhido: abre a lista; com um, vai direto para o login dele.
  const openConnect = id => setSheet(typeof id === 'string' ? {type: 'connect', provider: id} : {type: 'services'});
  const confirm = (title, text, ok, onOk) => setSheet({type: 'confirm', title, text, ok, onOk});
  const close = () => setSheet(null);
  // Ir para uma aba por um botão: o cursor vai junto (para não cair na aba antiga e
  // desfazer a troca) e entra no conteúdo quando a tela nova termina de chegar.
  const goTab = to => {
    setNav(cur => (cur.tab === to ? cur : {tab: to, dir: to > cur.tab ? 1 : -1}));
    expectTab.current = to;
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
      <FocusScope autoFocus onAction={a => (a === 'l1' ? switchTab(-1) : a === 'r1' ? switchTab(1) : a === 'triangle' ? (loadCloud(), toast(t('Atualizando a nuvem…')), true) : a === 'square' && tab === 1 ? (searchCloud(), true) : false)}
        onBack={() => { if (tab !== 0) { setNav({tab: 0, dir: -1}); expectTab.current = 0; focus(`tab:${TABS[0][0]}`); return true; } quit(); return true; }}>
        <View className="flex-row items-center gap-6 px-10 h-[84px]">
          <Image source={icon} style={{width: 54, height: 54, borderRadius: 14}} />
          <Text className="font-heavy text-h2 text-cloud">{t('Nimbo')}</Text>
          <View className="flex-row items-center gap-1 ml-3">
            <Text className="font-heavy text-xs2 text-mist px-2 py-1 rounded-md border border-mist">{t('L1')}</Text>
            {TABS.map(([id, label], i) => (
              <View key={id} focusKey={`tab:${id}`} selected={i === tab}
                onFocus={() => {
                  const fromTabs = tabFocused.current || Date.now() - tabBlurAt.current < 120;
                  tabFocused.current = true;
                  if (!fromTabs && i !== tab && expectTab.current !== i) { focus(`tab:${TABS[tab][0]}`); return; }
                  expectTab.current = -1;
                  setTab(i);
                }}
                onBlur={() => { tabFocused.current = false; tabBlurAt.current = Date.now(); }}
                onPress={() => focus('content')}
                className="px-3 h-[44px] justify-center rounded-full border-2 border-transparent focused:border-sun focused:bg-haze2">
                <Text className={i === tab ? 'font-heavy text-lead text-cloud' : 'font-heavy text-lead text-mist'}>{t(label)}</Text>
                {i === tab ? <View className="absolute left-3 right-3 bottom-[3px] h-[3px] rounded-full bg-sun" /> : null}
              </View>
            ))}
            <Text className="font-heavy text-xs2 text-mist px-2 py-1 rounded-md border border-mist">{t('R1')}</Text>
          </View>
          <View className="flex-1" />
          <Speed />
        </View>
        <UpdateBanner onOpen={() => goTab(6)} />
        {(
          <View className="flex-1">
          <Screens key={screensKey} active={shownTab} variants={dir > 0 ? SLIDE_RIGHT : SLIDE_LEFT} focusKey="content" onBack={() => { focus(`tab:${TABS[tab][0]}`); return true; }}>
            <Screen id={0}><LiveMark id={0} /><Guard><Home openItem={openItem} goCloud={() => goTab(1)} connectPhone={() => setSheet({type: 'phone'})} openConnect={openConnect} /></Guard></Screen>
            <Screen id={1}><LiveMark id={1} /><Guard><Cloud openItem={openItem} openConnect={openConnect} /></Guard></Screen>
            <Screen id={2}><LiveMark id={2} /><Guard><Downloads /></Guard></Screen>
            <Screen id={3}><LiveMark id={3} /><Guard><Files pickFolder={pickFolder} confirm={confirm} /></Guard></Screen>
            <Screen id={4}><LiveMark id={4} /><Guard><Storage confirm={confirm} /></Guard></Screen>
            <Screen id={5}><LiveMark id={5} /><Guard><Settings openConnect={openConnect} pickFolder={pickFolder} confirm={confirm} openLang={() => setSheet({type: 'lang'})} openPasswords={() => setSheet({type: 'passwords'})} /></Guard></Screen>
            <Screen id={6}><LiveMark id={6} /><Guard><About openNotes={(title, notes) => setSheet({type: 'notes', title, notes})} /></Guard></Screen>
          </Screens>
          </View>
        )}
      </FocusScope>
      <BackgroundMusic />
      <Hints items={[[['cross'], tab === 3 && filesSel ? 'Marcar / desmarcar' : 'Selecionar'],
        ...(tab === 1 ? [[['square'], 'Buscar']] : tab === 3 && !filesSel ? [[['square'], 'Selecionar vários']] : []),
        ...(tab <= 1 ? [[['triangle'], 'Atualizar nuvem']] : []),
        [['L1', 'R1'], 'Trocar aba'], [['circle'], tab === 3 && filesSel ? 'Sair da seleção' : 'Voltar']]} />
      <Toast />
      {sheet && sheet.type === 'item' ? <ItemSheet item={sheet.item} onClose={close} onPickFolder={(s, cb) => setSheet({...sheet, folder: {start: s, cb}})} /> : null}
      {sheet && sheet.folder ? <FolderSheet start={sheet.folder.start} onPick={p => sheet.folder.cb(p)} onClose={() => setSheet({...sheet, folder: null})} /> : null}
      {sheet && sheet.type === 'folder' ? <FolderSheet start={sheet.start} onPick={sheet.onPick} onClose={close} /> : null}
      {sheet && sheet.type === 'services' ? <ServicesSheet onPick={id => setSheet({type: 'connect', provider: id})} onClose={close} /> : null}
      {sheet && sheet.type === 'connect' ? <ConnectSheet providerId={sheet.provider} onClose={ok => { close(); if (ok) { ui.set({cloud: null}); loadCloud(); } }} /> : null}
      {sheet && sheet.type === 'confirm' ? <ConfirmSheet {...sheet} onClose={close} /> : null}
      {sheet && sheet.type === 'phone' ? <PhoneSheet onClose={close} /> : null}
      {sheet && sheet.type === 'passwords' ? <PasswordsSheet onClose={() => { close(); setTimeout(() => focus('set-passwords'), 0); }} /> : null}
      {sheet && sheet.type === 'notes' ? <NotesSheet title={sheet.title} notes={sheet.notes} onClose={close} /> : null}
      {sheet && sheet.type === 'lang' ? <LangSheet onClose={() => { close(); setTimeout(() => focus('set-lang'), 0); }} /> : null}
    </View>
  );
}

AppRegistry.registerComponent('nimbo', () => App);
