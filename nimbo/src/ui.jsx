// Componentes visuais do Nimbo: fundo de céu, barra superior, barra de botões, anel de progresso, capas.
import {useEffect, useState} from 'react';
import {View, Text, Image, Svg, Circle, Line, Path, motion} from '@ps5-react/core';
import sky from '../assets/art/sky.png';
import cloud1 from '../assets/art/cloud1.png';
import cloud2 from '../assets/art/cloud2.png';
import cloud3 from '../assets/art/cloud3.png';
import {useStore, ui} from './store.js';

const Arc = 'Arc';   // primitiva de arco do Embedded React (graus, sentido horário a partir das 12h)
import {fmtSpeed} from './engine.js';
import {t} from './i18n.js';

/* céu com nuvens que atravessam a tela devagar (só translate: barato no renderizador) */
const DRIFT = [
  {src: cloud3, w: 520, h: 180, y: 120, dur: 140, from: -560, delay: 0},
  {src: cloud1, w: 420, h: 150, y: 300, dur: 110, from: -460, delay: -60},
  {src: cloud2, w: 300, h: 110, y: 60, dur: 95, from: -340, delay: -30},
];
export function Background({tint}) {
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Image layer source={sky} style={{position: 'absolute', left: 0, top: 0, width: 1920, height: 1080}} resizeMode="cover" />
      {tint ? <View className="absolute inset-0" style={{backgroundGradient: {type: 'linear', angle: 135, stops: [
        {color: tint, offset: 0}, {color: 'rgba(15,27,45,0)', offset: 0.7}]}}} /> : null}
      {DRIFT.map((c, i) => (
        <motion.View key={i} className="absolute" style={{top: c.y, left: 0, width: c.w, height: c.h}}
          initial={{x: c.from}} animate={{x: 1960}}
          transition={{duration: c.dur, ease: 'linear', repeat: Infinity, delay: c.delay}}>
          <Image source={c.src} style={{width: c.w, height: c.h}} resizeMode="stretch" />
        </motion.View>
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
export function Button({label, onPress, primary, danger, small, focusKey, disabled}) {
  const look = {backgroundColor: primary ? '#ffc857' : danger ? '#172741' : '#213656',
    height: small ? 57 : 75, paddingLeft: small ? 24 : 36, paddingRight: small ? 24 : 36};
  return (
    <View focusKey={focusKey} onPress={disabled ? undefined : onPress} disabled={disabled} style={look}
      className="rounded-full flex-row items-center justify-center border-[3px] border-transparent
        focused:border-sun focused:scale-105 transition-transform duration-150">
      <Text className={small ? 'font-heavy text-cap' : 'font-heavy text-body'}
        style={{color: primary ? '#2b1d00' : danger ? '#ff7a7a' : '#f2f5f9'}}>{t(label)}</Text>
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
export function Cover({name, w, h, radius = 14, big}) {
  const hh = hue(name);
  return (
    <View style={{width: w, height: h, borderRadius: radius, backgroundGradient: {type: 'linear', angle: 135, stops: [
      {color: hsl(hh, 55, 42), offset: 0}, {color: hsl((hh + 40) % 360, 60, 22), offset: 1}]}}}
      className="justify-end p-3">
      <Text className={big ? 'font-heavy text-hero' : 'font-heavy text-h1'} style={{color: 'rgba(255,255,255,0.93)'}}>{initials(name)}</Text>
    </View>
  );
}

export function Toast() {
  const t = useStore(ui, s => s.toast);
  const [visible, setVisible] = useState(null);
  useEffect(() => {
    if (!t) return undefined;
    setVisible(t);
    const timer = setTimeout(() => setVisible(null), t.kind === 'bad' ? 5000 : 3200);
    return () => clearTimeout(timer);
  }, [t]);
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
