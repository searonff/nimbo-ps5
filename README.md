# Nimbo PS5

Gerenciador de downloads do **TorBox** para PS5 desbloqueado (payload ELF para etaHEN / PS5 Payload Manager), com interface para a TV e para o celular.

## Recursos

- **Login por QR code** no TorBox (código de dispositivo), sem digitar token
- Nuvem do TorBox (torrents, web, usenet) em capas, com selo "Já baixado"
- Downloads com **várias conexões por arquivo**, retomada, fila salva e limite de velocidade
- Escolha do destino: SSD interno (`/data`), USB (`/mnt/usbN`), armazenamento estendido
- **Extração automática** (ZIP com senha, 7z, RAR, RAR5, em várias partes) e opção de apagar o compactado
- "Baixar quando ficar pronto": manda um magnet pelo celular e o PS5 baixa sozinho
- **Gerenciador de arquivos**: copiar, mover, renomear, apagar e baixar do PS5 para o celular
- **Gerenciador de armazenamento**: uso por tipo, maiores pastas/arquivos, sugestões de limpeza e tamanho dos jogos instalados
- Atalho com ícone na aba Mídia, notificações do PS5 e bloqueio do modo de repouso durante downloads
- Navegação pelo controle (✕ ○ △, L1/R1) e QR code para abrir no celular

## Instalação

Baixe o `.zip` em **Releases** e siga o `LEIA-ME.txt`. Em resumo: copie a pasta `NimboPS5` para `/data/pldmgr/payloads/` e rode `nimbo-ps5.elf` pelo PS5 Payload Manager.

## Compilar

```bash
# SDK: https://github.com/ps5-payload-dev/sdk  (instalado em /opt/ps5-payload-sdk)
./scripts/build-deps-ps5.sh   # zlib, xz, mbedTLS, curl, libarchive para PS5
make ps5                      # gera nimbo-ps5.elf
./scripts/package.sh          # monta dist/NimboPS5 e o .zip
```

Para testar no PC (Linux): `make pc` e rode `./nimbo-pc` (variáveis `NIMBO_ROOTS`, `NIMBO_DATA`, `NIMBO_TORBOX_BASE`).

O GitHub Actions compila e publica o `.zip` automaticamente a cada tag `v*`.

## Licença

GPLv3 (o SDK do PS5 usado na compilação é GPLv3+). Usa cJSON e qrcode-generator (MIT), curl, mbedTLS, libarchive, zlib e xz.
