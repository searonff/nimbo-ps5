#!/usr/bin/env python3
"""Ferramenta de idiomas do Nimbo.
  i18n.py wrap  <arquivos>   envolve textos de template em JSX com t(`...`)
  i18n.py keys  <arquivos>   lista as chaves usadas em t('...') / t(`...`)
  i18n.py build             gera nimbo/src/i18n/strings.js a partir de tools/i18n.tsv e avisa o que falta
"""
import re, sys, os, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ['en', 'es', 'fr', 'de', 'it']
WORD = re.compile(r'[A-Za-zÀ-ú]{2,}')

def read_template(s, i):
    """s[i] == '`'; devolve (fim_exclusivo, partes) com partes = [('s', texto) | ('e', expr)]."""
    j = i + 1; parts = []; buf = ''
    while j < len(s):
        c = s[j]
        if c == '\\': buf += s[j:j+2]; j += 2; continue
        if c == '`': parts.append(('s', buf)); return j + 1, parts
        if c == '$' and s[j+1:j+2] == '{':
            parts.append(('s', buf)); buf = ''
            k = j + 2; depth = 1
            while depth:
                ch = s[k]
                if ch == '`': k, _ = read_template(s, k); continue
                if ch in '\'"':
                    q = ch; k += 1
                    while s[k] != q: k += 2 if s[k] == '\\' else 1
                    k += 1; continue
                if ch == '{': depth += 1
                elif ch == '}': depth -= 1
                k += 1
            parts.append(('e', s[j+2:k-1])); j = k; continue
        buf += c; j += 1
    raise ValueError('template sem fim')

def static_text(parts): return ''.join(p for k, p in parts if k == 's')

def key_of(parts):
    out = ''; n = 0
    for k, p in parts:
        if k == 's': out += p
        else: n += 1; out += '{%d}' % n
    return out

def wrap(paths):
    for p in paths:
        s = open(p).read(); out = ''; i = 0; n = 0
        while True:
            m = re.compile(r'(\b(label|text|title|value|sub)=|>\s*|\?\s*|:\s*)\{`').search(s, i)
            if not m: out += s[i:]; break
            st = m.end() - 1
            end, parts = read_template(s, st)
            tpl = s[st:end]
            if WORD.search(static_text(parts)) and not s[m.start()-8:m.start()].endswith('t('):
                out += s[i:st] + 't(' + tpl + ')'; n += 1
            else:
                out += s[i:end]
            i = end
        if n: open(p, 'w').write(out); print(p, n)

CALL = re.compile(r"\bt\((['`])")
def keys(paths):
    found = {}
    for p in paths:
        s = open(p).read()
        for m in CALL.finditer(s):
            q = m.group(1); st = m.end() - 1
            if q == '`':
                try: end, parts = read_template(s, st)
                except Exception: continue
                k = key_of(parts)
            else:
                j = st + 1; buf = ''
                while s[j] != "'":
                    if s[j] == '\\': buf += s[j+1]; j += 2; continue
                    buf += s[j]; j += 1
                k = buf
            if WORD.search(re.sub(r'\{\w+\}', '', k)): found.setdefault(k, p)
    return found

def sources():
    out = [os.path.join(ROOT, 'nimbo/index.jsx')]
    for d, _, fs in os.walk(os.path.join(ROOT, 'nimbo/src')):
        if '/i18n' in d: continue
        out += [os.path.join(d, f) for f in fs if f.endswith(('.js', '.jsx')) and f not in ('qrcode.js', 'i18n.js')]
    return sorted(out)

