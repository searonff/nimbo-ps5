/* Nimbo PS5 — interface (PS5 e celular). JS compatível com o WebKit do PS5 (sem ?. e ??). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = {
    tab: 'downloads', cfg: null, status: null, cloudKind: 'torrents', cloud: [], cloudOpen: {},
    fsPath: null, drives: [], addMode: 'torbox', addDest: null, overview: null
  };

  /* ---------- utilidades ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtSize(b) {
    if (b == null || b < 0) return '?';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b >= 100 ? 0 : 1) : b) + ' ' + u[i];
  }
  function fmtSpeed(b) { return fmtSize(b || 0) + '/s'; }
  function fmtEta(s) {
    if (s == null || s < 0) return '';
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
  }
  function pct(a, b) { return b > 0 ? Math.min(100, a * 100 / b) : 0; }

  function api(method, path, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Erro HTTP ' + r.status));
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, isErr ? 6000 : 3500);
  }
  function fail(e) { toast(e.message || String(e), true); }

  /* ---------- modal ---------- */
  var modalOnClose = null;
  function openModal(title, html, onClose) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
    modalOnClose = onClose || null;
    setTimeout(function () { var f = $('#modal-body [data-nav]') || $('#modal-close'); if (f) f.focus(); }, 30);
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal-body').innerHTML = '';
    var cb = modalOnClose; modalOnClose = null;
    if (cb) cb();
  }
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

  function promptModal(title, label, value) {
    return new Promise(function (resolve) {
      openModal(title, '<label class="field">' + esc(label) + '<input id="pm-in" type="text" data-nav value="' + esc(value || '') + '"></label>' +
        '<div class="actions"><button class="btn primary" id="pm-ok" data-nav>OK</button></div>', function () { resolve(null); });
      var done = function () { var v = $('#pm-in').value; modalOnClose = null; closeModal(); resolve(v); };
      $('#pm-ok').onclick = done;
      $('#pm-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
    });
  }
  function confirmModal(title, text, okLabel) {
    return new Promise(function (resolve) {
      openModal(title, '<p>' + esc(text) + '</p><div class="actions"><button class="btn danger" id="cm-ok" data-nav>' + esc(okLabel || 'Confirmar') +
        '</button><button class="btn ghost" id="cm-no" data-nav>Cancelar</button></div>', function () { resolve(false); });
      $('#cm-ok').onclick = function () { modalOnClose = null; closeModal(); resolve(true); };
      $('#cm-no').onclick = function () { closeModal(); };
    });
  }

  /* ---------- seletor de pasta ---------- */
  function pickFolder(title, start, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var cur = start;
      var result = null;
      function render() {
        api('GET', '/api/storage').then(function (drives) {
          var dHtml = drives.map(function (d) {
            return '<button class="drive' + (cur && cur.indexOf(d.path) === 0 ? ' active' : '') + '" data-nav data-drive="' + esc(d.path) + '"><b>' + esc(d.label) +
              '</b><div class="small muted">' + fmtSize(d.free) + ' livres de ' + fmtSize(d.total) + '</div><div class="bar"><i style="width:' +
              pct(d.total - d.free, d.total) + '%"></i></div></button>';
          }).join('');
          if (!cur && drives.length) cur = drives[0].path;
          return api('GET', '/api/fs?path=' + encodeURIComponent(cur)).catch(function () {
            cur = drives.length ? drives[0].path : '/';
            return api('GET', '/api/fs?path=' + encodeURIComponent(cur));
          }).then(function (ls) {
            var dirs = ls.entries.filter(function (e) { return e.dir; });
            var list = (ls.parent ? '<button class="btn ghost" data-nav data-go="' + esc(ls.parent) + '">⬆ Voltar</button>' : '') +
              dirs.map(function (e) { return '<button class="btn ghost" style="text-align:left" data-nav data-go="' + esc(e.path) + '">' + icon('folder', 22) + ' ' + esc(e.name) + '</button>'; }).join('') +
              (dirs.length ? '' : '<div class="empty">Nenhuma subpasta</div>');
            var extra = '';
            if (opts.extractOpts) {
              extra = '<label class="check"><input type="checkbox" id="pf-x" data-nav' + (opts.extract ? ' checked' : '') + '> Extrair após o download</label>' +
                '<label class="check"><input type="checkbox" id="pf-d" data-nav' + (opts.deleteArchive ? ' checked' : '') + '> Apagar o compactado após extrair</label>' +
                '<label class="check"><input type="checkbox" id="pf-r" data-nav> Lembrar esta pasta como padrão</label>';
            }
            $('#modal-body').innerHTML = '<div class="drives">' + dHtml + '</div><div class="muted">Pasta: <b>' + esc(ls.path) + '</b> · ' + fmtSize(ls.free) +
              ' livres</div><div class="picker-list">' + list + '</div>' + extra +
              '<div class="actions"><button class="btn primary" id="pf-ok" data-nav>' + esc(opts.okLabel || 'Usar esta pasta') +
              '</button><button class="btn ghost" id="pf-new" data-nav>Nova pasta</button></div>';
            cur = ls.path;
            $$('[data-drive]', $('#modal-body')).forEach(function (b) { b.onclick = function () { cur = b.getAttribute('data-drive'); render(); }; });
            $$('[data-go]', $('#modal-body')).forEach(function (b) { b.onclick = function () { cur = b.getAttribute('data-go'); render(); }; });
            $('#pf-new').onclick = function () {
              var name = window.prompt('Nome da nova pasta');
              if (!name) return;
              api('POST', '/api/fs/mkdir', { path: cur, name: name }).then(render).catch(fail);
            };
            $('#pf-ok').onclick = function () {
              if (opts.needBytes && ls.free >= 0 && opts.needBytes > ls.free) {
                if (!window.confirm('Espaço insuficiente: precisa de ' + fmtSize(opts.needBytes) + ' e só há ' + fmtSize(ls.free) + ' livres. Continuar mesmo assim?')) return;
              }
              result = { path: cur };
              if (opts.extractOpts) { result.extract = $('#pf-x').checked; result.deleteArchive = $('#pf-d').checked; result.remember = $('#pf-r').checked; }
              closeModal();
            };
            var f = $('#pf-ok'); if (f) f.focus();
          });
        }).catch(fail);
      }
      openModal(title, '<div class="empty">Carregando…</div>', function () { resolve(result); });
      render();
    });
  }

  /* ---------- abas ---------- */
  function showTab(name) {
    state.tab = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'cloud' && !state.cloud.length) loadCloud().catch(function () { });
    if (name === 'home') { loadHomeCloud(); loadHomeDrives(); }
    if (name === 'files') loadFiles();
    if (name === 'settings') loadSettings();
    if (name === 'storage') loadStorage();
    if (name === 'add') renderAddDest();
    try { localStorage.setItem('nimbo.tab', name); } catch (e) { }
  }
  $$('.tab').forEach(function (t) { t.onclick = function () { showTab(t.getAttribute('data-tab')); }; });
  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('[data-goto]') : null;
    if (g) { e.preventDefault(); showTab(g.getAttribute('data-goto')); }
  });

  /* ---------- topo ---------- */
  function renderTop(st) {
    $('#speed-total').textContent = fmtSpeed(st.speed);
    var b = $('#btn-limit');
    b.textContent = st.speed_limit_on ? ('Limite: ' + fmtSpeed(st.speed_limit_kbps * 1024)) : 'Sem limite';
    b.classList.toggle('on', !!st.speed_limit_on);
    $('#nokey').classList.toggle('hidden', !!st.has_key);
  }
  $('#btn-limit').onclick = function () {
    var on = !(state.status && state.status.speed_limit_on);
    api('POST', '/api/config', { speed_limit_on: on }).then(function (c) {
      state.cfg = c; toast(on ? 'Limite de velocidade ligado' : 'Limite de velocidade desligado'); refresh();
    }).catch(fail);
  };
  $('#btn-qr').onclick = function () {
    var st = state.status || {};
    var url = 'http://' + (st.ip || location.hostname) + ':' + (st.port || location.port || 8090) + '/';
    var html = '<div class="qr"><div class="code" id="qr-code"></div><div class="url">' + esc(url) +
      '</div><div class="muted">Aponte a câmera do celular (mesmo Wi-Fi do PS5).</div></div>';
    openModal('Abrir no celular', html);
    try {
      var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      $('#qr-code').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2 });
    } catch (e) { $('#qr-code').textContent = url; }
  };

  /* ---------- conectar TorBox por QR code (código de dispositivo) ---------- */
  var authTimer = null;
  function connectTorbox() {
    clearInterval(authTimer);
    openModal('Conectar TorBox', '<div class="empty">Gerando código…</div>', function () {
      clearInterval(authTimer);
      if (!connectTorbox.ok) api('POST', '/api/auth/cancel').catch(function () { });
    });
    connectTorbox.ok = false;
    api('POST', '/api/auth/start').then(function (a) {
      var html = '<div class="qr"><div class="code" id="auth-qr"></div>' +
        '<div class="muted">1. Escaneie com o celular (ou abra <b>' + esc(a.friendly_url) + '</b>)</div>' +
        '<div class="muted">2. Faça login no TorBox e digite o código:</div>' +
        '<div class="pair-code">' + esc(a.code) + '</div>' +
        '<div class="muted small" id="auth-status">Aguardando aprovação… <span id="auth-left"></span></div></div>';
      $('#modal-body').innerHTML = html;
      try { var qr = qrcode(0, 'M'); qr.addData(a.url); qr.make(); $('#auth-qr').innerHTML = qr.createSvgTag({ cellSize: 7, margin: 2 }); }
      catch (e) { $('#auth-qr').textContent = a.url; }
      authTimer = setInterval(function () {
        api('GET', '/api/auth/status').then(function (s) {
          var left = $('#auth-left');
          if (left) left.textContent = '(expira em ' + Math.floor(s.expires_in / 60) + ':' + ('0' + s.expires_in % 60).slice(-2) + ')';
          if (s.state === 'ok') {
            clearInterval(authTimer);
            connectTorbox.ok = true;
            closeModal();
            toast('TorBox conectado!');
            state.cloud = [];
            loadConfig(); refresh();
            if (state.tab === 'settings') loadSettings();
            state.homeCloud = null;
            refresh().then(function () { showTab('home'); });
          } else if (s.state === 'expired' || s.state === 'error') {
            clearInterval(authTimer);
            $('#auth-status').innerHTML = esc(s.error || 'O código expirou') + ' <button class="btn sm" data-nav id="auth-retry">Gerar outro código</button>';
            $('#auth-retry').onclick = connectTorbox;
            $('#auth-retry').focus();
          }
        }).catch(function () { });
      }, 2000);
    }).catch(function (e) {
      $('#modal-body').innerHTML = '<div class="notice">' + esc(e.message) + '</div><div class="actions"><button class="btn" data-nav id="auth-retry">Tentar de novo</button></div>';
      $('#auth-retry').onclick = connectTorbox;
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-connect]') : null;
    if (b) { e.preventDefault(); connectTorbox(); }
  });

  /* ---------- downloads ---------- */
  var JOB_STATE = { queued: 'Na fila', downloading: 'Baixando', paused: 'Pausado', done: 'Concluído', error: 'Erro' };
  var TASK_STATE = { queued: 'Na fila', running: 'Em andamento', done: 'Concluído', error: 'Erro', canceled: 'Cancelado' };
  var TASK_TYPE = { extract: 'Extrair', copy: 'Copiar', move: 'Mover' };

  function jobHtml(j) {
    var p = pct(j.done, j.size);
    var cls = j.state === 'done' ? 'done' : j.state === 'paused' || j.state === 'queued' ? 'paused' : j.state === 'error' ? 'err' : '';
    var pillCls = j.state === 'done' ? 'ok' : j.state === 'error' ? 'err' : j.state === 'downloading' ? 'run' : 'warn';
    var sub = [];
    sub.push(fmtSize(j.done) + ' de ' + (j.size > 0 ? fmtSize(j.size) : '?') + (j.size > 0 ? ' (' + p.toFixed(1) + '%)' : ''));
    if (j.state === 'downloading') {
      sub.push(fmtSpeed(j.speed));
      if (j.eta >= 0) sub.push('falta ' + fmtEta(j.eta));
      if (j.conns) sub.push(j.conns + (j.conns > 1 ? ' conexões' : ' conexão'));
    }
    sub.push(j.type === 'torbox' ? 'TorBox' : 'Direto');
    var btns = '';
    if (j.state === 'downloading' || j.state === 'queued') btns += '<button class="btn sm" data-nav data-job="pause">Pausar</button>';
    if (j.state === 'paused') btns += '<button class="btn sm" data-nav data-job="resume">Retomar</button>';
    if (j.state === 'error') btns += '<button class="btn sm" data-nav data-job="retry">Tentar de novo</button>';
    if (j.state === 'queued' || j.state === 'paused') btns += '<button class="btn sm ghost" data-nav data-job="top">Baixar primeiro</button>';
    if (j.state !== 'done') btns += '<button class="btn sm ghost" data-nav data-job="cancel">Cancelar</button>';
    if (j.state === 'done' || j.state === 'error' || j.state === 'paused') btns += '<button class="btn sm ghost" data-nav data-job="remove">Remover da lista</button>';
    if (j.state === 'done') btns += '<button class="btn sm ghost" data-nav data-open="' + esc(j.final_path) + '">Mostrar na pasta</button>';
    return '<div class="item' + (j.state === 'error' ? ' err' : '') + '" data-id="' + j.id + '"><div class="item-head"><div class="item-title">' + esc(j.display) +
      '</div><span class="pill ' + pillCls + '">' + JOB_STATE[j.state] + '</span></div><div class="item-sub">' + sub.map(esc).join('<span>·</span>') +
      '</div>' + (j.error ? '<div class="small" style="color:var(--err);margin-top:6px">' + esc(j.error) + '</div>' : '') +
      '<div class="bar ' + cls + '"><i style="width:' + (j.state === 'done' ? 100 : p) + '%"></i></div>' +
      '<div class="small muted" style="margin-top:6px">' + esc(j.final_path || j.dest_dir) + (j.x_extract ? ' · extrair ao terminar' : '') +
      '</div><div class="actions">' + btns + '</div></div>';
  }

  function taskHtml(t) {
    var p = pct(t.done, t.total);
    var pillCls = t.state === 'done' ? 'ok' : t.state === 'error' ? 'err' : t.state === 'running' ? 'run' : 'warn';
    var btns = '';
    if (t.state === 'running' || t.state === 'queued') btns += '<button class="btn sm ghost" data-nav data-task="cancel">Cancelar</button>';
    if (t.state === 'error' || t.state === 'canceled') btns += '<button class="btn sm" data-nav data-task="retry">Tentar de novo</button>';
    if (t.state !== 'running') btns += '<button class="btn sm ghost" data-nav data-task="remove">Remover da lista</button>';
    if (t.state === 'done' && t.type === 'extract') btns += '<button class="btn sm ghost" data-nav data-open="' + esc(t.dest) + '/">Abrir pasta</button>';
    return '<div class="item' + (t.state === 'error' ? ' err' : '') + '" data-tid="' + t.id + '"><div class="item-head"><div class="item-title">' +
      esc(TASK_TYPE[t.type] + ': ' + t.name) + (t.automatic ? ' <span class="pill">automático</span>' : '') + '</div><span class="pill ' + pillCls + '">' +
      TASK_STATE[t.state] + '</span></div><div class="item-sub"><span>' + esc(t.current || '') + '</span>' +
      (t.total > 0 && t.state === 'running' ? '<span>' + p.toFixed(0) + '%</span>' : '') + '</div>' +
      (t.error ? '<div class="small" style="color:var(--err);margin-top:6px">' + esc(t.error) + '</div>' : '') +
      '<div class="bar extract' + (t.state === 'error' ? ' err' : '') + '"><i style="width:' + (t.state === 'done' ? 100 : p) + '%"></i></div>' +
      '<div class="actions">' + btns + '</div></div>';
  }

  /* atualiza só o que mudou para não perder o foco do controle */
  function patchList(el, items, keyFn, htmlFn, emptyText) {
    if (!items.length) { el.innerHTML = '<div class="empty">' + esc(emptyText) + '</div>'; return; }
    var focusedKey = null, focusedAct = null;
    var ae = document.activeElement;
    if (ae && el.contains(ae)) {
      var it = ae.closest('.item');
      if (it) { focusedKey = it.getAttribute('data-key'); focusedAct = ae.getAttribute('data-job') || ae.getAttribute('data-task') || ae.getAttribute('data-open'); }
    }
    var html = items.map(function (x) { var h = htmlFn(x); return h.replace('<div class="item', '<div data-key="' + esc(keyFn(x)) + '" class="item'); }).join('');
    if (el._last === html) return;
    el._last = html;
    el.innerHTML = html;
    if (focusedKey) {
      var item = el.querySelector('[data-key="' + focusedKey + '"]');
      if (item) {
        var b = item.querySelector('[data-job="' + focusedAct + '"],[data-task="' + focusedAct + '"]') || item.querySelector('[data-nav]');
        if (b) b.focus();
      }
    }
  }

  var prevStates = null;
  function announce(o) {
    var cur = {};
    o.jobs.forEach(function (j) { cur['j' + j.id] = j.state; });
    o.tasks.forEach(function (t) { cur['t' + t.id] = t.state; });
    if (prevStates) {
      o.jobs.forEach(function (j) {
        var p = prevStates['j' + j.id];
        if (p && p !== j.state && j.state === 'done') toast('✓ Download concluído: ' + j.display);
        if (p && p !== j.state && j.state === 'error') toast('Falha: ' + j.display + ' — ' + j.error, true);
      });
      o.tasks.forEach(function (t) {
        var p = prevStates['t' + t.id];
        if (p !== t.state && t.state === 'done') toast('✓ ' + TASK_TYPE[t.type] + ' concluído: ' + t.name);
        if (p !== t.state && t.state === 'error' && p) toast(TASK_TYPE[t.type] + ' falhou: ' + t.error, true);
      });
    }
    prevStates = cur;
  }

  function renderOverview(o) {
    announce(o);
    state.status = o;
    if (state.cloud.length || state.homeCloud) renderCloudBadges();
    renderHome(o);
    renderTop(o);
    var active = o.jobs.filter(function (j) { return j.state !== 'done'; });
    var done = o.jobs.filter(function (j) { return j.state === 'done'; }).sort(function (a, b) { return b.finished - a.finished; });
    patchList($('#job-list'), active, function (j) { return 'j' + j.id; }, jobHtml, 'Nenhum download em andamento. Escolha algo na aba Nuvem ou Adicionar.');
    patchList($('#task-list'), o.tasks.slice().reverse(), function (t) { return 't' + t.id; }, taskHtml, 'Nenhuma extração ou cópia.');
    var showAll = state.showAllDone;
    patchList($('#done-list'), showAll ? done : done.slice(0, 6), function (j) { return 'j' + j.id; }, jobHtml, 'Nada concluído ainda.');
    var more = $('#done-more');
    if (!more) { more = document.createElement('div'); more.id = 'done-more'; more.className = 'actions'; $('#done-list').after(more); }
    more.innerHTML = done.length > 6 ? '<button class="btn ghost sm" data-nav id="btn-done-more">' + (showAll ? 'Mostrar menos' : 'Ver todos os ' + done.length) + '</button>' : '';
    var bm = $('#btn-done-more'); if (bm) bm.onclick = function () { state.showAllDone = !state.showAllDone; refresh(); };
    var w = o.watches || [];
    $('#watch-list').innerHTML = w.length ? '<div class="notice">Aguardando ficar pronto no TorBox para baixar automaticamente: ' + w.length +
      ' item(ns). <button class="btn sm ghost" data-goto="cloud" data-nav>Ver na nuvem</button></div>' : '';
    var badge = $('#badge-dl');
    badge.textContent = active.length;
    badge.classList.toggle('hidden', !active.length);
  }

  function jobAction(id, act) { api('POST', '/api/jobs/' + id + '/' + act).then(refresh).catch(fail); }
  function taskAction(id, act) { api('POST', '/api/tasks/' + id + '/' + act).then(refresh).catch(fail); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-job],[data-task],[data-open]') : null;
    if (!b) return;
    var item = b.closest('.item');
    if (b.hasAttribute('data-open')) {
      var p = b.getAttribute('data-open');
      state.fsPath = p.charAt(p.length - 1) === '/' ? p.slice(0, -1) : p.substring(0, p.lastIndexOf('/'));
      showTab('files');
      return;
    }
    if (b.hasAttribute('data-job')) {
      var act = b.getAttribute('data-job');
      var id = item.getAttribute('data-id');
      if (act === 'cancel') {
        confirmModal('Cancelar download', 'O arquivo parcial será apagado.', 'Cancelar download').then(function (ok) { if (ok) jobAction(id, 'cancel'); });
      } else jobAction(id, act);
    } else if (b.hasAttribute('data-task')) {
      taskAction(item.getAttribute('data-tid'), b.getAttribute('data-task'));
    }
  });
  $('#btn-clear-done').onclick = function () { api('POST', '/api/jobs/clear').then(refresh).catch(fail); };
  $('#btn-clear-tasks').onclick = function () { api('POST', '/api/tasks/clear').then(refresh).catch(fail); };
  function bulk(act, from) {
    var jobs = (state.status && state.status.jobs) || [];
    var ps = jobs.filter(function (j) { return from.indexOf(j.state) >= 0; }).map(function (j) { return api('POST', '/api/jobs/' + j.id + '/' + act); });
    Promise.all(ps).then(refresh).catch(fail);
  }
  $('#btn-pause-all').onclick = function () { bulk('pause', ['downloading', 'queued']); };
  $('#btn-resume-all').onclick = function () { bulk('resume', ['paused', 'error']); };

  var refreshing = false;
  function refresh() {
    if (refreshing) return Promise.resolve();
    refreshing = true;
    return api('GET', '/api/overview').then(renderOverview).catch(function () { }).then(function () { refreshing = false; });
  }
  setInterval(function () { if (!document.hidden) refresh(); }, 1500);

  /* ---------- nuvem ---------- */
  var CLOUD_STATE = { downloading: 'Baixando no TorBox', uploading: 'Pronto', completed: 'Pronto', cached: 'Pronto', paused: 'Pausado no TorBox',
    stalled: 'Parado', 'stalled (no seeds)': 'Sem seeds', metaDL: 'Buscando dados', checkingResumeData: 'Verificando', queued: 'Na fila do TorBox' };

  function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function initials(name) {
    var clean = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\[\(].*?[\]\)]/g, ' ').replace(/[._\-]+/g, ' ').trim();
    var w = clean.split(/\s+/).filter(function (x) { return /[a-z0-9]/i.test(x); });
    if (!w.length) return '?';
    return (w[0].charAt(0) + (w[1] ? w[1].charAt(0) : (w[0].charAt(1) || ''))).toUpperCase();
  }
  var SVG = {
    video: '<path d="M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>',
    archive: '<path d="M3 4h18v5H3zM5 9h14v11H5z"/><path d="M10 13h4" stroke="currentColor" stroke-width="2" fill="none"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="rgba(0,0,0,.35)"/>',
    music: '<path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="6.5" cy="18" r="2.8"/><circle cx="17.5" cy="16" r="2.8"/>',
    cloud: '<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 8.5 4.75 4.75 0 0 1 17.5 18z"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>',
    image: '<path d="M3 5h18v14H3z"/><path d="M5 17l5-6 4 4 2-2 3 4z" fill="rgba(0,0,0,.35)"/>'
  };
  function icon(name, size) { return '<svg class="ic" width="' + (size || 26) + '" height="' + (size || 26) + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + SVG[name] + '</svg>'; }
  function glyphFor(it) {
    var names = it.files.map(function (f) { return f.name.toLowerCase(); }).join(' ') + ' ' + it.name.toLowerCase();
    if (/\.(mkv|mp4|avi|m4v|ts)\b/.test(names)) return icon('video');
    if (/\.(rar|zip|7z|001)\b/.test(names)) return icon('archive');
    if (/\.(pkg|iso|exfat|ffpkg)\b/.test(names)) return icon('disc');
    if (/\.(mp3|flac|m4a)\b/.test(names)) return icon('music');
    return icon('cloud');
  }
  function coverStyle(name) {
    var h = hashHue(name);
    return 'background: linear-gradient(135deg, hsl(' + h + ',55%,42%), hsl(' + ((h + 40) % 360) + ',60%,24%))';
  }
  function cloudReady(it) { return it.finished || it.present || it.state === 'completed' || it.state === 'cached' || it.state === 'uploading'; }

  function tileHtml(it, m) {
    var ready = cloudReady(it);
    var have = itemHave(it, m);
    var st = ready ? 'Pronto' : (CLOUD_STATE[it.state] || it.state || 'Processando');
    return '<button class="tile" data-nav data-tile="' + esc(it.kind + ':' + it.id) + '"><div class="cover" style="' + coverStyle(it.name) + '"><span class="glyph">' +
      glyphFor(it) + '</span><span class="initials">' + esc(initials(it.name)) + '</span></div><div class="meta"><div class="name">' + esc(it.name) +
      '</div><div class="sub"><span>' + fmtSize(it.size) + '</span>' + (have ? '<span class="pill ' + have[0] + '">' + esc(have[1]) + '</span>' :
      '<span class="pill ' + (ready ? 'ok' : 'warn') + '">' + esc(st) + '</span>') + '</div>' +
      (!ready ? '<div class="bar paused"><i style="width:' + (it.progress * 100) + '%"></i></div>' : '') + '</div></button>';
  }

  function loadCloud(kind) {
    kind = kind || state.cloudKind;
    if (kind === state.cloudKind) $('#cloud-list').innerHTML = '<div class="empty">Carregando sua nuvem…</div>';
    return api('GET', '/api/cloud?kind=' + kind).then(function (list) {
      list.forEach(function (it) { it.kind = kind; });
      if (kind === state.cloudKind) { state.cloud = list; renderCloud(); }
      return list;
    }).catch(function (e) {
      if (kind === state.cloudKind) $('#cloud-list').innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
      throw e;
    });
  }

  function haveMap() {
    var m = {};
    var jobs = (state.status && state.status.jobs) || [];
    jobs.forEach(function (j) { if (j.type === 'torbox') m[j.tb_kind + ':' + j.item_id + ':' + j.file_id] = j.state; });
    return m;
  }
  function itemHave(it, m) {
    var done = 0, queued = 0;
    it.files.forEach(function (f) {
      var st = m[it.kind + ':' + it.id + ':' + f.id];
      if (st === 'done') done++; else if (st) queued++;
    });
    var downloading = it.files.some(function (f) { return m[it.kind + ':' + it.id + ':' + f.id] === 'downloading'; });
    if (done && done === it.files.length) return ['have', 'Já baixado'];
    if (downloading) return ['run', 'Baixando'];
    if (queued) return ['run', 'Na fila'];
    if (done) return ['have', done + ' de ' + it.files.length + ' baixados'];
    return null;
  }
  var lastHave = '';
  function renderCloudBadges() {
    var sig = JSON.stringify(haveMap());
    if (sig === lastHave) return;
    lastHave = sig;
    renderCloud(true);
    renderHomeCloud();
  }

  function renderCloud(keepFocus) {
    var q = ($('#cloud-search').value || '').toLowerCase();
    var items = state.cloud.filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0; });
    var ae = document.activeElement, fk = ae && ae.getAttribute ? ae.getAttribute('data-tile') : null;
    if (!items.length) {
      $('#cloud-list').innerHTML = '<div class="empty">' + (q ? 'Nada encontrado para "' + esc(q) + '".' :
        'Sua nuvem está vazia. Mande um magnet ou link pela aba Adicionar.') + '</div>';
      return;
    }
    var m = haveMap();
    $('#cloud-list').innerHTML = items.map(function (it) { return tileHtml(it, m); }).join('');
    if (keepFocus && fk) { var el = $('#cloud-list [data-tile="' + fk + '"]'); if (el) el.focus(); }
  }

  function findTile(key) {
    var all = state.cloud.concat(state.homeCloud || []);
    for (var i = 0; i < all.length; i++) if (all[i].kind + ':' + all[i].id === key) return all[i];
    return null;
  }

  function openItem(it) {
    var ready = cloudReady(it);
    var m = haveMap();
    var files = it.files.map(function (f) {
      var st = m[it.kind + ':' + it.id + ':' + f.id];
      return '<div class="file-row"><label><input type="checkbox" data-nav data-fid="' + f.id + '"' + (st === 'done' ? '' : ' checked') + '> ' + esc(f.name) +
        '</label>' + (st === 'done' ? '<span class="pill have">Já baixado</span>' : '') + '<span class="size">' + fmtSize(f.size) + '</span></div>';
    }).join('');
    var html = '<div class="cover-hero tile" style="pointer-events:none"><div class="cover sheet-cover" style="' + coverStyle(it.name) + '"><span class="glyph">' +
      glyphFor(it) + '</span><span class="initials">' + esc(initials(it.name)) + '</span></div></div>' +
      '<div class="item-sub" style="margin:12px 0"><span>' + fmtSize(it.size) + '</span><span>' + it.files.length + ' arquivo' + (it.files.length > 1 ? 's' : '') + '</span>' +
      (ready ? '<span class="pill ok">Pronto no TorBox</span>' : '<span class="pill warn">' + esc((CLOUD_STATE[it.state] || it.state) + ' ' + (it.progress * 100).toFixed(0) + '%') + '</span>') + '</div>' +
      '<div class="actions">' + (ready ? '<button class="btn primary" data-nav data-s="all">Baixar tudo</button>' + (it.files.length > 1 ? '<button class="btn" data-nav data-s="sel">Baixar selecionados</button>' : '')
        : '<button class="btn primary" data-nav data-s="watch">Baixar quando ficar pronto</button>') +
      '<button class="btn danger" data-nav data-s="del">Apagar do TorBox</button></div>' + (it.files.length > 1 && ready ? '<div class="files">' + files + '</div>' : '');
    openModal(it.name, html);
    $$('[data-s]', $('#modal-body')).forEach(function (b) {
      b.onclick = function () {
        var s = b.getAttribute('data-s');
        if (s === 'all') { closeModal(); startDownload(it, it.files); }
        else if (s === 'sel') {
          var ids = $$('input[data-fid]:checked', $('#modal-body')).map(function (x) { return x.getAttribute('data-fid'); });
          var sel = it.files.filter(function (f) { return ids.indexOf(String(f.id)) >= 0; });
          if (!sel.length) { toast('Marque pelo menos um arquivo', true); return; }
          closeModal(); startDownload(it, sel);
        } else if (s === 'watch') {
          closeModal();
          var cfg = state.cfg || {};
          pickFolder('Baixar para… quando ficar pronto', cfg.default_dest, { extractOpts: true, extract: cfg.auto_extract, deleteArchive: cfg.delete_after_extract, okLabel: 'Baixar aqui' }).then(function (r) {
            if (!r) return;
            api('POST', '/api/cloud/watch', { kind: it.kind, id: it.id, dest: r.path, extract: r.extract, delete_archive: r.deleteArchive })
              .then(function () { toast('Vou baixar assim que ficar pronto no TorBox'); refresh(); }).catch(fail);
          });
        } else if (s === 'del') {
          closeModal();
          confirmModal('Apagar do TorBox', 'Apagar "' + it.name + '" da nuvem? O que já foi baixado no PS5 continua aqui.', 'Apagar do TorBox').then(function (ok) {
            if (!ok) return;
            api('POST', '/api/cloud/delete', { kind: it.kind, id: it.id }).then(function () { toast('Apagado do TorBox'); loadCloud(); loadHomeCloud(); }).catch(fail);
          });
        }
      };
    });
  }

  function startDownload(it, files) {
    var cfg = state.cfg || {};
    var need = files.reduce(function (a, f) { return a + (f.size || 0); }, 0);
    pickFolder('Baixar ' + fmtSize(need) + ' para…', cfg.default_dest, { extractOpts: true, extract: cfg.auto_extract, deleteArchive: cfg.delete_after_extract, okLabel: 'Baixar aqui', needBytes: need }).then(function (r) {
      if (!r) return;
      var items = files.map(function (f) { return { kind: it.kind, item_id: it.id, file_id: f.id, name: f.name, size: f.size }; });
      api('POST', '/api/download', { dest: r.path, extract: r.extract, delete_archive: r.deleteArchive, remember: r.remember, items: items }).then(function (res) {
        var n = res.ids.length;
        if (n) toast(n + (n > 1 ? ' arquivos na fila' : ' arquivo na fila'));
        if (res.errors.length) toast(res.errors[0], true);
        if (r.remember) loadConfig();
        refresh();
      }).catch(fail);
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tile]') : null;
    if (!t) return;
    var it = findTile(t.getAttribute('data-tile'));
    if (it) openItem(it);
  });
  $$('#cloud-kind button').forEach(function (b) {
    b.onclick = function () {
      $$('#cloud-kind button').forEach(function (x) { x.classList.toggle('active', x === b); });
      state.cloudKind = b.getAttribute('data-kind');
      state.cloud = [];
      loadCloud().catch(function () { });
    };
  });
  $('#cloud-search').addEventListener('input', function () { renderCloud(); });
  $('#btn-cloud-refresh').onclick = function () { loadCloud().catch(function () { }); };

  /* ---------- início ---------- */
  function loadHomeCloud() {
    var kinds = ['torrents', 'webdl', 'usenet'];
    Promise.all(kinds.map(function (k) {
      return api('GET', '/api/cloud?kind=' + k).then(function (l) { l.forEach(function (it) { it.kind = k; }); return l; }).catch(function () { return []; });
    })).then(function (ls) {
      var all = ls[0].concat(ls[1], ls[2]);
      all.sort(function (a, b) { return (b.created || '') < (a.created || '') ? -1 : 1; });
      state.homeCloud = all.slice(0, 14);
      renderHomeCloud();
    });
  }
  function renderHomeCloud() {
    var el = $('#home-cloud');
    if (!state.homeCloud) return;
    if (!state.homeCloud.length) { el.innerHTML = '<div class="empty">Nada na nuvem ainda. Use a aba Adicionar ou mande um link pelo celular.</div>'; return; }
    var ae = document.activeElement, fk = ae && ae.getAttribute ? ae.getAttribute('data-tile') : null;
    var m = haveMap();
    el.innerHTML = state.homeCloud.map(function (it) { return tileHtml(it, m); }).join('');
    if (fk && el.contains(ae) === false) { var x = el.querySelector('[data-tile="' + fk + '"]'); if (x && document.activeElement === document.body) x.focus(); }
  }
  function phoneUrl() {
    var st = state.status || {};
    return 'http://' + (st.ip || location.hostname) + ':' + (st.port || location.port || 8090) + '/';
  }
  var heroSig = '';
  function renderHome(o) {
    var hero = $('#hero');
    $('#hero').classList.toggle('hidden', !o.has_key);
    $$('#tab-home .row-head')[0].classList.toggle('hidden', !o.has_key);
    $('#home-cloud').classList.toggle('hidden', !o.has_key);
    var j = o.jobs.filter(function (x) { return x.state === 'downloading'; })[0];
    var t = o.tasks.filter(function (x) { return x.state === 'running'; })[0];
    var queued = o.jobs.filter(function (x) { return x.state === 'queued'; }).length;
    var html;
    if (j) {
      var p = pct(j.done, j.size);
      html = '<div><div class="kicker">Baixando agora' + (queued ? ', mais ' + queued + ' na fila' : '') + '</div><div class="title">' + esc(j.display) + '</div>' +
        '<div class="pct">' + p.toFixed(0) + '%<small>' + fmtSize(j.done) + ' de ' + fmtSize(j.size) + '</small></div>' +
        '<div class="facts"><span><b>' + fmtSpeed(j.speed) + '</b></span>' + (j.eta >= 0 ? '<span>falta <b>' + fmtEta(j.eta) + '</b></span>' : '') +
        '<span>' + j.conns + ' conexões</span></div><div class="bar"><i style="width:' + p + '%"></i></div></div>';
    } else if (t) {
      var tp = pct(t.done, t.total);
      html = '<div><div class="kicker">' + esc(TASK_TYPE[t.type]) + ' em andamento</div><div class="title">' + esc(t.name) + '</div><div class="pct">' + tp.toFixed(0) +
        '%</div><div class="facts"><span>' + esc(t.current || '') + '</span></div><div class="bar extract"><i style="width:' + tp + '%"></i></div></div>';
    } else {
      var done = o.jobs.filter(function (x) { return x.state === 'done'; }).length;
      html = '<div><div class="kicker">Tudo em dia</div><div class="title">Nenhum download em andamento</div><div class="facts"><span>' +
        (done ? done + ' concluído' + (done > 1 ? 's' : '') + ' recentemente' : 'Escolha algo da sua nuvem abaixo') + '</span></div>' +
        '<div class="actions"><button class="btn primary" data-nav data-goto="cloud">Abrir a nuvem</button><button class="btn ghost" data-nav data-goto="add">Adicionar link</button></div></div>';
    }
    html += '<div class="side"><div class="code" id="hero-qr"></div><div class="u">Use pelo celular</div><div class="muted small">' + esc(phoneUrl().replace('http://', '')) + '</div></div>';
    var sig = html.replace(/<i style="width:[^"]*"><\/i>/g, '');
    if (sig !== heroSig || !hero.firstChild) {
      var focusInHero = hero.contains(document.activeElement) ? document.activeElement.getAttribute('data-goto') : null;
      heroSig = sig;
      hero.innerHTML = html;
      try { var qr = qrcode(0, 'M'); qr.addData(phoneUrl()); qr.make(); $('#hero-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 }); } catch (e) { }
      if (focusInHero) { var f = hero.querySelector('[data-goto="' + focusInHero + '"]'); if (f) f.focus(); }
    } else {
      var bar = hero.querySelector('.bar i');
      var m2 = html.match(/<i style="width:([^"]*)"><\/i>/);
      if (bar && m2) bar.style.width = m2[1].replace('%', '') + '%';
    }
  }
  function loadHomeDrives() {
    api('GET', '/api/storage').then(function (drives) {
      $('#home-drives').innerHTML = drives.map(function (d) {
        var used = d.total - d.free;
        return '<button class="drive" data-nav data-goto="storage"><b>' + esc(d.label) + '</b><div class="free">' + fmtSize(d.free) + '</div><div class="small muted">livres de ' +
          fmtSize(d.total) + '</div><div class="bar' + (d.free / d.total < 0.1 ? ' err' : '') + '"><i style="width:' + pct(used, d.total) + '%"></i></div></button>';
      }).join('');
    }).catch(function () { });
  }

  /* ---------- adicionar ---------- */
  function renderAddDest() {
    if (!state.addDest && state.cfg) state.addDest = state.cfg.default_dest;
    $('#add-dest').textContent = state.addDest || '—';
  }
  $$('#add-mode button').forEach(function (b) {
    b.onclick = function () {
      $$('#add-mode button').forEach(function (x) { x.classList.toggle('active', x === b); });
      state.addMode = b.getAttribute('data-mode');
      $('#add-auto-wrap').classList.toggle('hidden', state.addMode !== 'torbox');
    };
  });
  $('#btn-add-dest').onclick = function () {
    pickFolder('Pasta de destino', state.addDest).then(function (r) { if (r) { state.addDest = r.path; renderAddDest(); } });
  };
  $('#btn-add').onclick = function () {
    var links = $('#add-links').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!links.length) { toast('Cole pelo menos um link', true); return; }
    var btn = $('#btn-add');
    btn.disabled = true;
    var out = $('#add-result');
    out.innerHTML = '';
    var extract = $('#add-extract').checked, delarc = $('#add-delarc').checked;
    var seq = Promise.resolve();
    links.forEach(function (link) {
      seq = seq.then(function () {
        var short = link.length > 90 ? link.slice(0, 87) + '…' : link;
        var p;
        if (state.addMode === 'direct' && link.indexOf('magnet:') !== 0) {
          p = api('POST', '/api/download', { url: link, dest: state.addDest, extract: extract, delete_archive: delarc }).then(function (r) {
            if (r.errors.length) throw new Error(r.errors[0]);
            return 'Na fila de download';
          });
        } else {
          p = api('POST', '/api/cloud/add', { link: link, auto_download: $('#add-auto').checked, dest: state.addDest, extract: extract, delete_archive: delarc })
            .then(function (r) {
              var msg = r.cached ? 'Já estava no cache do TorBox' : 'Adicionado ao TorBox';
              if (r.watching) msg += ' · vai baixar sozinho quando ficar pronto';
              if (r.watch_error) msg += ' · ' + r.watch_error;
              return msg;
            });
        }
        return p.then(function (msg) {
          out.insertAdjacentHTML('beforeend', '<div class="item"><div class="item-title">' + esc(short) + '</div><div class="item-sub"><span class="pill ok">' + esc(msg) + '</span></div></div>');
        }, function (e) {
          out.insertAdjacentHTML('beforeend', '<div class="item err"><div class="item-title">' + esc(short) + '</div><div class="item-sub"><span class="pill err">' + esc(e.message) + '</span></div></div>');
        });
      });
    });
    seq.then(function () { btn.disabled = false; $('#add-links').value = ''; state.cloud = []; refresh(); });
  };

  /* ---------- arquivos ---------- */
  function loadFiles() {
    api('GET', '/api/storage').then(function (drives) {
      state.drives = drives;
      if (!state.fsPath && drives.length) state.fsPath = drives[0].path;
      $('#drives').innerHTML = drives.map(function (d) {
        var used = d.total - d.free;
        return '<button class="drive' + (state.fsPath && state.fsPath.indexOf(d.path) === 0 ? ' active' : '') + '" data-nav data-drive="' + esc(d.path) + '"><b>' +
          esc(d.label) + '</b><div class="small muted">' + fmtSize(d.free) + ' livres de ' + fmtSize(d.total) + '</div><div class="bar' +
          (d.free / d.total < 0.1 ? ' err' : '') + '"><i style="width:' + pct(used, d.total) + '%"></i></div></button>';
      }).join('');
      $$('#drives [data-drive]').forEach(function (b) { b.onclick = function () { state.fsPath = b.getAttribute('data-drive'); loadFiles(); }; });
      return listDir();
    }).catch(fail);
  }

  var ICON = function (e) {
    if (e.dir) return icon('folder', 24);
    if (e.archive) return icon('archive', 24);
    if (/\.(mkv|mp4|avi|m4v|webm|mov)$/i.test(e.name)) return icon('video', 24);
    if (/\.(mp3|flac|m4a|ogg|wav)$/i.test(e.name)) return icon('music', 24);
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(e.name)) return icon('image', 24);
    if (/\.(pkg|iso|exfat|ffpkg)$/i.test(e.name)) return icon('disc', 24);
    return icon('file', 24);
  };

  function listDir() {
    return api('GET', '/api/fs?path=' + encodeURIComponent(state.fsPath)).then(function (ls) {
      state.fsPath = ls.path;
      state.fsParent = ls.parent;
      $('#fs-path').textContent = ls.path + ' · ' + fmtSize(ls.free) + ' livres';
      $('#btn-fs-up').disabled = !ls.parent;
      if (!ls.entries.length) { $('#fs-list').innerHTML = '<div class="empty">Pasta vazia</div>'; return; }
      $('#fs-list').innerHTML = ls.entries.map(function (e, i) {
        var meta = e.dir ? '' : fmtSize(e.size);
        return '<div class="fs-row" data-i="' + i + '"><span class="ico">' + ICON(e) + '</span><button class="name" data-nav data-f="open">' + esc(e.name) +
          '</button><span class="meta">' + meta + '</span>' + (e.archive === 'first' ? '<button class="btn sm" data-nav data-f="extract">Extrair</button>' : '') +
          '<button class="btn sm ghost" data-nav data-f="menu">Opções</button></div>';
      }).join('');
      state.fsEntries = ls.entries;
    }).catch(function (e) {
      $('#fs-list').innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
    });
  }

  function fileUrl(path, dl) { return '/api/fs/file?path=' + encodeURIComponent(path) + (dl ? '&dl=1' : ''); }

  function extractFile(e) {
    var cfg = state.cfg || {};
    openModal('Extrair', '<p>' + esc(e.name) + '</p><label class="check"><input type="checkbox" id="ex-del" data-nav' + (cfg.delete_after_extract ? ' checked' : '') +
      '> Apagar o compactado (e as outras partes) depois de extrair</label><div class="actions"><button class="btn primary" id="ex-ok" data-nav>Extrair aqui</button></div>');
    $('#ex-ok').onclick = function () {
      var del = $('#ex-del').checked;
      closeModal();
      api('POST', '/api/extract', { path: e.path, delete_archive: del }).then(function () { toast('Extração na fila (veja em Downloads)'); refresh(); }).catch(fail);
    };
  }

  function fileMenu(e) {
    var media = /\.(mp4|m4v|webm|mp3|m4a|jpg|jpeg|png|gif|webp|txt|nfo|srt)$/i.test(e.name);
    var html = '<p class="muted">' + esc(e.path) + '</p><div class="list">' +
      (e.archive === 'first' ? '<button class="btn" data-nav data-m="extract">Extrair</button>' : '') +
      (!e.dir && media ? '<a class="btn" data-nav href="' + fileUrl(e.path) + '" target="_blank">Abrir / assistir</a>' : '') +
      (!e.dir ? '<a class="btn" data-nav href="' + fileUrl(e.path, true) + '">Baixar para este aparelho</a>' : '') +
      '<button class="btn" data-nav data-m="copy">Copiar para…</button>' +
      '<button class="btn" data-nav data-m="move">Mover para…</button>' +
      '<button class="btn" data-nav data-m="rename">Renomear</button>' +
      '<button class="btn danger" data-nav data-m="delete">Apagar</button></div>';
    openModal(e.name, html);
    $$('[data-m]', $('#modal-body')).forEach(function (b) {
      b.onclick = function () {
        var m = b.getAttribute('data-m');
        closeModal();
        if (m === 'extract') extractFile(e);
        else if (m === 'copy' || m === 'move') {
          pickFolder(m === 'copy' ? 'Copiar para…' : 'Mover para…', state.fsPath, { okLabel: m === 'copy' ? 'Copiar aqui' : 'Mover aqui' }).then(function (r) {
            if (!r) return;
            api('POST', '/api/fs/' + m, { src: e.path, dest: r.path }).then(function () { toast((m === 'copy' ? 'Cópia' : 'Movimentação') + ' na fila (veja em Downloads)'); refresh(); setTimeout(listDir, 1500); }).catch(fail);
          });
        } else if (m === 'rename') {
          promptModal('Renomear', 'Novo nome', e.name).then(function (name) {
            if (!name || name === e.name) return;
            api('POST', '/api/fs/rename', { path: e.path, name: name }).then(listDir).catch(fail);
          });
        } else if (m === 'delete') {
          confirmModal('Apagar', 'Apagar "' + e.name + '"' + (e.dir ? ' e tudo dentro dela' : '') + '? Não dá para desfazer.', 'Apagar').then(function (ok) {
            if (ok) api('POST', '/api/fs/delete', { path: e.path }).then(function () { toast('Apagado'); listDir(); loadFiles(); }).catch(fail);
          });
        }
      };
    });
  }

  $('#fs-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-f]');
    if (!b) return;
    var e = state.fsEntries[+b.closest('.fs-row').getAttribute('data-i')];
    var f = b.getAttribute('data-f');
    if (f === 'open') {
      if (e.dir) { state.fsPath = e.path; listDir().then(function () { var x = $('#fs-list [data-nav]'); if (x) x.focus(); }); }
      else if (e.archive === 'first') extractFile(e);
      else fileMenu(e);
    } else if (f === 'extract') extractFile(e);
    else fileMenu(e);
  });
  $('#btn-fs-up').onclick = function () { if (state.fsParent) { state.fsPath = state.fsParent; listDir(); } };
  $('#btn-fs-refresh').onclick = loadFiles;
  $('#btn-fs-mkdir').onclick = function () {
    promptModal('Nova pasta', 'Nome da pasta', '').then(function (name) {
      if (name) api('POST', '/api/fs/mkdir', { path: state.fsPath, name: name }).then(listDir).catch(fail);
    });
  };

  /* ---------- armazenamento ---------- */
  var stTimer = null, stDir = null;
  function loadStorage() {
    api('GET', '/api/storage').then(function (drives) {
      $('#st-drives').innerHTML = drives.map(function (d) {
        var used = d.total - d.free;
        return '<div class="drive" style="cursor:default"><b>' + esc(d.label) + '</b><div class="small muted">' + fmtSize(used) + ' usados · ' + fmtSize(d.free) +
          ' livres de ' + fmtSize(d.total) + '</div><div class="bar' + (d.free / d.total < 0.1 ? ' err' : '') + '"><i style="width:' + pct(used, d.total) +
          '%"></i></div><div class="actions"><button class="btn sm primary" data-nav data-analyze="' + esc(d.path) + '">Analisar</button></div></div>';
      }).join('');
      $$('[data-analyze]').forEach(function (b) { b.onclick = function () { startAnalysis(b.getAttribute('data-analyze')); }; });
      return api('GET', '/api/analyze/status');
    }).then(function (s) { if (s && s.state !== 'idle') showAnalysis(s); }).catch(fail);
  }
  function startAnalysis(path) {
    api('POST', '/api/analyze', { path: path }).then(function (s) { stDir = null; showAnalysis(s); }).catch(fail);
  }
  $('#btn-st-again').onclick = function () { if (state.stPath) startAnalysis(state.stPath); };
  function showAnalysis(s) {
    clearInterval(stTimer);
    state.stPath = s.path;
    var prog = $('#st-progress');
    if (s.state === 'running') {
      prog.classList.remove('hidden');
      prog.innerHTML = '<h3>Analisando ' + esc(s.path) + '…</h3><div class="muted">' + s.files.toLocaleString('pt-BR') + ' arquivos · ' + fmtSize(s.bytes) +
        '</div><div class="bar"><i style="width:100%;opacity:.5"></i></div><div class="actions"><button class="btn ghost sm" data-nav id="st-cancel">Cancelar</button></div>';
      $('#st-cancel').onclick = function () { api('POST', '/api/analyze/cancel'); };
      stTimer = setInterval(function () {
        if (state.tab !== 'storage') return;
        api('GET', '/api/analyze/status').then(showAnalysis).catch(function () { });
      }, 1000);
      return;
    }
    prog.classList.add('hidden');
    if (s.state !== 'done' && s.state !== 'canceled') return;
    $('#st-result').classList.remove('hidden');
    $('#st-title').textContent = 'Uso por tipo em ' + s.path + ' · ' + fmtSize(s.bytes) + ' em ' + s.files.toLocaleString('pt-BR') + ' arquivos' +
      (s.state === 'canceled' ? ' (análise interrompida)' : '');
    var cats = s.categories.slice().sort(function (a, b) { return b.bytes - a.bytes; });
    $('#st-catbar').innerHTML = cats.map(function (c) { return '<i class="c-' + c.key + '" style="width:' + pct(c.bytes, s.bytes) + '%" title="' + esc(c.label) + '"></i>'; }).join('');
    $('#st-legend').innerHTML = cats.map(function (c) { return '<span><b class="c-' + c.key + '"></b>' + esc(c.label) + ' · ' + fmtSize(c.bytes) + '</span>'; }).join('');
    var groups = {}, order = [];
    s.suggestions.forEach(function (x) {
      var key = x.path.replace(/\.part\d+\.rar$/i, '.rar').replace(/\.(r\d\d|\d{3})$/i, '') + '|' + x.reason;
      if (!groups[key]) { groups[key] = { name: x.name, path: x.path, paths: [], size: 0, reason: x.reason }; order.push(key); }
      groups[key].paths.push(x.path); groups[key].size += x.size;
    });
    var sug = order.map(function (k) {
      var g = groups[k];
      if (g.paths.length > 1) g.name = g.name.replace(/\.part\d+\.rar$/i, '').replace(/\.(r\d\d|\d{3})$/i, '') + ' (' + g.paths.length + ' partes)';
      return g;
    });
    $('#st-sug-card').classList.toggle('hidden', !sug.length);
    var sugTotal = sug.reduce(function (a, x) { return a + x.size; }, 0);
    $('#st-sug').innerHTML = (sug.length ? '<div class="muted small">Dá para liberar até <b>' + fmtSize(sugTotal) + '</b>.</div>' : '') + sug.map(function (x) {
      return '<div class="srow"><div class="grow"><div class="nm">' + esc(x.name) + '</div><div class="small muted">' + esc(x.reason) + '</div><div class="small muted">' +
        esc(x.path.substring(0, x.path.lastIndexOf('/'))) + '</div></div><span class="sz">' + fmtSize(x.size) + '</span><button class="btn sm danger" data-nav data-del="' +
        esc(x.paths.join('\n')) + '">Apagar</button></div>';
    }).join('');
    $('#st-top').innerHTML = s.top_files.slice(0, 25).map(function (f) {
      return '<div class="srow"><div class="grow"><div class="nm">' + esc(f.name) + '</div><div class="small muted">' + esc(f.path) + '</div><div class="bar"><i style="width:' +
        pct(f.size, s.top_files[0].size) + '%"></i></div></div><span class="sz">' + fmtSize(f.size) + '</span><button class="btn sm ghost" data-nav data-open="' +
        esc(f.path) + '">Pasta</button><button class="btn sm danger" data-nav data-del="' + esc(f.path) + '">Apagar</button></div>';
    }).join('') || '<div class="empty">Nenhum arquivo.</div>';
    bindDeletes($('#st-result'));
    showDir(stDir || s.path);
  }
  function bindDeletes(root) {
    $$('[data-del]', root).forEach(function (b) {
      b.onclick = function () {
        var paths = b.getAttribute('data-del').split('\n');
        var label = paths.length > 1 ? paths.length + ' arquivos' : '"' + paths[0].split('/').pop() + '"';
        confirmModal('Apagar', 'Apagar ' + label + '? Não dá para desfazer.', 'Apagar').then(function (ok) {
          if (!ok) return;
          Promise.all(paths.map(function (p) { return api('POST', '/api/fs/delete', { path: p }); })).then(function () {
            toast('Apagado');
            api('GET', '/api/analyze/status').then(showAnalysis);
            loadStorageDrivesOnly();
          }).catch(fail);
        });
      };
    });
  }
  function loadStorageDrivesOnly() {
    api('GET', '/api/storage').then(function (drives) {
      drives.forEach(function (d) {
        var b = $('[data-analyze="' + d.path + '"]');
        if (!b) return;
        var card = b.closest('.drive'), used = d.total - d.free;
        card.querySelector('.small').textContent = fmtSize(used) + ' usados · ' + fmtSize(d.free) + ' livres de ' + fmtSize(d.total);
        card.querySelector('.bar i').style.width = pct(used, d.total) + '%';
      });
    });
  }
  function showDir(path) {
    api('GET', '/api/analyze/dir?path=' + encodeURIComponent(path)).then(function (d) {
      stDir = d.path;
      var rel = d.path.substring(d.root.length).split('/').filter(Boolean);
      var crumbs = '<button class="btn sm ghost" data-nav data-dir="' + esc(d.root) + '">' + esc(d.root) + '</button>';
      var acc = d.root;
      rel.forEach(function (part) { acc += '/' + part; crumbs += '<button class="btn sm ghost" data-nav data-dir="' + esc(acc) + '">' + esc(part) + '</button>'; });
      $('#st-crumbs').innerHTML = crumbs;
      var max = Math.max(d.dirs.length ? d.dirs[0].size : 0, d.files.length ? d.files[0].size : 0, 1);
      var rows = d.dirs.map(function (x) {
        return '<div class="srow"><span class="ico">' + icon('folder', 24) + '</span><div class="grow"><button class="nm" data-nav data-dir="' + esc(x.path) + '">' + esc(x.name) + '</button><div class="small muted">' +
          x.files.toLocaleString('pt-BR') + ' arquivos · ' + pct(x.size, d.size).toFixed(1) + '% desta pasta</div><div class="bar"><i style="width:' + pct(x.size, max) +
          '%"></i></div></div><span class="sz">' + fmtSize(x.size) + '</span></div>';
      }).concat(d.files.map(function (f) {
        return '<div class="srow"><span class="ico">' + icon('file', 24) + '</span><div class="grow"><div class="nm">' + esc(f.name) + '</div><div class="bar"><i style="width:' + pct(f.size, max) +
          '%"></i></div></div><span class="sz">' + fmtSize(f.size) + '</span><button class="btn sm danger" data-nav data-del="' + esc(f.path) + '">Apagar</button></div>';
      }));
      $('#st-dirs').innerHTML = rows.join('') || '<div class="empty">Pasta vazia.</div>';
      $$('[data-dir]', $('#st-result')).forEach(function (b) { b.onclick = function () { showDir(b.getAttribute('data-dir')); }; });
      bindDeletes($('#st-dirs'));
    }).catch(function (e) { $('#st-dirs').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  $('#btn-apps').onclick = function () {
    $('#st-apps').innerHTML = '<div class="empty">Calculando… (pode levar alguns segundos)</div>';
    api('GET', '/api/apps').then(function (apps) {
      if (!apps.length) { $('#st-apps').innerHTML = '<div class="empty">Nenhum jogo/app encontrado.</div>'; return; }
      var total = apps.reduce(function (a, x) { return a + x.size; }, 0);
      $('#st-apps').innerHTML = '<div class="muted small">' + apps.length + ' itens · ' + fmtSize(total) + ' no total</div>' + apps.map(function (a) {
        var parts = [fmtSize(a.app) + ' jogo'];
        if (a.patch) parts.push(fmtSize(a.patch) + ' atualização');
        if (a.dlc) parts.push(fmtSize(a.dlc) + ' DLC');
        return '<div class="srow"><img src="/api/apps/icon?id=' + encodeURIComponent(a.id) + '" alt="" onerror="this.style.visibility=\'hidden\'"><div class="grow"><div class="nm">' +
          esc(a.title) + '</div><div class="small muted">' + esc(a.platform + ' · ' + a.id + ' · ' + parts.join(' + ')) + '</div><div class="bar"><i style="width:' +
          pct(a.size, apps[0].size) + '%"></i></div></div><span class="sz">' + fmtSize(a.size) + '</span></div>';
      }).join('');
    }).catch(fail);
  };

  /* ---------- ajustes ---------- */
  function loadConfig() {
    return api('GET', '/api/config').then(function (c) { state.cfg = c; renderAddDest(); applyAddDefaults(); return c; });
  }
  var addDefaultsApplied = false;
  function applyAddDefaults() {
    if (addDefaultsApplied || !state.cfg) return;
    addDefaultsApplied = true;
    $('#add-extract').checked = !!state.cfg.auto_extract;
    $('#add-delarc').checked = !!state.cfg.delete_after_extract;
  }
  function opts(sel, from, to, val) {
    var h = '';
    for (var i = from; i <= to; i++) h += '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + i + '</option>';
    $(sel).innerHTML = h;
  }
  function renderPw() {
    var pws = state.cfg.passwords || [];
    $('#pw-list').innerHTML = pws.length ? pws.map(function (p, i) {
      return '<div class="row" style="margin:6px 0"><code style="flex:1;padding:10px 12px;background:var(--bg2);border-radius:10px">' + esc(p) +
        '</code><button class="btn sm ghost" data-nav data-pw="' + i + '">Remover</button></div>';
    }).join('') : '<div class="empty">Nenhuma senha cadastrada.</div>';
    $$('[data-pw]').forEach(function (b) {
      b.onclick = function () {
        var list = state.cfg.passwords.slice();
        list.splice(+b.getAttribute('data-pw'), 1);
        save({ passwords: list });
      };
    });
  }
  function loadSettings() {
    loadConfig().then(function (c) {
      $('#cfg-key').value = '';
      $('#cfg-key').placeholder = c.has_key ? ('Chave salva (' + c.api_key + ')') : 'Cole sua chave do TorBox';
      $('#cfg-dest').textContent = c.default_dest;
      opts('#cfg-parallel', 1, 5, c.max_parallel);
      opts('#cfg-conns', 1, 8, c.connections);
      $('#cfg-limit').value = c.speed_limit_kbps;
      $('#cfg-limit-on').checked = c.speed_limit_on;
      $('#cfg-nosleep').checked = c.prevent_sleep;
      $('#cfg-delcloud').checked = c.delete_from_cloud;
      $('#cfg-extract').checked = c.auto_extract;
      $('#cfg-delarc').checked = c.delete_after_extract;
      $('#cfg-subfolder').checked = c.extract_to_subfolder;
      $('#cfg-openbrowser').checked = c.open_browser;
      renderPw();
      var st = state.status || {};
      $('#about').textContent = 'Nimbo PS5 ' + (st.version || '') + ' · http://' + (st.ip || location.hostname) + ':' + (st.port || location.port);
    }).catch(fail);
  }
  function save(patch, msg) {
    return api('POST', '/api/config', patch).then(function (c) {
      state.cfg = c; toast(msg || 'Salvo'); renderPw(); $('#cfg-dest').textContent = c.default_dest; renderAddDest();
      return c;
    }).catch(fail);
  }
  var bindings = [
    ['#cfg-parallel', 'max_parallel', 'num'], ['#cfg-conns', 'connections', 'num'], ['#cfg-limit', 'speed_limit_kbps', 'num'],
    ['#cfg-limit-on', 'speed_limit_on', 'bool'], ['#cfg-nosleep', 'prevent_sleep', 'bool'], ['#cfg-delcloud', 'delete_from_cloud', 'bool'],
    ['#cfg-extract', 'auto_extract', 'bool'], ['#cfg-delarc', 'delete_after_extract', 'bool'], ['#cfg-subfolder', 'extract_to_subfolder', 'bool'],
    ['#cfg-openbrowser', 'open_browser', 'bool']
  ];
  bindings.forEach(function (bd) {
    $(bd[0]).addEventListener('change', function (e) {
      var p = {};
      p[bd[1]] = bd[2] === 'bool' ? e.target.checked : parseInt(e.target.value, 10);
      save(p);
    });
  });
  $('#btn-cfg-key').onclick = function () {
    var k = $('#cfg-key').value.trim();
    if (!k) { toast('Cole a chave primeiro', true); return; }
    save({ api_key: k }, 'Chave salva').then(function () { $('#cfg-key').value = ''; loadSettings(); checkAccount(); state.cloud = []; refresh(); });
  };
  function checkAccount() {
    $('#account-info').textContent = 'Verificando…';
    api('GET', '/api/account').then(function (a) {
      $('#account-info').textContent = 'Conectado: ' + a.email + ' · plano ' + a.plan;
    }).catch(function (e) { $('#account-info').textContent = e.message; });
  }
  $('#btn-account').onclick = checkAccount;
  $('#btn-cfg-dest').onclick = function () {
    pickFolder('Pasta padrão de downloads', state.cfg.default_dest).then(function (r) { if (r) save({ default_dest: r.path }); });
  };
  $('#btn-pw-add').onclick = function () {
    var v = $('#pw-new').value;
    if (!v) return;
    var list = (state.cfg.passwords || []).slice();
    if (list.indexOf(v) < 0) list.push(v);
    save({ passwords: list }, 'Senha adicionada').then(function () { $('#pw-new').value = ''; });
  };
  $('#btn-tile-media').onclick = function () { api('POST', '/api/tile', { media: true }).then(function () { toast('Atalho reinstalado na aba Mídia'); }).catch(fail); };
  $('#btn-tile-games').onclick = function () { api('POST', '/api/tile', { media: false }).then(function () { toast('Atalho reinstalado na aba Jogos'); }).catch(fail); };
  $('#btn-quit').onclick = function () {
    confirmModal('Encerrar o Nimbo', 'Os downloads em andamento serão pausados e retomados quando você abrir o Nimbo de novo.', 'Encerrar').then(function (ok) {
      if (ok) api('POST', '/api/quit').then(function () {
        document.body.innerHTML = '<div style="padding:40px;text-align:center"><h2>Nimbo encerrado</h2><p class="muted">Abra de novo pelo ícone ou pelo Payload Manager.</p></div>';
      }).catch(fail);
    });
  };

  /* ---------- navegação pelo direcional do controle ---------- */
  function visible(el) {
    if (el.disabled) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest('.hidden') && !(el.closest('.panel') && !el.closest('.panel.active'));
  }
  function navTargets() {
    var modalOpen = !$('#modal').classList.contains('hidden');
    var root = modalOpen ? $('#modal') : document;
    return $$('[data-nav], a.btn', root).filter(visible);
  }
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    var dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (k === 'Escape') {
      if (!$('#modal').classList.contains('hidden')) { e.preventDefault(); closeModal(); }
      return;
    }
    if (!dirs[k]) return;
    var ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox' && (k === 'ArrowLeft' || k === 'ArrowRight' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    var els = navTargets();
    if (!els.length) return;
    if (!ae || els.indexOf(ae) < 0) { e.preventDefault(); els[0].focus(); return; }
    var d = dirs[k];
    var r0 = ae.getBoundingClientRect();
    var cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    var best = null, bestScore = Infinity;
    els.forEach(function (el) {
      if (el === ae) return;
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var dx = x - cx, dy = y - cy;
      var along = dx * d[0] + dy * d[1];
      if (along <= 4) return;
      var across = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
      var score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) {
      e.preventDefault();
      best.focus();
      if (best.scrollIntoView) best.scrollIntoView({ block: 'nearest' });
    }
  });

  /* ---------- controle: botões ✕ ○ △, L1/R1 e relógio ---------- */
  var TAB_ORDER = ['home', 'cloud', 'downloads', 'add', 'files', 'storage', 'settings'];
  function switchTab(dir) {
    if (!$('#modal').classList.contains('hidden')) return;
    var i = TAB_ORDER.indexOf(state.tab);
    var n = TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length];
    showTab(n);
    var t = $('.tab[data-tab="' + n + '"]'); if (t) t.focus();
  }
  function goBack() {
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return; }
    if (state.tab === 'files' && state.fsParent) { state.fsPath = state.fsParent; listDir(); return; }
    if (state.tab !== 'home') { showTab('home'); var t = $('.tab[data-tab="home"]'); if (t) t.focus(); }
  }
  function optionsFor(el) {
    if (!el) return;
    if (el.hasAttribute && el.hasAttribute('data-tile')) { var it = findTile(el.getAttribute('data-tile')); if (it) openItem(it); return; }
    var row = el.closest ? el.closest('.fs-row') : null;
    if (row) { fileMenu(state.fsEntries[+row.getAttribute('data-i')]); }
  }
  document.addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
    if (e.key === 'PageUp' || e.key === 'q') { e.preventDefault(); switchTab(-1); }
    else if (e.key === 'PageDown' || e.key === 'e') { e.preventDefault(); switchTab(1); }
    else if (e.key === 'Backspace') { e.preventDefault(); goBack(); }
    else if (e.key === 'o' || e.key === 'ContextMenu') { e.preventDefault(); optionsFor(document.activeElement); }
  });
  /* Gamepad API (se o navegador expuser o DualSense) */
  var padPrev = {};
  function pollPad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) {
      var gp = pads[i];
      if (!gp) continue;
      var map = { 0: 'Enter', 1: 'back', 3: 'options', 4: 'l1', 5: 'r1', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
      Object.keys(map).forEach(function (k) {
        var pressed = gp.buttons[k] && gp.buttons[k].pressed;
        var key = i + ':' + k;
        if (pressed && !padPrev[key]) {
          var a = map[k];
          if (a === 'back') goBack();
          else if (a === 'options') optionsFor(document.activeElement);
          else if (a === 'l1') switchTab(-1);
          else if (a === 'r1') switchTab(1);
          else if (a === 'Enter') { if (document.activeElement && document.activeElement.click) document.activeElement.click(); }
          else document.dispatchEvent(new KeyboardEvent('keydown', { key: a, bubbles: true }));
        }
        padPrev[key] = pressed;
      });
    }
    requestAnimationFrame(pollPad);
  }
  if (navigator.getGamepads) requestAnimationFrame(pollPad);
  function tickClock() {
    var d = new Date();
    $('#clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  tickClock(); setInterval(tickClock, 15000);

  /* ---------- início ---------- */
  loadConfig().catch(function () { });
  refresh().then(function () {
    var t = 'home';
    try { t = localStorage.getItem('nimbo.tab') || 'home'; } catch (e) { }
    showTab(state.status && !state.status.has_key ? 'home' : t);
    var f = $('.tab.active'); if (f) f.focus();
  });
})();
