// Página do celular: servidor local com PIN de 6 dígitos (LocalServer do PS5 React).
import {LocalServer} from '@ps5-react/core';
import {config, queue, ui, toast} from './store.js';
import {enqueueTorbox, enqueueDirect, jobAction, watchItem} from './engine.js';
import * as torbox from './torbox.js';

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nimbo Downloader</title><style>
:root{--n:#0f1b2d;--h:#172741;--h2:#213656;--r:#2d4568;--c:#f2f5f9;--m:#93a7c3;--s:#ffc857;--k:#63b3ed;--o:#57d9a3;--b:#ff7a7a}
*{box-sizing:border-box}body{margin:0;background:var(--n);color:var(--c);font:16px/1.4 system-ui,-apple-system,Roboto,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#16224a}header b{font-size:20px}
nav{display:flex;gap:6px;padding:10px 12px;background:var(--h);position:sticky;top:0}nav button{flex:1;border:0;border-radius:999px;padding:10px;background:transparent;color:var(--m);font:inherit;font-weight:700}
nav button.on{background:var(--h2);color:var(--c)}main{padding:12px}.card{background:var(--h);border-radius:16px;padding:14px;margin-bottom:10px}
.t{font-weight:700;word-break:break-word}.s{color:var(--m);font-size:13px;margin-top:4px}.bar{height:8px;background:#0b1020;border-radius:9px;overflow:hidden;margin-top:10px}
.bar i{display:block;height:100%;background:var(--s)}.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.btn{border:0;border-radius:999px;padding:10px 16px;font:inherit;font-weight:700;background:var(--h2);color:var(--c)}.btn.p{background:var(--s);color:#2b1d00}
textarea,input{width:100%;font:inherit;color:var(--c);background:#0b1020;border:1px solid var(--r);border-radius:12px;padding:12px}
label{display:flex;gap:10px;align-items:center;margin:10px 0}label input{width:22px;height:22px}.pill{font-size:12px;font-weight:800;padding:2px 9px;border-radius:9px;background:var(--h2);color:var(--m)}
.ok{color:var(--o)}.err{color:var(--b)}#pin{max-width:320px;margin:60px auto;text-align:center}#pin input{font-size:28px;text-align:center;letter-spacing:.3em}
</style></head><body><header><b>Nimbo Downloader</b><span class="s" id="speed"></span></header>
<div id="pin"><p>Digite o PIN que aparece no PS5<br><span class="s">Nimbo › Painel › Usar pelo celular</span></p><input id="code" inputmode="numeric" maxlength="6"><div class="row" style="justify-content:center"><button class="btn p" id="go">Entrar</button></div><p class="err" id="perr"></p></div>
<div id="app" hidden><nav><button data-v="q" class="on">Fila</button><button data-v="a">Adicionar</button><button data-v="c">Nuvem</button></nav><main id="v"></main></div>
<script>
var H={'X-JBH':'1','Content-Type':'application/json'},view='q',st=null,cloud=null;
function $(s){return document.querySelector(s)}function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function f(b){if(!(b>=0))return'?';var u=['B','KB','MB','GB','TB'],i=0;while(b>=1024&&i<4){b/=1024;i++}return(i?b.toFixed(b>=100?0:1):b)+' '+u[i]}
function api(m,p,b){return fetch('/api/'+p,{method:m,headers:H,body:b?JSON.stringify(b):undefined}).then(function(r){if(r.status==401){show(false);throw new Error('PIN')}return r.json()})}
function show(ok){$('#pin').hidden=ok;$('#app').hidden=!ok;if(ok)tick()}
$('#go').onclick=function(){fetch('/auth',{method:'POST',headers:{'X-JBH':'1','Content-Type':'application/json'},body:JSON.stringify({pin:$('#code').value})}).then(function(r){if(r.ok)show(true);else $('#perr').textContent=r.status==429?'Muitas tentativas, espere um pouco':'PIN incorreto'})};
document.querySelectorAll('nav button').forEach(function(b){b.onclick=function(){view=b.dataset.v;document.querySelectorAll('nav button').forEach(function(x){x.className=x==b?'on':''});render();if(view=='c')loadCloud()}});
var L={queued:'Na fila',downloading:'Baixando',paused:'Pausado',done:'Concluído',error:'Erro'};
function render(){var v=$('#v');if(view=='q'){if(!st){v.innerHTML='';return}var h='';st.jobs.forEach(function(j){var p=j.size?j.written/j.size*100:0;h+='<div class="card"><div class="t">'+e(j.name)+'</div><div class="s">'+L[j.state]+' · '+f(j.written)+' de '+f(j.size)+(j.error?' · <span class="err">'+e(j.error)+'</span>':'')+'</div><div class="bar"><i style="width:'+(j.state=='done'?100:p)+'%"></i></div><div class="row">'+
(j.state=='downloading'||j.state=='queued'?'<button class="btn" onclick="act('+j.id+',\\'pause\\')">Pausar</button>':'')+(j.state=='paused'||j.state=='error'?'<button class="btn" onclick="act('+j.id+',\\'resume\\')">Retomar</button>':'')+'</div></div>'});
st.tasks.forEach(function(t){h+='<div class="card"><div class="t">'+(t.type=='extract'?'Extrair: ':'Copiar: ')+e(t.name)+'</div><div class="s">'+e(t.error||t.state)+'</div></div>'});v.innerHTML=h||'<p class="s">Nada na fila. Use Adicionar ou Nuvem.</p>'}
else if(view=='a'){v.innerHTML='<div class="card"><textarea id="links" rows="5" placeholder="magnet:?xt=… ou https://… (um por linha)"></textarea><label><input type="checkbox" id="direct"> Download direto (sem TorBox)</label><label><input type="checkbox" id="auto" checked> Baixar no PS5 quando ficar pronto</label><div class="row"><button class="btn p" id="add">Adicionar</button></div><div id="res"></div></div>';
$('#add').onclick=function(){var ls=$('#links').value.split(/\\n+/).map(function(s){return s.trim()}).filter(Boolean);ls.forEach(function(l){api('POST','add',{link:l,direct:$('#direct').checked,auto:$('#auto').checked}).then(function(r){$('#res').insertAdjacentHTML('beforeend','<p class="'+(r.error?'err':'ok')+'">'+e(r.error||r.message)+'</p>')})});$('#links').value=''}}
else{if(!cloud){v.innerHTML='<p class="s">Carregando…</p>';return}v.innerHTML=cloud.map(function(it,i){return'<div class="card"><div class="t">'+e(it.name)+'</div><div class="s">'+f(it.size)+' · '+it.files.length+' arquivo(s) · '+(it.ready?'<span class="ok">Pronto</span>':'No TorBox '+Math.round(it.progress*100)+'%')+'</div><div class="row"><button class="btn p" onclick="dl('+i+')">'+(it.ready?'Baixar no PS5':'Baixar quando ficar pronto')+'</button></div></div>'}).join('')||'<p class="s">Nuvem vazia.</p>'}}
function act(id,a){api('POST','job',{id:id,action:a}).then(tick)}
function dl(i){var it=cloud[i];api('POST','download',{kind:it.kind,id:it.id}).then(function(r){alert(r.error||r.message);tick()})}
function loadCloud(){api('GET','cloud').then(function(c){cloud=c;render()})}
function tick(){api('GET','state').then(function(s){st=s;$('#speed').textContent=s.speed>0?f(s.speed)+'/s':'';if(view=='q')render()}).catch(function(){})}
setInterval(function(){if(!$('#app').hidden)tick()},2000);api('GET','state').then(function(s){st=s;show(true)}).catch(function(){});
</script></body></html>`;

let started = false;

export function phoneInfo() {
  const s = LocalServer.status ? LocalServer.status() : {};
  return {pin: config.get().phonePin, port: s.port || 0, address: s.address || '', state: s.state || 'stopped'};
}

export function startPhone() {
  if (started) return;
  let {phonePin, phoneSession} = config.get();
  if (!phonePin) {
    phonePin = String(100000 + Math.floor(Math.random() * 900000));
    phoneSession = LocalServer.token();
    config.set({phonePin, phoneSession});
  }
  try {
    LocalServer.start({ports: [8090, 8091, 0], pin: phonePin, session: phoneSession, page: PAGE});
    started = true;
  } catch (_) { return; }
  setInterval(serve, 120);
}

function reply(id, obj, status = 200) { LocalServer.respond(id, status, 'application/json', JSON.stringify(obj)); }

function serve() {
  for (const r of LocalServer.poll()) {
    let body = {};
    try { body = r.body ? JSON.parse(r.body) : {}; } catch (_) { /* corpo inválido */ }
    const path = r.path.replace(/^\/api\//, '');
    try {
      if (r.method === 'GET' && path === 'state') {
        const q = queue.get();
        reply(r.id, {jobs: q.jobs.filter(j => j.state !== 'done').concat(q.jobs.filter(j => j.state === 'done').slice(-5)),
          tasks: q.tasks.slice(-6), speed: ui.get().speed, watches: q.watches.length});
      } else if (r.method === 'GET' && path === 'cloud') {
        reply(r.id, ui.get().cloud || []);
      } else if (r.method === 'POST' && path === 'job' && ['pause', 'resume'].includes(body.action)) {
        jobAction(Number(body.id), body.action);
        reply(r.id, {ok: true});
      } else if (r.method === 'POST' && path === 'download') {
        const item = (ui.get().cloud || []).find(i => i.kind === body.kind && i.id === body.id);
        if (!item) { reply(r.id, {error: 'Item não encontrado'}); continue; }
        const c = config.get();
        if (item.ready) {
          const n = enqueueTorbox(item, item.files, c.defaultDest, {extract: c.autoExtract, deleteArchive: c.deleteArchive});
          toast(`Celular: ${n} arquivo(s) na fila`, 'ok');
          reply(r.id, {message: n ? `${n} arquivo(s) na fila do PS5` : 'Já está na fila'});
        } else {
          watchItem(item.kind, item.id, item.name, c.defaultDest, {extract: c.autoExtract, deleteArchive: c.deleteArchive});
          reply(r.id, {message: 'Vai baixar assim que ficar pronto no TorBox'});
        }
      } else if (r.method === 'POST' && path === 'add' && typeof body.link === 'string') {
        const c = config.get();
        const link = body.link.trim().slice(0, 4000);
        if (body.direct && /^https?:\/\//i.test(link)) {
          enqueueDirect(link, c.defaultDest, {extract: c.autoExtract, deleteArchive: c.deleteArchive});
          toast('Celular: link direto na fila', 'ok');
          reply(r.id, {message: 'Na fila do PS5'});
          continue;
        }
        const id = r.id;
        let answered = false;
        const once = (obj) => { if (!answered) { answered = true; reply(id, obj); } };
        setTimeout(() => once({message: 'Enviando ao TorBox… confira a fila em instantes'}), 4000);
        torbox.add(link).then(res => {
          if (body.auto && res.id) watchItem(res.kind, res.id, link.slice(0, 60), c.defaultDest, {extract: c.autoExtract, deleteArchive: c.deleteArchive});
          toast('Celular: link adicionado ao TorBox', 'ok');
          once({message: res.cached ? 'Já estava no cache do TorBox' + (body.auto ? ', baixando no PS5' : '') :
            'Adicionado ao TorBox' + (body.auto ? '; baixa no PS5 quando ficar pronto' : '')});
        }, e => { once({error: e.message}); toast(`Celular: ${e.message}`, 'bad'); });
      } else {
        reply(r.id, {error: 'rota desconhecida'}, 404);
      }
    } catch (e) {
      reply(r.id, {error: String(e.message || e)}, 500);
    }
  }
}