def build():
    tsv = os.path.join(ROOT, 'tools/i18n.tsv'); table = {l: {} for l in LANGS}; known = set()
    for line in open(tsv, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'): continue
        cols = line.split('\t')
        if len(cols) != 6: print('linha com colunas erradas:', line[:80]); continue
        known.add(cols[0])
        for l, v in zip(LANGS, cols[1:]): table[l][cols[0]] = v
    used = keys(sources()) if True else {}
    extra = json.load(open(os.path.join(ROOT, 'tools/i18n-extra.json'))) if os.path.exists(os.path.join(ROOT, 'tools/i18n-extra.json')) else []
    IGNORE = {"Nimbo Downloader", "Nimbo", "PIN", "{1} MB/s", "{1}:{2} · PIN {3}", "github.com/searonff/nimbo-ps5"}
    missing = [k for k in list(used) + extra if k not in known and k not in IGNORE]
    for k in missing: print('FALTA:', json.dumps(k, ensure_ascii=False))
    for k in sorted(known - set(used) - set(extra)): print('sobrando:', json.dumps(k, ensure_ascii=False))
    js = '// Gerado por tools/i18n.py a partir de tools/i18n.tsv. Não edite à mão.\nexport default ' + json.dumps(table, ensure_ascii=False, indent=0) + ';\n'
    open(os.path.join(ROOT, 'nimbo/src/i18n/strings.js'), 'w').write(js)
    print(f'{len(known)} chaves, {len(missing)} faltando')

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'wrap': wrap(sys.argv[2:])
    elif cmd == 'keys':
        for k in keys(sys.argv[2:] or sources()): print(k)
    elif cmd == 'build': build()

# ---- varredura ampla: todo texto em português no código, mesmo fora de t() ----
PTISH = re.compile(r'[À-úçÇ]|\b(de|da|do|em|para|com|não|Não|um|uma|o|a|os|as|no|na|ao|pelo|pela|seu|sua|Baixar|Apagar|Pasta|Arquivos?|Nuvem|Conectar|Ligado|Desligado|Pronto|Copiar|Mover|Extrair|Cancelar|Voltar|Todos|Prontos|Nome|Tamanho|Data|Tipo|Vídeos|Músicas|Jogos|Imagens|Outros|Pausar|Retomar|Fila|Erro|Concluído|Cancelado|Baixando|Pausado|Esperando|Ajustes|Painel|Sobre|Armazenamento|Downloads|Selecionar|Renomear|Atualizar|Fechar|Depois|Desconectar|Conecte)\b')
SKIP = re.compile(r'^(\.{0,2}/|https?:|[a-z]+:[a-z]|font-|flex|text-|bg-|px-|py-|w-|h-|rounded|items-|border|gap-|absolute|application/|image/|video/|audio/|#|\[|\(\?|\\\\)')
def all_strings(paths):
    found = {}
    for p in paths:
        s = open(p).read()
        s2 = re.sub(r'^\s*//.*$', '', s, flags=re.M)
        s2 = re.sub(r'/\*.*?\*/', '', s2, flags=re.S)
        i = 0
        while i < len(s2):
            c = s2[i]
            if c == '/' and s2[i+1:i+2] == '/' : j = s2.find('\n', i); i = len(s2) if j < 0 else j; continue
            if c in '\'"':
                j = i + 1; buf = ''
                while j < len(s2) and s2[j] != c and s2[j] != '\n':
                    if s2[j] == '\\': buf += s2[j+1:j+2]; j += 2; continue
                    buf += s2[j]; j += 1
                k = buf; i = j + 1
            elif c == '`':
                try: end, parts = read_template(s2, i)
                except Exception: i += 1; continue
                k = key_of(parts); i = end
                # textos dentro das expressões também
                for kind, e in parts:
                    if kind == 'e':
                        for sub in all_strings_text(e): found.setdefault(sub, p)
            else: i += 1; continue
            if keep(k): found.setdefault(k, p)
    return found
def all_strings_text(e):
    out = []
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'", e):
        if keep(m.group(1)): out.append(m.group(1))
    return out
def keep(k):
    k2 = k.strip()
    if len(k2) < 2 or SKIP.match(k2) or not WORD.search(re.sub(r'\{\d+\}', '', k2)): return False
    if re.fullmatch(r'[\w.-]+', k2) and not PTISH.search(k2): return False
    if '<' in k2 and '>' in k2: return False
    return bool(PTISH.search(k2)) or ' ' in k2 and re.search(r'[a-z]{3,} [a-z]{2,}', k2)

if __name__ == '__main__' and sys.argv[1] == 'all':
    for k, p in all_strings(sources()).items(): print(os.path.basename(p) + '\t' + json.dumps(k, ensure_ascii=False))
