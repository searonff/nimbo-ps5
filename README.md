# Nimbo Downloader para PS5

App nativo para PS5 desbloqueado que baixa da sua nuvem do **TorBox** direto para o SSD interno, USB ou armazenamento estendido. Ele extrai os arquivos, organiza o que foi baixado e mostra o que está ocupando espaço. Você usa pelo controle, na TV, ou pelo celular.

![Painel](docs/screens/home.jpg)

## O que ele faz

| | |
|---|---|
| **Nuvem** | Lista torrents, web e usenet do TorBox, com busca (inclusive pelo nome dos arquivos), filtros e ordenação. Baixa só os arquivos marcados e apaga do TorBox. |
| **Login por QR code** | Conecta o TorBox apontando o celular para a TV, sem digitar token. |
| **Downloads** | Várias conexões por arquivo, retomada, fila salva, limite de velocidade e "baixar quando ficar pronto" no TorBox. |
| **Extração** | ZIP (com senha), 7z, RAR e RAR5, inclusive em várias partes. Pode extrair ao terminar e apagar o compactado. |
| **Arquivos** | Navega por SSD, USB e estendido. Seleção múltipla (□) para copiar, mover, apagar, renomear e extrair; ícones por tipo e ordenação. |
| **Armazenamento** | Uso por tipo, maiores pastas e arquivos, sugestões de limpeza e o tamanho de cada jogo instalado (jogo, atualização e DLC). |
| **Celular** | Página com PIN, na mesma rede, para ver a fila, colar links (magnet, hoster, direto) e baixar da nuvem. |
| **Atualização pelo app** | Aba Sobre: procura a última Release deste repositório, baixa e instala sozinha. |
| **Clima** | Música lo-fi original e efeitos sonoros (dá para desligar), céu animado e fundo próprio na tela inicial do PS5. |

<p>
<img src="docs/screens/cloud.jpg" width="49%"> <img src="docs/screens/files.jpg" width="49%">
<img src="docs/screens/storage.jpg" width="49%"> <img src="docs/screens/about.jpg" width="49%">
</p>

## Requisitos

- PS5 desbloqueado com **etaHEN** e **ShadowMount+**. Testado no firmware 12.40.
- Conta no TorBox, só para a aba Nuvem. Arquivos, Armazenamento e links diretos funcionam sem conta.

## Instalar

1. Baixe o `NimboDownloader-PS5-vX.Y.Z.zip` em [Releases](../../releases).
2. Copie a pasta `PPSA48921` inteira para `/data/homebrew/` no PS5. O jeito mais fácil é pelo FTP do etaHEN (porta 1337), com FileZilla ou um app de FTP no celular.
3. Espere o ShadowMount+ registrar o app: o ícone aparece na tela inicial. Se não aparecer, reinicie o PS5 e rode o etaHEN de novo.
4. Abra o Nimbo e conecte o TorBox pelo QR code.

**Atualizar:** aba **Sobre** > **Procurar atualização** > **Atualizar**. Depois, feche e abra o app.

## Controles

| Botão | Ação |
|---|---|
| ✕ | Selecionar |
| ○ | Voltar / fechar |
| △ | Atualizar a nuvem |
| □ | Buscar (Nuvem) · marcar vários (Arquivos) |
| L1 / R1 | Trocar de aba |

## Estrutura

```
nimbo/            app V2 (PS5 React): index.jsx, src/, assets/, sce_sys/
  src/engine.js   fila de downloads, extração e cópias
  src/torbox.js   API do TorBox
  src/update.js   atualização pelo GitHub
  src/phone.js    servidor e página do celular
tools/            geradores de arte (make_art, make_keyart, make_dds) e música (compose_music)
src/, web/        V1 (payload ELF + interface no navegador)
docs/             LEIA-ME e prints
```

## Compilar

O app é feito com **PS5 React** (React sobre QuickJS, renderização nativa em 1080p).

```bash
# dentro do PS5 React
python3 tools/cli.py dev   --app-dir /caminho/nimbo-ps5/nimbo   # prévia no PC
python3 tools/cli.py build --app-dir /caminho/nimbo-ps5/nimbo   # gera dist/PPSA48921
```

A arte e a música são geradas pelos scripts em `tools/`. A tela inicial do PS5 usa `sce_sys/pic0.dds` (3840×2160, BC7), criado por `tools/make_dds.py`.

**Publicar uma versão:** troque `APP_VERSION` em `nimbo/src/update.js` e `version` em `nimbo/app.json`, compile e crie uma Release com a tag `vX.Y.Z` e o zip anexado. O nome do zip precisa conter "PS5" e a pasta `PPSA48921` dentro dele, porque é isso que o app procura para se atualizar.

## Versão 1 (legado)

A primeira versão era um payload ELF (`nimbo-ps5.elf`), rodado pelo PS5 Payload Manager, com a interface aberta no navegador do PS5. O código continua em `src/` e `web/`. Para compilar: `./scripts/build-deps-ps5.sh && make ps5 && ./scripts/package.sh` (SDK em `/opt/ps5-payload-sdk`).

## Aviso legal

O Nimbo Downloader é um **gerenciador de downloads e de arquivos**. Ele não fornece, hospeda, indexa nem indica nenhum conteúdo. Ele só transfere arquivos que o próprio usuário guardou na conta dele em um serviço de terceiros, ou links que o próprio usuário informou.

- O app **não foi criado para pirataria** nem para contornar proteção de direitos autorais, e o autor não apoia esse uso. A finalidade é baixar e organizar conteúdo que você tem o direito de usar: seus backups, homebrew, software livre, mídia de domínio público ou conteúdo adquirido legalmente.
- **A responsabilidade pelo que é baixado é exclusivamente do usuário.** Cabe a ele cumprir as leis do seu país e os termos de uso dos serviços que usa (TorBox e outros).
- Desbloquear o console pode violar os termos de uso do fabricante, anular a garantia e trazer riscos ao aparelho. Faça isso por sua conta e risco.
- Projeto pessoal e independente, **sem vínculo** com Sony Interactive Entertainment, PlayStation, TorBox ou qualquer serviço citado. Marcas citadas pertencem aos seus donos.
- O software é fornecido **"como está", sem garantias**, nos termos da licença GPLv3. O autor não responde por perda de dados, danos ao console ou mau uso.

## Licença

GPLv3. Fonte Nunito (SIL OFL), qrcode-generator (MIT). A V1 usa cJSON, curl, mbedTLS, libarchive, zlib e xz.
