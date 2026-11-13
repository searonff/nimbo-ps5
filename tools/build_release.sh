set -e
V="$1"
cd ~/ps5-react && . .venv/bin/activate && export CC=clang CXX=clang++
S=$(date +%s)
python3 tools/cli.py build --app-dir /mnt/c/Users/felip/nimbo-ps5/nimbo > ~/build_$V.log 2>&1
echo "build ok em $(( $(date +%s) - S ))s"
tail -1 ~/build_$V.log
cd dist && rm -f NimboDownloader-PS5-v$V.zip
python3 -c "import shutil;shutil.make_archive('NimboDownloader-PS5-v$V','zip','.','PPSA48921')"
mkdir -p /mnt/c/Users/felip/nimbo-ps5/dist && cp NimboDownloader-PS5-v$V.zip /mnt/c/Users/felip/nimbo-ps5/dist/
echo zip ok
