// Componentes visuais do Nimbo: fundo de céu, barra superior, barra de botões, anel de progresso, capas.
import {useEffect, useState} from 'react';
import {View, Text, Image, Svg, Circle, Line, Path, motion} from '@ps5-react/core';
import sky from '../assets/art/sky.png';
import {useStore, ui} from './store.js';

const Arc = 'Arc';   // primitiva de arco do Embedded React (graus, sentido horário a partir das 12h)
import {fmtSpeed} from './engine.js';
import {t} from './i18n.js';

/* Céu: as nuvens vêm pintadas no sky.png (tools/make_clouds.py). Ficam paradas de propósito:
   o renderizador desenha na CPU e nuvem em movimento redesenharia, a cada quadro, a área dela
   e os painéis por cima. Só as estrelas piscam (poucos pixels, quase nada de custo). */
// Algumas estrelas que piscam devagar por cima das fixas do sky.png.
const TWINKLE = [[210, 90, 3, 4.2], [520, 180, 2, 5.5], [880, 60, 3, 3.8], [1130, 140, 2, 6.1], [1420, 70, 3, 4.7],
  [1700, 200, 2, 5.2], [330, 260, 2, 6.6], [1290, 300, 2, 4.4], [760, 320, 2, 5.8], [1840, 110, 3, 3.9]];

export function Background({tint}) {
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Image layer source={sky} style={{position: 'absolute', left: 0, top: 0, width: 1920, height: 1080}} resizeMode="cover" />
      {tint ? <View className="absolute inset-0" style={{backgroundGradient: {type: 'linear', angle: 135, stops: [
        {color: tint, offset: 0}, {color: 'rgba(15,27,45,0)', offset: 0.7}]}}} /> : null}
      {TWINKLE.map(([x, y, r, dur], i) => (
        <motion.View key={`s${i}`} className="absolute" style={{left: x, top: y, width: r, height: r, borderRadius: r, backgroundColor: '#eef2ff'}}
          initial={{opacity: 0.15}} animate={{opacity: 0.95}}
          transition={{duration: dur, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse', delay: -i * 0.7}} />
      ))}
    </View>
  );
}

export function Speed() {
  const speed = useStore(ui, s => s.speed);
  return speed > 0 ? <Text className="font-heavy text-body text-sun">{fmtSpeed(speed)}</Text> : null;
}

export function ButtonGlyph({name}) {
  const shapes = {
    cross: ['#8fb6ff', [<Line key="a" x1="8" y1="8" x2="20" y2="20" stroke="#8fb6ff" strokeWidth="2.6" strokeLinecap="round" />,
      <Line key="b" x1="20" y1="8" x2="8" y2="20" stroke="#8fb6ff" strokeWidth="2.6" strokeLinecap="round" />]],
    circle: ['#ff8f8f', [<Circle key="a" cx="14" cy="14" r="6.5" stroke="#ff8f8f" strokeWidth="2.6" fill="none" />]],
    triangle: ['#6fe0c0', [<Path key="a" d="M14 7 L21 19 L7 19 Z" stroke="#6fe0c0" strokeWidth="2.4" fill="none" />]],
    square: ['#e58bd8', [<Path key="a" d="M8 8 L20 8 L20 20 L8 20 Z" stroke="#e58bd8" strokeWidth="2.4" fill="none" />]],
  };
  if (shapes[name]) {
    return (
      <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: '#213656'}} className="items-center justify-center">
        <Svg width={28} height={28} viewBox="0 0 28 28" style={{width: 28, height: 28}}>{shapes[name][1]}</Svg>
      </View>
    );
  }
  return (
    <View className="px-[7px] h-[22px] rounded-md border border-mist items-center justify-center">
      <Text className="font-heavy text-xs2 text-mist">{name}</Text>
    </View>
  );
}

export function Hints({items}) {
  return (
    <View className="absolute left-0 right-0 bottom-0 h-[56px] flex-row items-center justify-end gap-7 px-10"
      style={{backgroundGradient: {type: 'linear', angle: 0, stops: [
        {color: 'rgba(15,27,45,0.96)', offset: 0.55}, {color: 'rgba(15,27,45,0)', offset: 1}]}}}>
      {items.map(([glyphs, label]) => (
        <View key={label} className="flex-row items-center gap-2">
          {glyphs.map(g => <ButtonGlyph key={g} name={g} />)}
          <Text className="font-semi text-cap text-mist">{t(label)}</Text>
        </View>
      ))}
    </View>
  );
}

