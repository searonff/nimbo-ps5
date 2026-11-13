import sys
p = sys.argv[1]
s = open(p).read()
old = '''        run(["sh", hui / "tooling/prospero-clang18", *flags, "-O2", *warnings, *layout_assets.get(source, []),
             "-DPROSPERO=1", "-DGL_GLEXT_PROTOTYPES=1", *shlex.split(definitions),
             *[flag for path in includes for flag in ("-I", path)], "-c", source, "-o", obj],
            env=env, log=BUILD / (f"compile-{i}.log"))
        objects.append(obj)
'''
new = '''        cmd = ["sh", hui / "tooling/prospero-clang18", *flags, "-O2", *warnings, *layout_assets.get(source, []),
             "-DPROSPERO=1", "-DGL_GLEXT_PROTOTYPES=1", *shlex.split(definitions),
             *[flag for path in includes for flag in ("-I", path)], "-c", source, "-o", obj]
        # Local cache: skip when the source and the command are unchanged (headers are not tracked).
        key = hashlib.sha256(Path(source).read_bytes() + "\\x1f".join(map(str, cmd)).encode()).hexdigest()
        stamp = obj.with_suffix(".key")
        if not (obj.exists() and stamp.exists() and stamp.read_text() == key):
            pending.append((cmd, i, stamp, key))
        objects.append(obj)

    def _compile(item):
        cmd, i, stamp, key = item
        run(cmd, env=env, log=BUILD / f"compile-{i}.log")
        stamp.write_text(key)

    with concurrent.futures.ThreadPoolExecutor(os.cpu_count() or 4) as pool:
        list(pool.map(_compile, pending))
'''
assert old in s, 'compile block not found'
s = s.replace(old, new)
loop = '    objects = []\n    for i, source in enumerate(sources):'
assert loop in s, 'loop not found'
s = s.replace(loop, '    objects, pending = [], []\n    (BUILD / "obj").mkdir(parents=True, exist_ok=True)\n    for i, source in enumerate(sources):', 1)
lines = s.split('\n')
idx = next(i for i, l in enumerate(lines) if l.startswith('import ') or l.startswith('from '))
lines.insert(idx, 'import concurrent.futures, hashlib')
open(p, 'w').write('\n'.join(lines))
print('patched')
