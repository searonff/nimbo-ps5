// Paleta "anoitecer sobre as nuvens": noite azul-ardósia, nuvens claras e o dourado de sol como foco.
export default {theme: {extend: {
  colors: {
    night: '#0f1b2d', haze: '#172741', haze2: '#213656', rim: '#2d4568',
    cloud: '#f2f5f9', mist: '#93a7c3', sun: '#ffc857', sky: '#63b3ed', ok: '#57d9a3', bad: '#ff7a7a',
    // glass: vidro meio-termo, deixa o céu aparecer sem perder o contraste do texto na TV.
    glass: 'rgba(16,28,52,0.64)', line: 'rgba(214,222,245,0.14)', shade: 'rgba(5,10,20,0.72)',
  },
  fontFamily: {
    body: './assets/Nunito-Medium.ttf',
    semi: './assets/Nunito-SemiBold.ttf',
    heavy: './assets/Nunito-ExtraBold.ttf',
  },
  fontSize: {xs2: '13px', cap: '15px', body: '18px', lead: '22px', h2: '26px', h1: '34px', hero: '64px', giant: '92px'},
}}};
