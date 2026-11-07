#!/usr/bin/env python3
"""Servidor que imita a API do TorBox + CDN (com Range, limite de velocidade e queda de conexão)."""
import json, os, sys, time, threading, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote, unquote

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9900
FILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "files")
KEY = "testkey"
SPEED = int(os.environ.get("MOCK_SPEED", str(3 * 1024 * 1024)))  # bytes/s por conexão
stats = {"range_requests": 0, "dropped": 0, "requestdl": 0, "deleted": []}
dropped_once = set()

def fentry(fid, name):
    return {"id": fid, "name": name, "short_name": os.path.basename(name), "size": os.path.getsize(os.path.join(FILES, os.path.basename(name)))}

def item(iid, name, files, finished=True, progress=1.0, state="completed"):
    fs = [fentry(i, f) for i, f in enumerate(files)]
    return {"id": iid, "name": name, "size": sum(f["size"] for f in fs), "progress": progress, "download_speed": 0, "eta": 0,
            "download_state": state, "download_finished": finished, "download_present": finished, "files": fs, "created_at": "2026-11-07T00:00:00Z"}

TORRENTS = [
    item(1, "Filme RAR4", [f"Filme/Filme.part000{i}.rar" for i in range(1, 5)]),
    item(2, "Serie RAR5", [f"Serie/Serie.part0{i}.rar" for i in range(1, 9)]),
    item(3, "Pacote 7z", [f"Pacote/Pacote.7z.00{i}" for i in range(1, 4)]),
    item(4, "Grande", ["Grande/Grande.bin"]),
    item(5, "Protegido", ["Protegido.rar"]),
    item(6, "Senha zip", ["Senha.zip"]),
    item(7, "Ainda baixando no TorBox", ["Senha.zip"], finished=False, progress=0.42, state="downloading"),
]
WEBDL = [item(50, "Arquivo de hoster", ["Senha.zip"])]
created = {}   # id -> (tempo, item)
AUTH = {"approved": False, "issued": False}

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass

    def j(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def auth(self, q):
        h = self.headers.get("Authorization", "")
        if h == "Bearer " + KEY or q.get("token", [""])[0] == KEY:
            return True
        self.j(403, {"success": False, "error": "BAD_TOKEN", "detail": "bad token"})
        return False

    def lists(self):
        now = time.time()
        tor = list(TORRENTS)
        for iid, (t0, it) in created.items():
            it = dict(it)
            if now - t0 > 25:
                it.update(download_finished=True, download_present=True, progress=1.0, download_state="completed")
            tor.append(it)
        return {"torrents": tor, "webdl": WEBDL, "usenet": []}

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path.startswith("/dl/"):
            return self.serve_file(unquote(u.path[4:]))
        if u.path == "/v1/api/user/auth/device/start":
            AUTH["approved"] = False; AUTH["issued"] = False
            return self.j(200, {"success": True, "detail": "Successfully created your device code authorization.",
                                "data": {"device_code": "devcode123", "code": "4F7K2Q", "verification_url": "https://torbox.app/oauth/device?app=Nimbo%20PS5",
                                         "friendly_verification_url": "tor.box/link", "interval": 1, "expires_at": "2026-11-07T23:00:00Z"}})
        if not self.auth(q): return
        m = re.match(r"^/v1/api/(torrents|webdl|usenet)/(mylist|requestdl)$", u.path)
        if u.path == "/v1/api/user/me":
            return self.j(200, {"success": True, "data": {"email": "felipe@teste.com", "plan": 2, "premium_expires_at": "2027-01-01"}})
        if not m: return self.j(404, {"success": False, "error": "NOT_FOUND"})
        kind, op = m.groups()
        lst = self.lists()[kind]
        if op == "mylist":
            return self.j(200, {"success": True, "data": lst})
        idk = {"torrents": "torrent_id", "webdl": "web_id", "usenet": "usenet_id"}[kind]
        iid = int(q[idk][0]); fid = int(q["file_id"][0])
        for it in lst:
            if it["id"] == iid:
                f = it["files"][fid]
                stats["requestdl"] += 1
                return self.j(200, {"success": True, "data": f"http://127.0.0.1:{PORT}/dl/{quote(f['short_name'])}?sig=abc"})
        self.j(404, {"success": False, "error": "ITEM_NOT_FOUND", "detail": "item não existe"})

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(n)
        if u.path == "/v1/api/user/auth/device/token":
            dc = json.loads(body or b"{}").get("device_code")
            if dc == "devcode123" and AUTH["approved"] and not AUTH["issued"]:
                AUTH["issued"] = True
                return self.j(200, {"success": True, "data": {"access_token": KEY, "token_type": "Bearer"}})
            return self.j(400, {"success": False, "error": "PENDING", "detail": "Authorization pending"})
        if not self.auth({}): return
        if u.path == "/v1/api/torrents/createtorrent":
            if b"magnet:" not in body: return self.j(400, {"success": False, "error": "BAD_INPUT"})
            iid = 100 + len(created)
            created[iid] = (time.time(), item(iid, f"Magnet novo {iid}", ["Senha.zip"], finished=False, progress=0.0, state="downloading"))
            return self.j(200, {"success": True, "detail": "Torrent added successfully", "data": {"torrent_id": iid, "hash": "abc"}})
        if u.path == "/v1/api/webdl/createwebdownload":
            return self.j(200, {"success": True, "detail": "Found cached web download. Using cached download.", "data": {"webdownload_id": 50}})
        if u.path.endswith("controltorrent") or u.path.endswith("controlwebdownload"):
            stats["deleted"].append(json.loads(body))
            return self.j(200, {"success": True, "detail": "ok"})
        self.j(404, {"success": False})

    def serve_file(self, name):
        p = os.path.join(FILES, os.path.basename(name))
        if not os.path.exists(p):
            return self.j(404, {"error": "no"})
        size = os.path.getsize(p)
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            stats["range_requests"] += 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(p)}"')
        self.end_headers()
        # derruba uma conexão do arquivo grande no meio, uma vez, para testar a retomada
        drop_at = None
        if name.endswith("Grande.bin") and start > 0 and "Grande" not in dropped_once and end - start > 4_000_000:
            dropped_once.add("Grande"); drop_at = start + 2_000_000
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1; pos = start
            t0 = time.time(); sent = 0
            while left > 0:
                chunk = f.read(min(65536, left))
                if drop_at and pos + len(chunk) > drop_at:
                    stats["dropped"] += 1
                    self.wfile.write(chunk[: drop_at - pos]); self.wfile.flush()
                    self.connection.shutdown(2)
                    return
                try:
                    self.wfile.write(chunk)
                except Exception:
                    return
                left -= len(chunk); pos += len(chunk); sent += len(chunk)
                ahead = sent / SPEED - (time.time() - t0)
                if ahead > 0: time.sleep(ahead)

class S(ThreadingHTTPServer):
    daemon_threads = True

def stats_srv():
    class SH(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            if self.path == "/approve": AUTH["approved"] = True
            b = json.dumps(stats).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    ThreadingHTTPServer(("127.0.0.1", PORT + 1), SH).serve_forever()

threading.Thread(target=stats_srv, daemon=True).start()
print(f"mock TorBox em http://127.0.0.1:{PORT}/v1/api", flush=True)
S(("127.0.0.1", PORT), H).serve_forever()