/* anel de progresso (a "assinatura" do painel): arco dourado sobre trilho escuro */
export function Ring({size = 200, value = 0, color = '#ffc857', thick = 14, children}) {
  const r = (size - thick) / 2;
  const end = Math.max(0.5, Math.min(359.5, value * 360));
  return (
    <View style={{width: size, height: size}} className="items-center justify-center">
      <Svg style={{position: 'absolute', left: 0, top: 0, width: size, height: size}} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(5,10,20,0.6)" strokeWidth={thick} fill="none" />
        {value > 0 ? <Arc cx={size / 2} cy={size / 2} r={r} startAngle={0} endAngle={end}
          stroke={color} strokeWidth={thick} strokeLinecap="round" fill="none" /> : null}
      </Svg>
      {children}
    </View>
  );
}

const BAR = {sun: '#ffc857', sky: '#63b3ed', ok: '#57d9a3', bad: '#ff7a7a', rim: '#2d4568'};
export function Bar({value = 0, color = 'sun', h = 15}) {
  const w = `${Math.max(0, Math.min(100, value * 100)).toFixed(2)}%`;
  return (
    <View className="w-full rounded-full bg-shade overflow-hidden" style={{height: h}}>
      <View className="h-full rounded-full" style={{width: w, backgroundColor: BAR[color] || color}} />
    </View>
  );
}

export function Pill({text, tone = 'muted'}) {
  const tones = {
    ok: ['rgba(87,217,163,0.16)', '#57d9a3'], warn: ['rgba(255,200,87,0.16)', '#ffc857'],
    run: ['rgba(99,179,237,0.18)', '#63b3ed'], bad: ['rgba(255,122,122,0.16)', '#ff7a7a'], muted: ['#213656', '#93a7c3'],
  };
  const [bg, fg] = tones[tone] || tones.muted;
  return (
    <View className="px-3 py-[3px] rounded-full" style={{backgroundColor: bg}}>
      <Text className="font-heavy text-xs2" style={{color: fg}}>{t(text)}</Text>
    </View>
  );
}

/* botão de comando com foco dourado */
// outline: só contorno (fundo transparente), para ações secundárias sobre painel da mesma cor do
// botão comum (o Cancelar sumia na janela). triangle: símbolo do △ antes do texto (ação do Triângulo).
export function Button({label, onPress, primary, danger, outline: outlined, triangle, small, focusKey, disabled}) {
  const outline = outlined || danger;   // perigo sempre com contorno vermelho: o fundo antigo tinha a cor do painel
  const look = {backgroundColor: primary ? '#ffc857' : outline ? 'transparent' : danger ? '#172741' : '#213656',
    height: small ? 57 : 75, paddingLeft: small ? 24 : 36, paddingRight: small ? 24 : 36};
  const border = outline ? (danger ? 'border-bad' : 'border-rim') : 'border-transparent';
  return (
    <View focusKey={focusKey} onPress={disabled ? undefined : onPress} disabled={disabled} style={look}
      className={`rounded-full flex-row items-center justify-center gap-3 border-[3px] ${border}
        focused:border-sun focused:scale-105 transition-transform duration-150`}>
      {triangle ? <Svg width={26} height={26} viewBox="0 0 28 28" style={{width: 26, height: 26}}>
        <Path d="M14 6 L22 20 L6 20 Z" stroke={primary ? '#2b1d00' : '#6fe0c0'} strokeWidth="2.6" strokeLinejoin="round" fill="none" /></Svg> : null}
      <Text className={small ? 'font-heavy text-cap' : 'font-heavy text-body'}
        style={{color: primary ? '#2b1d00' : danger ? '#ff7a7a' : '#f2f5f9'}}>{t(label)}</Text>
    </View>
  );
}

