// Luz do controle (DualSense) mostra o que o Nimbo está fazendo:
//   âmbar = baixando · roxo = extraindo/copiando · verde = terminou (15 s) · vermelho = falhou (60 s)
// Sem nada acontecendo, volta para a cor do sistema. Só muda quando o estado muda (uma chamada
// ao host por troca, nada por quadro). Em hosts sem Controller.setLightBar, não faz nada.
import {Controller} from '@ps5-react/core';
import {config, queue} from './store.js';

const COLORS = {download: '#ffb020', disk: '#9b6bff', done: '#3ddc84', error: '#ff4a4a'};
let shown = '';
let doneUntil = 0;
let lastDone = -1;
let errorUntil = 0;
let lastErrors = -1;

function apply(state) {
  if (state === shown) return;
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

// Ao sair do app, devolve a cor do sistema.
export function resetLightBar() { apply(''); }
