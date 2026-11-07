# Nimbo PS5
#   make pc   -> ./nimbo-pc (Linux, para testes)
#   make ps5  -> nimbo-ps5.elf (precisa do PS5_PAYLOAD_SDK e das dependências: scripts/build-deps-ps5.sh)
SRCS := src/main.c src/util.c src/config.c src/storage.c src/torbox.c src/downloads.c \
        src/tasks.c src/analyze.c src/server.c src/api.c src/platform.c src/vendor/cJSON.c src/gen/assets.c
WEB  := $(wildcard web/*)
PS5_PAYLOAD_SDK ?= /opt/ps5-payload-sdk
HB := $(PS5_PAYLOAD_SDK)/target/user/homebrew

all: pc

src/gen/assets.c: $(WEB) assets/icon0.png scripts/gen_assets.py
	python3 scripts/gen_assets.py

# use a mesma versão da libarchive do PS5 (3.7.7) se estiver em /opt/la377
LA_INC := $(if $(wildcard /opt/la377/lib/libarchive.a),-I/opt/la377/include,)
LA_LIB := $(if $(wildcard /opt/la377/lib/libarchive.a),/opt/la377/lib/libarchive.a -llzma -lz,-larchive)

pc: $(SRCS)
	cc -O2 -g -Wall -Wextra -Wno-unused-parameter -pthread $(LA_INC) -o nimbo-pc $(SRCS) -lcurl $(LA_LIB)

ps5: $(SRCS)
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang -O2 -Wall -Wno-unused-parameter -Wno-unreachable-code-generic-assoc -pthread \
	  -I$(HB)/include -o nimbo-ps5.elf $(SRCS) \
	  -L$(HB)/lib -lcurl -lmbedtls -lmbedx509 -lmbedcrypto -larchive -llzma -lz \
	  -lkernel_sys -lSceSystemService -lSceUserService -lSceAppInstUtil
	$(PS5_PAYLOAD_SDK)/bin/prospero-strip nimbo-ps5.elf

clean:
	rm -rf nimbo-pc nimbo-ps5.elf src/gen
.PHONY: all pc ps5 clean