// Caixa de marcar. O visto é desenhado com dois retângulos girados, não com <Svg>: o renderizador
// só desenha 128 Svg montados ao mesmo tempo, e numa lista de arquivos cada linha tem uma caixa.
// (A fonte Nunito não tem o caractere ✓.)
export function Check({on, size = 30}) {
  if (!on) return <View style={{width: size, height: size, borderRadius: 8}} className="flex-none border-2 border-mist" />;
  const s = size / 30;
  return (
    <View style={{width: size, height: size, borderRadius: 8}} className="flex-none bg-sun items-center justify-center">
      <View style={{width: 10 * s, height: 18 * s, marginTop: -4 * s, transform: [{rotate: '45deg'}]}}>
        <View style={{position: 'absolute', right: 0, top: 0, width: 3.5 * s, height: 18 * s, borderRadius: 2, backgroundColor: '#2b1d00'}} />
        <View style={{position: 'absolute', left: 0, bottom: 0, width: 10 * s, height: 3.5 * s, borderRadius: 2, backgroundColor: '#2b1d00'}} />
      </View>
    </View>
  );
}

/* capa gerada a partir do nome: cor estável + iniciais */
export function hue(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }
export function initials(name) {
  const w = String(name).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[[(].*?[\])]/g, ' ').replace(/[._-]+/g, ' ')
    .trim().split(/\s+/).filter(x => /[a-z0-9]/i.test(x));
  if (!w.length) return '?';
  return (w[0][0] + (w[1] ? w[1][0] : (w[0][1] || ''))).toUpperCase();
}
export function hsl(h, s, l, a = 1) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, f = n => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgba(${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)},${a})`;
}
/* ---------- tipo de conteúdo: pictograma e cor (Arquivos e Nuvem falam a mesma língua) ---------- */
export const TYPE_COLOR = {dir: '#63b3ed', game: '#e58bd8', package: '#e58bd8', video: '#7cc4ff', archive: '#ffc857',
  audio: '#57d9a3', image: '#9be7ff', partial: '#ff7a7a', other: '#93a7c3'};
export function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
// Desenho em traço numa grade 24x24: só retas e círculos (barato no renderizador).
export function TypeGlyph({kind, size = 24, color}) {
  const c = color || TYPE_COLOR[kind] || TYPE_COLOR.other;
  const line = {stroke: c, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'};
  let parts;
  switch (kind) {
    case 'dir': parts = [<Path key="a" d="M3 6.5 H9.5 L11.5 8.5 H21 V18.5 H3 Z" {...line} fill={tint(c, 0.28)} />]; break;
    case 'video': parts = [<Path key="a" d="M3 6 H21 V18 H3 Z" {...line} />, <Path key="b" d="M10 9.2 L15.2 12 L10 14.8 Z" {...line} fill={c} />]; break;
    case 'archive': parts = [<Path key="a" d="M3.5 4.5 H20.5 V8 H3.5 Z" {...line} />, <Path key="b" d="M5 8 V19.5 H19 V8" {...line} />, <Path key="c" d="M10 11.5 H14" {...line} />]; break;
    case 'game': case 'package': parts = [<Circle key="a" cx="12" cy="12" r="8.5" {...line} />, <Circle key="b" cx="12" cy="12" r="2.4" {...line} fill={c} />]; break;
    case 'audio': parts = [<Path key="a" d="M9 17 V5.5 L19 3.5 V15" {...line} />, <Circle key="b" cx="6.6" cy="17" r="2.4" {...line} fill={c} />, <Circle key="c" cx="16.6" cy="15" r="2.4" {...line} fill={c} />]; break;
    case 'image': parts = [<Path key="a" d="M3 5 H21 V19 H3 Z" {...line} />, <Path key="b" d="M5.5 16.5 L10 11.5 L13.5 15 L15.5 13 L18.5 16.5" {...line} />, <Circle key="c" cx="15.5" cy="8.6" r="1.5" {...line} fill={c} />]; break;
    case 'partial': parts = [<Path key="a" d="M12 4 V14 M8 10.5 L12 14.5 L16 10.5" {...line} />, <Path key="b" d="M5 19.5 H8 M10.5 19.5 H13.5 M16 19.5 H19" {...line} />]; break;
    default: parts = [<Path key="a" d="M6 3 H14 L19 8 V21 H6 Z" {...line} />, <Path key="b" d="M14 3 V8 H19" {...line} />];
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" style={{width: size, height: size}}>{parts}</Svg>;
}

// Lê um nome de release ("Jogo.Nome.v1.02-GRUPO", "Serie.S01E03.1080p.WEB") como gente lê:
// título limpo + etiquetas (ID do jogo, temporada/episódio, resolução, versão, ano) + tipo.
const EXT_KIND = [[/\.(pkg|ffpkg|ffpfs|ffpfsc|exfat)$/i, 'game'], [/\.(mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv)$/i, 'video'],
  [/\.(rar|zip|7z|tar|gz|xz|\d{3}|r\d\d)$/i, 'archive'], [/\.(mp3|flac|m4a|ogg|wav|aac)$/i, 'audio']];
const kindOfName = n => (EXT_KIND.find(([re]) => re.test(n)) || [0, 'other'])[1];
export function releaseInfo(name, files = []) {
  const raw = String(name || '');
  const id = (/(PPSA|CUSA)\d{5}/i.exec(raw) || [''])[0].toUpperCase();
  const ep = /\bS(\d{1,2})E(\d{1,3})\b/i.exec(raw);
  const season = ep ? null : /\bS(\d{1,2})\b/i.exec(raw);
  const res = (/\b(2160|1080|720|480)p\b/i.exec(raw) || [''])[0].toLowerCase();
  const ver = (/\bv\d+(?:\.\d+)+\b/i.exec(raw) || [''])[0];
  const year = (/\b(19[5-9]\d|20[0-4]\d)\b/.exec(raw) || [''])[0];
  // Título: tudo antes do primeiro marcador técnico, sem extensão, colchetes e grupo.
  // Nome que começa pelo ID ("CUSA12345_Jogo…"): o ID já vira etiqueta, sai do título.
  let base = raw.replace(/^\s*(PPSA|CUSA)\d{5}[\s._-]*/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[[(].*?[\])]/g, ' ').replace(/_+/g, ' ').replace(/\.(?!\d)|(?<!\d)\./g, ' ');
  const cutAt = base.search(/\b(S\d{1,2}(E\d{1,3})?|(2160|1080|720|480)p|v\d+(\.\d+)+|(19[5-9]\d|20[0-4]\d)|(PPSA|CUSA)\d{5}|WEB|WEBRip|BluRay|HDTV|x26[45]|H 26[45]|REPACK|PROPER|MULTi|FLAC|MP3|320kbps)\b/i);
  if (cutAt > 2) base = base.slice(0, cutAt);
  const title = base.replace(/-[A-Za-z0-9]+\s*$/, '').replace(/[\s-]+$/, '').replace(/^[\s-]+/, '').replace(/\s+/g, ' ').trim() || raw;
  // Tipo: pela maioria dos arquivos (em bytes); ID de jogo ou temporada decidem antes.
  const weight = {};
  for (const f of files || []) { const k = kindOfName(f.short || f.name || ''); weight[k] = (weight[k] || 0) + (f.size || 1); }
  let kind = Object.keys(weight).sort((x, y) => weight[y] - weight[x])[0] || kindOfName(raw);
  if (id) kind = 'game';
  else if (ep || season) kind = 'video';
  const tags = [id, ep ? `T${+ep[1]} E${+ep[2]}` : season ? `T${+season[1]}` : '', res, ver, kind === 'game' ? '' : year].filter(Boolean);
  const label = {game: 'Jogo', video: ep || season ? 'Série' : 'Vídeo', archive: 'Compactado', audio: 'Música'}[kind] || 'Arquivos';
  return {title, tags, kind, label};
}

/* Capa de um item da nuvem: o tipo dá a cor e o pictograma; o nome da release vira título + etiquetas.
   Pequena (lista da Nuvem): só o pictograma, sem texto miúdo. */
// noTitle: a janela de download já mostra o nome grande ao lado; a capa fica com tipo e etiquetas.
export function Cover({name, files, w, h, radius = 14, noTitle}) {
  const info = releaseInfo(name, files);
  const c = TYPE_COLOR[info.kind] || TYPE_COLOR.other;
  const bg = {width: w, height: h, borderRadius: radius, backgroundGradient: {type: 'linear', angle: 150, stops: [
    {color: tint(c, 0.32), offset: 0}, {color: 'rgba(14,24,44,0.92)', offset: 0.78}]}};
  if (w < 180) {
    return <View style={bg} className="items-center justify-center"><TypeGlyph kind={info.kind} size={Math.round(h * 0.5)} /></View>;
  }
  // Capa baixa com etiquetas: título em uma linha só, senão as etiquetas vazavam para fora da capa
  // (em cima do tamanho, no card da Nuvem). Capa estreita leva no máximo 2 etiquetas.
  const lines = info.tags.length && h < 150 ? 1 : 2;
  return (
    <View style={bg} className="p-3 justify-between overflow-hidden">
      <View className="flex-row items-center gap-2">
        <TypeGlyph kind={info.kind} size={24} />
        <Text className="font-heavy text-cap" style={{color: c}}>{t(info.label)}</Text>
      </View>
      <View className="gap-1">
        {noTitle ? null : <Text className="font-heavy text-body text-cloud" numberOfLines={lines}>{info.title}</Text>}
        {info.tags.length ? (
          <View className="flex-row gap-1 overflow-hidden">
            {info.tags.slice(0, w < 260 ? 2 : 3).map(x => (
              <View key={x} className="rounded-md px-2" style={{backgroundColor: 'rgba(242,245,249,0.13)'}}>
                <Text className="font-heavy text-xs2 text-cloud">{x}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function Toast() {
  const msg = useStore(ui, s => s.toast);
  const [visible, setVisible] = useState(null);
  useEffect(() => {
    if (!msg) return undefined;
    setVisible(msg);
    const timer = setTimeout(() => setVisible(null), msg.kind === 'bad' ? 5000 : 3200);
    return () => clearTimeout(timer);
  }, [msg]);
  if (!visible) return null;
  return (
    <motion.View key={visible.at} initial={{y: 30, opacity: 0}} animate={{y: 0, opacity: 1}} transition={{duration: 0.2}}
      className="absolute bottom-[78px] left-0 right-0 items-center" pointerEvents="none">
      <View className="px-6 py-3 rounded-full border-2 bg-haze2"
        style={{borderColor: visible.kind === 'bad' ? '#ff7a7a' : visible.kind === 'ok' ? '#57d9a3' : '#2d4568'}}>
        <Text className="font-semi text-body text-cloud">{t(visible.text)}</Text>
      </View>
    </motion.View>
  );
}

// Bandeiras desenhadas (sem imagens): 3:2, cantos arredondados pelo contêiner.
const R = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}z`;
const FLAGS = {
  br: [['#229e45', R(0, 0, 30, 20)], ['#f8e509', 'M15 2.2 L27.6 10 L15 17.8 L2.4 10 Z'], ['#2b49a3', 'M15 5.6a4.4 4.4 0 1 0 0.01 0z']],
  us: [['#ffffff', R(0, 0, 30, 20)], ...[0, 2, 4, 6, 8, 10, 12].map(i => ['#b22234', R(0, i * 20 / 13, 30, 20 / 13)]), ['#3c3b6e', R(0, 0, 12, 20 * 7 / 13)]],
  es: [['#c60b1e', R(0, 0, 30, 20)], ['#ffc400', R(0, 5, 30, 10)]],
  fr: [['#002395', R(0, 0, 10, 20)], ['#ffffff', R(10, 0, 10, 20)], ['#ed2939', R(20, 0, 10, 20)]],
  de: [['#000000', R(0, 0, 30, 6.67)], ['#dd0000', R(0, 6.67, 30, 6.67)], ['#ffce00', R(0, 13.33, 30, 6.67)]],
  it: [['#009246', R(0, 0, 10, 20)], ['#ffffff', R(10, 0, 10, 20)], ['#ce2b37', R(20, 0, 10, 20)]],
};
export function Flag({code, w = 48}) {
  const h = Math.round(w * 2 / 3);
  return (
    <View style={{width: w, height: h, borderRadius: Math.round(w / 9), overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)'}}>
      <Svg width={w} height={h} viewBox="0 0 30 20" style={{width: w, height: h}}>
        {(FLAGS[code] || []).map(([fill, d], i) => <Path key={i} d={d} fill={fill} />)}
      </Svg>
    </View>
  );
}
