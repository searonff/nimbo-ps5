// Luz do controle (DualSense) mostra o que o Nimbo está fazendo:
//   âmbar = baixando · roxo = extraindo/copiando · verde = terminou (15 s) · vermelho = falhou (60 s)
// Sem nada acontecendo, volta para a cor do sistema. Só muda quando o estado muda (uma chamada
// ao host por troca, nada por quadro). Em hosts sem Controller.setLightBar, não faz nada.
import {Controller} from '@ps5-react/core';
import {config, queue} from './store.js';

const COLORS = {download: '#ffb020', disk: '#9b6bff', done: '#3ddc84', error: '#ff4a4a'};
// null: nada aplicado ainda. O PS5 entrega a luz apagada ao app que abre o controle, então a
// primeira chamada sempre acontece (mesmo parado, acende o azul padrão).
let shown = null;
let testing = false;
let doneUntil = 0;
let lastDone = -1;
let errorUntil = 0;
let lastErrors = -1;

function apply(state) {
  if (testing || state === shown) return;
  shown = state;
  try {
    if (!Controller) return;
    if (state && COLORS[state]) Controller.setLightBar(COLORS[state]);
    else Controller.resetLightBar();
  } catch (_) { /* host antigo ou sem controle */ }
}

function compute() {
  if (config.get().lightBar === false) return '';
  const {jobs, tasks} = queue.get();
  const finished = jobs.filter(j => j.state === 'done').length + tasks.filter(t => t.state === 'done').length;
  if (lastDone >= 0 && finished > lastDone) doneUntil = Date.now() + 15000;
  lastDone = finished;
  // Erro acende só quando acontece (itens antigos com erro na lista não deixam a luz vermelha).
  const errors = jobs.filter(j => j.state === 'error').length + tasks.filter(t => t.state === 'error').length;
  if (lastErrors >= 0 && errors > lastErrors) errorUntil = Date.now() + 60000;
  lastErrors = errors;
  if (Date.now() < errorUntil) return 'error';
  if (tasks.some(t => t.state === 'running')) return 'disk';
  if (jobs.some(j => j.state === 'downloading')) return 'download';
  if (Date.now() < doneUntil) return 'done';
  return '';
}

export function startLightBar() {
  const update = () => apply(compute());
  queue.subscribe(update);
  config.subscribe(update);
  setInterval(update, 3000);   // apaga o verde depois dos 15 s
  update();
}

// Teste ao ligar a opção: passa pelas cores (âmbar, roxo, verde, vermelho) e volta ao normal.
export function testLightBar() {
  if (!Controller) return;
  const seq = ['download', 'disk', 'done', 'error'];
  testing = true;
  seq.forEach((k, i) => setTimeout(() => { try { Controller.setLightBar(COLORS[k]); } catch (_) { /* sem controle */ } }, i * 700));
  setTimeout(() => { testing = false; shown = null; apply(compute()); }, seq.length * 700);
}

// Ao sair do app, devolve a cor do sistema.
export function resetLightBar() { apply(''); }
