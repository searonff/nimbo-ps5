import json, os, time, hashlib, subprocess, urllib.request, sys
B = "http://127.0.0.1:8090"
ROOT = "/home/claude/test/run"
SSD, USB = ROOT + "/ssd", ROOT + "/usb"
fails = []
def req(m, p, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + p, data=data, method=m, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp: return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e: return {"_status": e.code, **json.loads(e.read() or b"{}")}
def check(name, cond, info=""):
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"), flush=True)
    if not cond: fails.append(name)
def md5(p): return hashlib.md5(open(p, "rb").read()).hexdigest()
def cloud(kind="torrents"): return {i["id"]: i for i in req("GET", "/api/cloud?kind=" + kind)}
def wait(pred, timeout=60, step=0.5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pred()
        if v: return v
        time.sleep(step)
    return None
def jobs(): return req("GET", "/api/jobs")
def tasks(): return req("GET", "/api/tasks")
def download(item, dest, extract=True, delete=False):
    items = [{"kind": item.get("kind", "torrents"), "item_id": item["id"], "file_id": f["id"], "name": f["name"], "size": f["size"]} for f in item["files"]]
    return req("POST", "/api/download", {"dest": dest, "extract": extract, "delete_archive": delete, "items": items})
def all_done(ids): 
    js = {j["id"]: j for j in jobs()}
    return all(js.get(i, {}).get("state") == "done" for i in ids)
def task_for(name):
    for t in tasks():
        if t["name"] == name: return t
def task_final(name, timeout=30):
    return wait(lambda: (lambda t: t if t and t["state"] in ("done", "error", "canceled") else None)(task_for(name)), timeout)
F = "/home/claude/test/files/"

# 0. config
c = req("POST", "/api/config", {"api_key": "testkey", "connections": 4, "max_parallel": 2})
check("salvar chave", c.get("has_key") is True, c)
C = cloud()
check("listar nuvem", len(C) == 7, len(C))

# 1. RAR4 em 4 partes, extrair + apagar
d1 = SSD + "/Nimbo"
r = download(C[1], d1, True, True)
check("enfileirar 4 partes", len(r["ids"]) == 4, r)
check("4 partes baixadas", wait(lambda: all_done(r["ids"]), 60))
t = task_final("Filme.part0001.rar")
check("RAR4 multi-volume extraído", t and t["state"] == "done", t)
check("partes apagadas após extrair", not any(os.path.exists(f"{d1}/Filme/Filme.part000{i}.rar") for i in range(1, 5)), os.listdir(d1 + "/Filme") if os.path.isdir(d1+"/Filme") else "")
ext = d1 + "/Filme/Filme"
check("conteúdo RAR4", os.path.isdir(ext) and len(os.listdir(ext)) > 0, os.listdir(d1 + "/Filme"))

# 2. RAR5 8 partes, sem apagar
r = download(C[2], d1, True, False)
check("RAR5 baixado", wait(lambda: all_done(r["ids"]), 60))
t = task_final("Serie.part01.rar")
check("RAR5 multi-volume extraído", t and t["state"] == "done", t)
check("RAR5 partes mantidas", os.path.exists(d1 + "/Serie/Serie.part08.rar"))
check("apenas 1 extração para 8 partes", sum(1 for x in tasks() if x["name"].startswith("Serie")) == 1, [x["name"] for x in tasks()])

# 3. 7z dividido
r = download(C[3], d1, True, False)
check("7z baixado", wait(lambda: all_done(r["ids"]), 60))
t = task_final("Pacote.7z.001")
check("7z em partes extraído", t and t["state"] == "done", t)
mk = d1 + "/Pacote/Pacote/video.mkv"
check("7z conteúdo correto", os.path.exists(mk) and md5(mk) == md5("/home/claude/test/tmp7/video.mkv"), os.listdir(d1+"/Pacote"))

# 4. arquivo grande, várias conexões, queda de conexão, md5
st0 = json.loads(urllib.request.urlopen("http://127.0.0.1:9901/").read())
r = download(C[4], USB, False, False)
time.sleep(1.2)
j = [x for x in jobs() if x["id"] == r["ids"][0]][0]
check("usa várias conexões", j["conns"] >= 2, j)
check("grande concluído", wait(lambda: all_done(r["ids"]), 90))
g = USB + "/Grande/Grande.bin"
check("md5 do arquivo grande confere", os.path.exists(g) and md5(g) == md5(F + "Grande.bin"))
st = json.loads(urllib.request.urlopen("http://127.0.0.1:9901/").read())
check("conexão derrubada e retomada", st["dropped"] >= 1, st)
check("sem .nimbopart sobrando", not any(f.endswith(".nimbopart") for f in os.listdir(USB + "/Grande")))

# 5. RAR criptografado -> mensagem amigável
r = download(C[5], d1, True, False)
wait(lambda: all_done(r["ids"]), 30)
t = task_final("Protegido.rar")
check("RAR com senha: erro amigável", t and t["state"] == "error" and ("senha" in t["error"].lower() or "suportado" in t["error"]), t)
print("     msg:", t and t["error"])

# 6. zip com senha: sem senha -> erro; com senha -> ok
r = download(C[6], d1, True, False)
wait(lambda: all_done(r["ids"]), 30)
t = task_final("Senha.zip")
check("zip sem senha cadastrada: erro", t and t["state"] == "error", t)
print("     msg:", t and t["error"])
req("POST", "/api/config", {"passwords": ["errada", "senha123"]})
req("POST", f"/api/tasks/{t['id']}/retry")
time.sleep(0.5)
t = task_final("Senha.zip")
check("zip com senha cadastrada extraído", t and t["state"] == "done", t)
lf = d1 + "/Senha/leia-me.txt"
check("conteúdo do zip", os.path.exists(lf) and open(lf).read() == "conteudo secreto\n", os.listdir(d1))

# 7. pausar/retomar + limite de velocidade
os.remove(g)
req("POST", "/api/jobs/clear")
req("POST", "/api/config", {"speed_limit_on": True, "speed_limit_kbps": 4096})
r = download(C[4], USB, False, False); jid = r["ids"][0]
time.sleep(3)
sp = [x for x in jobs() if x["id"] == jid][0]
check("limite de velocidade respeitado", sp["speed"] < 6 * 1024 * 1024, sp["speed"])
req("POST", f"/api/jobs/{jid}/pause")
check("pausado", wait(lambda: [x for x in jobs() if x["id"] == jid][0]["state"] == "paused", 10))
d_paused = [x for x in jobs() if x["id"] == jid][0]["done"]
time.sleep(1.5)
check("parado de verdade ao pausar", [x for x in jobs() if x["id"] == jid][0]["done"] == d_paused)
req("POST", "/api/config", {"speed_limit_on": False})
req("POST", f"/api/jobs/{jid}/resume")
check("retomado e concluído", wait(lambda: all_done([jid]), 60))
g2 = [x for x in jobs() if x["id"] == jid][0]["final_path"]
check("md5 após pausar/retomar", md5(g2) == md5(F + "Grande.bin"), g2)

# 8. reiniciar o app no meio do download
os.remove(g2)
req("POST", "/api/config", {"speed_limit_on": True, "speed_limit_kbps": 4096})
r = download(C[4], USB, False, False); jid = r["ids"][0]
time.sleep(2.5)
pid = int(open("/home/claude/test/run.nimbo.pid").read())
os.kill(pid, 15)
time.sleep(2)
env = dict(os.environ, NIMBO_TORBOX_BASE="http://127.0.0.1:9900/v1/api", NIMBO_DATA=ROOT + "/data", NIMBO_PORT="8090",
           NIMBO_ROOTS=f"SSD interno={SSD};USB 0={USB}", NIMBO_APPS_ROOT=ROOT + "/user")
p = subprocess.Popen(["/home/claude/nimbo-ps5/nimbo-pc"], env=env, stdout=open(ROOT + "/nimbo2.log", "w"), stderr=subprocess.STDOUT, cwd="/home/claude/test")
open("/home/claude/test/run.nimbo.pid", "w").write(str(p.pid))
time.sleep(1)
j = wait(lambda: [x for x in jobs() if x["id"] == jid], 10)
check("download restaurado após reiniciar", j and j[0]["state"] in ("queued", "downloading") and j[0]["done"] > 0, j)
req("POST", "/api/config", {"speed_limit_on": False})
check("concluído após reiniciar", wait(lambda: all_done([jid]), 60))
g3 = [x for x in jobs() if x["id"] == jid][0]["final_path"]
check("md5 após reiniciar", md5(g3) == md5(F + "Grande.bin"))

# 9. link direto
r = req("POST", "/api/download", {"url": "http://127.0.0.1:9900/dl/Senha.zip?x=1", "dest": USB, "extract": False})
check("link direto concluído", wait(lambda: all_done(r["ids"]), 20))
check("nome do link direto", os.path.exists(USB + "/Senha.zip"), os.listdir(USB))

# 10. magnet com download automático quando ficar pronto
a = req("POST", "/api/cloud/add", {"link": "magnet:?xt=urn:btih:abc", "auto_download": True, "dest": SSD + "/Auto", "extract": True, "delete_archive": True})
check("magnet adicionado e vigiado", a.get("watching") is True, a)
check("baixou sozinho quando ficou pronto", wait(lambda: os.path.isdir(SSD + "/Auto/Senha"), 75, 2), os.listdir(SSD) if os.path.isdir(SSD) else "")

# 11. copiar e mover
req("POST", "/api/fs/copy", {"src": USB + "/Senha.zip", "dest": SSD})
check("copiar", wait(lambda: os.path.exists(SSD + "/Senha.zip"), 10))
os.makedirs(USB + "/Destino", exist_ok=True)
req("POST", "/api/fs/move", {"src": SSD + "/Senha.zip", "dest": USB + "/Destino"})
check("mover", wait(lambda: os.path.exists(USB + "/Destino/Senha.zip") and not os.path.exists(SSD + "/Senha.zip"), 10))
bad = req("POST", "/api/fs/delete", {"path": "/etc/passwd"})
check("bloqueia caminho fora das unidades", bad.get("_status") == 400, bad)
bad = req("POST", "/api/fs/delete", {"path": SSD})
check("não apaga a unidade inteira", bad.get("_status") == 400, bad)

# 12. servir arquivo com Range
rq = urllib.request.Request(B + "/api/fs/file?path=" + urllib.parse.quote(USB + "/Destino/Senha.zip"), headers={"Range": "bytes=10-19"})
with urllib.request.urlopen(rq) as resp:
    body = resp.read()
    check("Range ao servir arquivo", resp.status == 206 and body == open(F + "Senha.zip", "rb").read()[10:20])

# 13. análise de armazenamento
open(SSD + "/Nimbo/orfao.mkv.nimbopart", "wb").write(b"x" * 5000)
req("POST", "/api/analyze", {"path": SSD})
s = wait(lambda: (lambda s: s if s["state"] == "done" else None)(req("GET", "/api/analyze/status")), 20)
check("análise concluída", s is not None)
cats = {c["key"]: c["bytes"] for c in s["categories"]}
check("categorias (vídeo/compactado)", cats.get("video", 0) > 0 and cats.get("archive", 0) > 0, cats)
reasons = [x["reason"] for x in s["suggestions"]]
check("sugere parcial abandonado", any("parcial" in r for r in reasons), reasons)
check("sugere compactado já extraído", any("extraído" in r for r in reasons), reasons)
dd = req("GET", "/api/analyze/dir?path=" + urllib.parse.quote(SSD))
check("maiores pastas", len(dd["dirs"]) >= 1 and dd["dirs"][0]["size"] >= dd["dirs"][-1]["size"], dd)
apps = req("GET", "/api/apps")
check("jogos instalados com nome e tamanho", len(apps) == 2 and apps[0]["title"] == "Jogo Grande" and apps[0]["size"] > apps[1]["size"], apps)

print("\nRESULTADO:", "TUDO OK" if not fails else f"{len(fails)} falha(s): {fails}")
