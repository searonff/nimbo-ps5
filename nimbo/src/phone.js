// Página do celular: servidor local com PIN de 6 dígitos (LocalServer do PS5 React).
import {LocalServer} from '@ps5-react/core';
import {config, queue, ui, toast} from './store.js';
import {enqueueTorbox, enqueueDirect, jobAction, watchItem} from './engine.js';
import {PROVIDERS, provider, linkedProviders} from './debrid/index.js';
import {t} from './i18n.js';

// Visual aprovado no esboço da 2.2.8: abas embaixo (alcance do polegar), item ativo em destaque,
// serviço escolhido em botões, alvos de toque de 48 px. Mesma API de antes.
const PAGE_SRC = `<!doctype html><html lang="⟦pt-BR⟧"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Nimbo</title><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800&display=swap" rel="stylesheet"><style>
:root{--n:#0f1b2d;--h:#172741;--h2:#213656;--r:#2d4568;--c:#f2f5f9;--m:#93a7c3;--s:#ffc857;--k:#63b3ed;--o:#57d9a3;--b:#ff7a7a;--d:#0b1424}
*{box-sizing:border-box}html,body{margin:0;background:var(--n);color:var(--c);font:16px/1.4 Nunito,system-ui,-apple-system,Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
button,input,textarea{font:inherit;color:inherit}
header{display:flex;align-items:center;gap:10px;padding:18px 20px 10px}header b{font-size:22px;font-weight:800;flex:1}
.st{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:var(--m)}.st i{width:9px;height:9px;border-radius:50%;background:var(--o)}.st.off i{background:var(--b)}
main{padding:4px 16px calc(110px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;max-width:640px;margin:0 auto}
h1{margin:4px 4px 0;font-size:28px;font-weight:800}h2{margin:10px 4px 0;font-size:17px;font-weight:800;color:var(--m)}
.sum{margin:0 4px 2px;font-weight:700;font-size:15px;color:var(--m)}
.card{background:var(--h);border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:10px}
.top{display:flex;align-items:baseline;gap:10px}.t{flex:1;min-width:0;font-weight:800;font-size:17px;line-height:1.25;overflow-wrap:anywhere}
.pc{font-weight:800;font-size:20px;color:var(--s)}.pc.k{color:var(--k)}.pc.b{color:var(--b)}.pc.m{color:var(--m);font-size:15px}.pc.g{color:var(--o);font-size:15px}
.s{margin:0;font-weight:700;font-size:14px;color:var(--m)}.bar{height:10px;border-radius:9px;background:var(--d);overflow:hidden}.bar i{display:block;height:100%;border-radius:9px;background:var(--s)}.bar.k i{background:var(--k)}
.row{display:flex;gap:8px;flex-wrap:wrap}.row:empty{display:none}.row>.btn{flex:1}
.btn{min-height:48px;border:0;border-radius:999px;padding:0 20px;font-weight:800;font-size:16px;background:var(--h2);color:var(--c)}
.btn.p{background:var(--s);color:#2b1d00}.btn.o{background:transparent;border:2px solid var(--r)}.btn.big{min-height:56px;font-size:18px;width:100%}
.list{background:var(--h);border-radius:20px;display:flex;flex-direction:column}.li{display:flex;align-items:center;gap:12px;padding:14px 16px;border-top:1px solid var(--h2)}.li:first-child{border-top:0}
.li span:first-child{flex:1;min-width:0;font-weight:700;overflow-wrap:anywhere}.li span+span{font-weight:700;font-size:14px;color:var(--m);white-space:nowrap}.li span.ok{color:var(--o)}
label.lb{margin:6px 4px 0;font-weight:700;font-size:15px;color:var(--m)}
textarea,input[type=text],input[inputmode]{width:100%;background:var(--d);border:2px solid var(--r);border-radius:16px;padding:14px;font-size:16px}textarea{min-height:150px;resize:vertical}
textarea:focus,input:focus{outline:none;border-color:var(--s)}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{min-height:44px;padding:0 18px;border-radius:999px;border:2px solid transparent;background:var(--h);color:var(--m);font-weight:800;font-size:15px}.chip.on{border-color:var(--s);background:var(--h2);color:var(--c)}
.chk{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 14px;border-radius:14px;background:var(--h);font-weight:700}.chk input{width:24px;height:24px;accent-color:var(--s);margin:0}
.ok{color:var(--o)}.err{color:var(--b)}.msg{margin:0 4px;font-weight:700}
.pill{align-self:flex-start;font-size:13px;font-weight:800;padding:3px 12px;border-radius:999px;background:rgba(87,217,163,.16);color:var(--o)}.pill.w{background:rgba(255,200,87,.16);color:var(--s)}
nav{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:10px 12px calc(12px + env(safe-area-inset-bottom));background:var(--h);border-top:1px solid var(--h2)}
nav button{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;border:0;border-radius:14px;background:transparent;color:var(--m);font-weight:800;font-size:13px}nav button.on{background:var(--h2);color:var(--s)}
nav svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#pin{max-width:340px;margin:12vh auto 0;padding:0 20px;display:flex;flex-direction:column;gap:14px;text-align:center}#pin h1{margin:0;font-size:24px}#pin input{font-size:32px;text-align:center;letter-spacing:.35em;font-weight:800}
</style></head><body><header><b>Nimbo</b><span class="st" id="conn"><i></i><span id="speed">⟦PS5 conectado⟧</span></span></header>
<div id="pin"><h1>⟦Digite o PIN que aparece no PS5⟧</h1><p class="s">Nimbo › ⟦Painel⟧ › ⟦Usar pelo celular⟧</p><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button class="btn p big" id="go">⟦Entrar⟧</button><p class="err msg" id="perr"></p></div>
<div id="app" hidden><main id="v"></main><nav>
<button data-v="q" class="on"><svg viewBox="0 0 24 24"><path d="M12 4V15M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>⟦Fila⟧</button>
<button data-v="a"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>⟦Adicionar⟧</button>
<button data-v="c"><svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 7 18z"/></svg>⟦Nuvem⟧</button>
<button data-v="k"><svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.5"/><path d="M5.5 19c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/></svg>⟦Contas⟧</button></nav></div>
<script>
var H={'X-JBH':'1','Content-Type':'application/json'},view='q',st=null,cloud=null,svcs=[],svc='';
function $(s){return document.querySelector(s)}function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function f(b){if(!(b>=0))return'?';var u=['B','KB','MB','GB','TB'],i=0;while(b>=1024&&i<4){b/=1024;i++}return(i?b.toFixed(b>=100?0:1):b)+' '+u[i]}
function api(m,p,b){return fetch('/api/'+p,{method:m,headers:H,body:b?JSON.stringify(b):undefined}).then(function(r){if(r.status==401){show(false);throw new Error('PIN')}return r.json()})}
function show(ok){$('#pin').hidden=ok;$('#app').hidden=!ok;if(ok)tick()}
$('#go').onclick=function(){fetch('/auth',{method:'POST',headers:{'X-JBH':'1','Content-Type':'application/json'},body:JSON.stringify({pin:$('#code').value})}).then(function(r){if(r.ok)show(true);else $('#perr').textContent=r.status==429?'⟦Muitas tentativas, espere um pouco⟧':'⟦PIN incorreto⟧'})};
document.querySelectorAll('nav button').forEach(function(b){b.onclick=function(){view=b.dataset.v;document.querySelectorAll('nav button').forEach(function(x){x.className=x==b?'on':''});render();scrollTo(0,0);if(view=='c')loadCloud();if(view=='a'||view=='k')loadSvcs()}});
function loadSvcs(){api('GET','services').then(function(s){svcs=s;render()})}
var L={queued:'⟦Na fila⟧',downloading:'⟦Baixando⟧',paused:'⟦Pausado⟧',done:'⟦Concluído⟧',error:'⟦Erro⟧'};
function btn(c,label,js){return'<button class="btn'+(c?' '+c:'')+'" onclick="'+js+'">'+label+'</button>'}
function job(j){var p=j.size?Math.round(j.written/j.size*100):0,act=j.state=='downloading',err=j.state=='error';
return'<section class="card"><div class="top"><span class="t">'+e(j.name)+'</span><span class="pc'+(err?' b':act?'':' m')+'">'+(act?p+'%':L[j.state])+'</span></div><div class="bar"><i style="width:'+p+'%"></i></div><p class="s">'+f(j.written)+' ⟦de⟧ '+f(j.size)+(err&&j.error?' · <span class="err">'+e(j.error)+'</span>':'')+'</p><div class="row">'+
(act?btn('','⟦Pausar⟧','act('+j.id+',&quot;pause&quot;)'):'')+(j.state=='paused'||err?btn('p','⟦Retomar⟧','act('+j.id+',&quot;resume&quot;)'):'')+'</div></section>'}
function render(){var v=$('#v'),h='';
if(view=='q'){if(!st){v.innerHTML='';return}
var live=st.jobs.filter(function(j){return j.state=='downloading'||j.state=='paused'||j.state=='error'}),wait=st.jobs.filter(function(j){return j.state=='queued'}),done=st.jobs.filter(function(j){return j.state=='done'}),run=st.tasks.filter(function(t){return t.state=='running'||t.state=='queued'});
h='<h1>⟦Fila⟧</h1><p class="sum">'+live.length+' ⟦ativos⟧ · '+wait.length+' ⟦esperando⟧'+(st.speed>0?' · '+f(st.speed)+'/s':'')+'</p>';
live.forEach(function(j){h+=job(j)});
run.forEach(function(t){var p=t.total?Math.round((t.written||0)/t.total*100):0;h+='<section class="card"><div class="top"><span class="t">'+e(t.name)+'</span><span class="pc k">'+(t.type=='extract'?'⟦Extraindo⟧':'⟦Copiando⟧')+'</span></div><div class="bar k"><i style="width:'+p+'%"></i></div></section>'});
if(wait.length)h+='<h2>⟦Esperando⟧</h2><div class="list">'+wait.map(function(j){return'<div class="li"><span>'+e(j.name)+'</span><span>'+f(j.size)+'</span></div>'}).join('')+'</div>';
if(done.length)h+='<h2>⟦Concluídos⟧</h2><div class="list">'+done.map(function(j){return'<div class="li"><span>'+e(j.name)+'</span><span class="ok">'+f(j.size)+'</span></div>'}).join('')+'</div>';
if(!live.length&&!wait.length&&!run.length&&!done.length)h+='<p class="sum">⟦Nada na fila. Use Adicionar ou Nuvem.⟧</p>';v.innerHTML=h}
else if(view=='a'){var on=svcs.filter(function(x){return x.linked});if(!svc||(svc!='direct'&&!on.some(function(x){return x.id==svc})))svc=on.length?on[0].id:'direct';
h='<h1>⟦Adicionar⟧</h1><label class="lb" for="links">⟦Cole um ou mais links (magnet, hoster ou direto), um por linha⟧</label><textarea id="links" placeholder="magnet:?xt=…"></textarea><label class="lb">⟦Mandar para⟧</label><div class="chips">'+
on.map(function(x){return'<button class="chip'+(svc==x.id?' on':'')+'" onclick="pick(&quot;'+x.id+'&quot;)">'+e(x.name)+'</button>'}).join('')+'<button class="chip'+(svc=='direct'?' on':'')+'" onclick="pick(&quot;direct&quot;)">⟦Link direto no PS5⟧</button></div>'+
(svc=='direct'?'':'<label class="chk"><input type="checkbox" id="auto" checked> ⟦Baixar no PS5 quando ficar pronto⟧</label>')+'<button class="btn p big" id="add">⟦Adicionar⟧</button><div id="res"></div>';
var keep=$('#links')?$('#links').value:'';v.innerHTML=h;$('#links').value=keep;
$('#add').onclick=function(){var ls=$('#links').value.split(/\\n+/).map(function(s){return s.trim()}).filter(Boolean),au=$('#auto');ls.forEach(function(l){api('POST','add',{link:l,service:svc,direct:svc=='direct',auto:au?au.checked:false}).then(function(r){$('#res').insertAdjacentHTML('beforeend','<p class="msg '+(r.error?'err':'ok')+'">'+e(r.error||r.message)+'</p>')})});$('#links').value=''}}
else if(view=='k'){h='<h1>⟦Contas⟧</h1>'+svcs.map(function(x){return'<section class="card"><div class="top"><span class="t">'+e(x.name)+'</span><span class="pc '+(x.linked?'g':'m')+'">'+(x.linked?'⟦Conectado⟧':'⟦Não conectado⟧')+'</span></div>'+(x.auth=='key'?'<p class="s">⟦Cole a chave da API⟧ ('+e(x.keyUrl)+')</p><input type="text" id="k_'+x.id+'" placeholder="⟦chave da API⟧" autocomplete="off">'+btn('p big','⟦Salvar chave⟧','saveKey(&quot;'+x.id+'&quot;)'):'<p class="s">⟦Conecte pelo PS5: Ajustes > Serviços de nuvem (QR code).⟧</p>')+'</section>'}).join('')+'<div id="kres"></div>';v.innerHTML=h}
else{if(!cloud){v.innerHTML='<h1>⟦Nuvem⟧</h1><p class="sum">⟦Carregando…⟧</p>';return}
h='<h1>⟦Nuvem⟧</h1>'+(cloud.map(function(it,i){return'<section class="card"><span class="t">'+e(it.name)+'</span><p class="s">'+e(it.service)+' · '+f(it.size)+(it.fileCount?' · '+it.fileCount+' ⟦arquivo(s)⟧':'')+'</p>'+(it.ready?'<span class="pill">⟦Pronto⟧</span>':'<span class="pill w">⟦Na nuvem⟧ '+Math.round(it.progress*100)+'%</span>')+btn(it.ready?'p':'o',it.ready?'⟦Baixar no PS5⟧':'⟦Baixar quando ficar pronto⟧','dl('+i+')')+'</section>'}).join('')||'<p class="sum">⟦Nuvem vazia.⟧</p>');v.innerHTML=h}}
function pick(id){svc=id;render()}
function saveKey(id){var k=$('#k_'+id).value.trim();if(!k)return;$('#kres').innerHTML='<p class="msg">⟦Conferindo…⟧</p>';api('POST','account',{provider:id,key:k}).then(function(r){$('#kres').innerHTML='<p class="msg '+(r.error?'err':'ok')+'">'+e(r.error||r.message)+'</p>';loadSvcs()})}
function act(id,a){api('POST','job',{id:id,action:a}).then(tick)}
function dl(i){var it=cloud[i];api('POST','download',{provider:it.provider,kind:it.kind,id:it.id}).then(function(r){alert(r.error||r.message);tick()})}
function loadCloud(){api('GET','cloud').then(function(c){cloud=c;render()})}
function tick(){api('GET','state').then(function(s){st=s;$('#conn').className='st';$('#speed').textContent=s.speed>0?f(s.speed)+'/s':'⟦PS5 conectado⟧';if(view=='q')render()}).catch(function(){$('#conn').className='st off';$('#speed').textContent='⟦PS5 sem resposta⟧'})}
setInterval(function(){if(!$('#app').hidden)tick()},2000);api('GET','state').then(function(s){st=s;show(true)}).catch(function(){});
</script></body></html>`;

