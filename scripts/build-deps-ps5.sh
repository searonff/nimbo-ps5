#!/usr/bin/env bash
# Cross-compila as dependências do Nimbo PS5 (estáticas) para o sysroot do SDK.
# Uso: PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk SRC=/caminho/dos/tarballs ./build-deps-ps5.sh
set -euo pipefail

: "${PS5_PAYLOAD_SDK:=/opt/ps5-payload-sdk}"
: "${SRC:=$(pwd)}"
JOBS=${JOBS:-$(nproc)}
source "${PS5_PAYLOAD_SDK}/toolchain/prospero.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SYS="${PS5_SYSROOT}${PREFIX}"   # /opt/ps5-payload-sdk/target/user/homebrew

fetch() { # url
  local f; f="$SRC/$(basename "$1")"
  [ -f "$f" ] || curl -sSL -o "$f" "$1"
  tar xf "$f" -C "$WORK"
}

fetch https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz
fetch https://github.com/tukaani-project/xz/releases/download/v5.6.3/xz-5.6.3.tar.xz
fetch https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.2/mbedtls-3.6.2.tar.bz2
fetch https://github.com/curl/curl/releases/download/curl-8_11_1/curl-8.11.1.tar.xz
fetch https://github.com/libarchive/libarchive/releases/download/v3.7.7/libarchive-3.7.7.tar.xz

echo "== zlib"
( cd "$WORK/zlib-1.3.1" && ./configure --prefix="$PREFIX" --static >/dev/null \
  && make -j"$JOBS" >/dev/null && make install >/dev/null )

echo "== xz (liblzma)"
( cd "$WORK/xz-5.6.3" && ./configure --prefix="$PREFIX" --host=x86_64-pc-freebsd \
    --enable-static --disable-shared --disable-xz --disable-xzdec --disable-lzmadec \
    --disable-lzmainfo --disable-scripts --disable-doc --disable-nls >/dev/null \
  && make -j"$JOBS" >/dev/null && make install >/dev/null )

echo "== mbedtls"
( cd "$WORK/mbedtls-3.6.2" && ${CMAKE} -DCMAKE_BUILD_TYPE=Release -DENABLE_TESTING=NO \
    -DENABLE_PROGRAMS=NO -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -B build -S . >/dev/null \
  && make -C build -j"$JOBS" >/dev/null && make -C build DESTDIR="$PS5_SYSROOT" install >/dev/null )

echo "== curl"
( cd "$WORK/curl-8.11.1" && ./configure --prefix="$PREFIX" --host=x86_64-pc-freebsd \
    --enable-static --disable-shared --with-mbedtls="$SYS" --with-zlib="$SYS" \
    --without-libpsl --without-libidn2 --without-brotli --without-zstd --without-nghttp2 \
    --without-libssh2 --disable-ldap --disable-rtsp --disable-dict --disable-telnet \
    --disable-tftp --disable-pop3 --disable-imap --disable-smtp --disable-gopher \
    --disable-mqtt --disable-smb --disable-docs --disable-manual --without-ca-bundle \
    --without-ca-path --disable-ntlm CPPFLAGS="-I$SYS/include" LDFLAGS="-L$SYS/lib" >/dev/null \
  && make -C lib -j"$JOBS" >/dev/null && make -C lib install >/dev/null \
  && make -C include install >/dev/null && make install-pkgconfigDATA >/dev/null 2>&1 || true )

echo "== libarchive"
( cd "$WORK/libarchive-3.7.7" && ./configure --prefix="$PREFIX" --host=x86_64-pc-freebsd \
    --enable-static --disable-shared --disable-bsdtar --disable-bsdcat --disable-bsdcpio \
    --disable-bsdunzip --disable-acl --disable-xattr --without-openssl --with-mbedtls \
    --without-xml2 --without-expat --without-bz2lib --without-zstd --without-lz4 \
    --without-libb2 --without-iconv --with-lzma --with-zlib \
    CPPFLAGS="-I$SYS/include" LDFLAGS="-L$SYS/lib" >/dev/null \
  && make -j"$JOBS" libarchive.la >/dev/null && make install-libLTLIBRARIES install-includeHEADERS >/dev/null )

"${PS5_CROSS_FIX_ROOT}" "$SYS" >/dev/null 2>&1 || true
ls -la "$SYS/lib"/*.a
