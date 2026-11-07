import binascii, os, glob, subprocess, random
src = "la/libarchive-3.7.7/libarchive/test/"
out = "files"
def uudecode(p, dst):
    data = b""
    for line in open(p, "rb"):
        if line.startswith(b"begin") or line.startswith(b"end") or not line.strip(): continue
        try: data += binascii.a2b_uu(line)
        except binascii.Error:
            n = (((line[0] - 32) & 63) * 4 + 5) // 3
            data += binascii.a2b_uu(line[:n])
    open(dst, "wb").write(data)
# RAR4 multivolume -> "Filme.part0001.rar" ...
for f in sorted(glob.glob(src + "test_read_format_rar_multivolume.part*.rar.uu")):
    n = f.split(".part")[1].split(".")[0]
    uudecode(f, f"{out}/Filme.part{n}.rar")
# RAR5 multivolume
for f in sorted(glob.glob(src + "test_read_format_rar5_multiarchive.part0*.rar.uu")):
    n = f.split(".part")[1].split(".")[0]
    uudecode(f, f"{out}/Serie.part{n}.rar")
uudecode(src + "test_read_format_rar_encryption_data.rar.uu", f"{out}/Protegido.rar")
# arquivo grande (40 MB) para testar várias conexões
random.seed(7)
open(f"{out}/Grande.bin", "wb").write(os.urandom(40 * 1024 * 1024))
# zip com senha
os.makedirs("tmpz", exist_ok=True)
open("tmpz/leia-me.txt", "w").write("conteudo secreto\n")
open("tmpz/dados.bin", "wb").write(os.urandom(300000))
subprocess.run(["zip", "-q", "-r", "-P", "senha123", "../files/Senha.zip", "."], cwd="tmpz", check=True)
# 7z dividido em partes
os.makedirs("tmp7", exist_ok=True)
open("tmp7/video.mkv", "wb").write(os.urandom(2500000))
open("tmp7/legenda.srt", "w").write("1\n00:00:01,000 --> 00:00:02,000\nOla\n")
subprocess.run(["7z", "a", "-v1m", "-bd", "-bb0", "../files/Pacote.7z", "."], cwd="tmp7", check=True, stdout=subprocess.DEVNULL)
print(sorted(os.listdir(out)))