// Página no idioma do app (apóstrofo vira ’ para não quebrar as strings do script).
export function phonePage() {
  return PAGE_SRC.replace(/⟦([^⟧]*)⟧/g, (m, k) => t(k).replace(/'/g, '’').replace(/</g, '&lt;'));
}


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
    LocalServer.start({ports: [8090, 8091, 0], pin: phonePin, session: phoneSession, page: phonePage()});
    started = true;
  } catch (_) { return; }
  setInterval(serve, 120);
}

function reply(id, obj, status = 200) {
  if (obj && !Array.isArray(obj)) obj = {...obj, ...(obj.message ? {message: t(obj.message)} : {}), ...(obj.error ? {error: t(obj.error)} : {})};
  LocalServer.respond(id, status, 'application/json', JSON.stringify(obj));
}

export function refreshPhonePage() { try { if (started && LocalServer.setPage) LocalServer.setPage(phonePage()); } catch (_) {} }

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
        reply(r.id, (ui.get().cloud || []).map(it => ({...it, service: provider(it.provider).name})));
      } else if (r.method === 'GET' && path === 'services') {
        reply(r.id, PROVIDERS.map(p => ({id: p.id, name: p.name, linked: p.linked(), auth: p.auth, keyUrl: p.keyUrl || ''})));
      } else if (r.method === 'POST' && path === 'account' && typeof body.key === 'string') {
        const p = provider(body.provider);
        if (!p.setKey) { reply(r.id, {error: 'Esse serviço conecta pelo QR code no PS5.'}); continue; }
        const id = r.id;
        let answered = false;
        const once = obj => { if (!answered) { answered = true; reply(id, obj); } };
        setTimeout(() => once({message: 'Conferindo a chave… olhe a TV em instantes'}), 4000);
        p.setKey(body.key).then(() => { once({message: `${p.name} conectado!`}); toast(`${p.name} conectado pelo celular`, 'ok'); ui.set({cloud: null, cloudRefresh: Date.now()}); },
          e => once({error: e.message}));
      } else if (r.method === 'POST' && path === 'job' && ['pause', 'resume'].includes(body.action)) {
        jobAction(Number(body.id), body.action);
        reply(r.id, {ok: true});
      } else if (r.method === 'POST' && path === 'download') {
        const item = (ui.get().cloud || []).find(i => (i.provider || 'torbox') === (body.provider || 'torbox') && i.kind === body.kind && String(i.id) === String(body.id));
        if (!item) { reply(r.id, {error: 'Item não encontrado'}); continue; }
        const c = config.get();
        const p = provider(item.provider);
        const opts = {extract: c.autoExtract, deleteArchive: c.deleteArchive, flatten: c.flatten};
        if (item.ready) {
          const id = r.id;
          (item.needsFiles ? p.details(item) : Promise.resolve(item)).then(full => {
            const n = enqueueTorbox(full, full.files, c.defaultDest, opts);
            toast(`Celular: ${n} arquivo(s) na fila`, 'ok');
            reply(id, {message: n ? `${n} arquivo(s) na fila do PS5` : 'Já está na fila'});
          }, e => reply(id, {error: e.message}));
        } else {
          watchItem(item.kind, item.id, item.name, c.defaultDest, opts, item.provider || 'torbox');
          reply(r.id, {message: `Vai baixar assim que ficar pronto no ${p.name}`});
        }
      } else if (r.method === 'POST' && path === 'add' && typeof body.link === 'string') {
        const c = config.get();
        const link = body.link.trim().slice(0, 4000);
        if (body.direct && /^https?:\/\//i.test(link)) {
          enqueueDirect(link, c.defaultDest, {extract: c.autoExtract, deleteArchive: c.deleteArchive, flatten: c.flatten});
          toast('Celular: link direto na fila', 'ok');
          reply(r.id, {message: 'Na fila do PS5'});
          continue;
        }
        const id = r.id;
        let answered = false;
        const once = (obj) => { if (!answered) { answered = true; reply(id, obj); } };
        const p = provider(body.service || (linkedProviders()[0] || {}).id);
        if (!p.linked()) { reply(id, {error: 'Conecte um serviço no PS5 (Ajustes > Serviços de nuvem) ou escolha Link direto.'}); continue; }
        const opts = {extract: c.autoExtract, deleteArchive: c.deleteArchive, flatten: c.flatten};
        setTimeout(() => once({message: `Enviando ao ${p.name}… confira a fila em instantes`}), 4000);
        p.add(link).then(res => {
          if (res.direct) {   // link de site (hoster) liberado pelo serviço: baixa direto
            enqueueDirect(res.direct, c.defaultDest, opts, res.name);
            for (const m of res.more || []) if (m.link) enqueueDirect(m.link, c.defaultDest, opts);
            toast(`Celular: link liberado pelo ${p.name}, na fila`, 'ok');
            once({message: `Liberado pelo ${p.name}, na fila do PS5`});
            return;
          }
          if (body.auto && res.id) watchItem(res.kind, res.id, link.slice(0, 60), c.defaultDest, opts, p.id);
          toast(`Celular: link adicionado ao ${p.name}`, 'ok');
          once({message: res.cached ? (body.auto ? `Já estava no cache do ${p.name}, baixando no PS5` : `Já estava no cache do ${p.name}`)
            : (body.auto ? `Adicionado ao ${p.name}; baixa no PS5 quando ficar pronto` : `Adicionado ao ${p.name}`)});
        }, e => { once({error: e.message}); toast(`Celular: ${e.message}`, 'bad'); });
      } else {
        reply(r.id, {error: 'rota desconhecida'}, 404);
      }
    } catch (e) {
      reply(r.id, {error: String(e.message || e)}, 500);
    }
  }
}
