# Nimbo Downloader (PS5)

App homebrew para PS5 (etaHEN + ShadowMount+), feito com **PS5 React** (React sobre QuickJS, renderização nativa 1080p). Título `PPSA48921`. Código, comentários, commits e textos da interface em **português do Brasil**.

`nimbo/` é o app atual (V2). `src/` e `web/` na raiz são a V1 (payload ELF + navegador), parada; não mexer sem pedido.

## SDK e compilação

- SDK: **https://github.com/JVK3R/ps5-react** (continuação do half144/ps5-react, que saiu do ar). Docs da API em `docs/NATIVE-API.md`, animação em `docs/ANIMATION.md`.
- Ambiente: WSL 2 com **Ubuntu-24.04** (`wsl -d Ubuntu-24.04`). O SDK fica clonado em `~/ps5-react` dentro do WSL (não em `/mnt/c`: muito lento).
- Prévia no PC: `CC=clang CXX=clang++ python3 tools/cli.py preview --app-dir /mnt/c/Users/felip/nimbo-ps5/nimbo` (setas = direcional, Enter = ✕, Backspace = ○).
- Pacote do PS5: `python3 tools/cli.py build --app-dir ...` gera `dist/PPSA48921`.
- Checagem rápida de sintaxe sem o SDK: `npx esbuild@0.24.0 <arquivo> --loader:.js=jsx`.

## Limites do renderizador (importante)

- Tudo é rasterizado na **CPU**, na mesma thread do JS. Animação custa a área redesenhada por quadro, **mais tudo que estiver por cima** (painéis translúcidos, texto).
- Por isso as nuvens do fundo são **estáticas**, pintadas no `assets/art/sky.png` por `tools/make_clouds.py` (base sem nuvens: `tools/sky_base.png`). Não animar elementos grandes atrás dos painéis.
- `translate` é barato; `opacity` e `scale` em áreas grandes são caros. Loops (`repeat: Infinity`) só em coisas pequenas.
- `setState`/`store.set` frequentes redesenham o app inteiro e atrasam a música (os trechos de áudio se emendam por timer). Progresso de download/extração passa por `liveProgress` no `engine.js` (no máximo 1 atualização/s); a fila grava em disco a cada 3 s, sem `sync`.

## Pontos do código

- `nimbo/src/engine.js`: fila. Duas vagas: `cj` (download) e `ct` (extrair/copiar/mover). Por padrão uma por vez; com `extractWhileDownloading`, extração roda junto com download.
- `nimbo/src/update.js`: atualização pelo GitHub. Usa o **ID do repositório** (`/repositories/1450019000/...`), que não muda com renomeação; o `Http` do PS5 não segue redirecionamento 301.
- `nimbo/src/store.js`: stores `config`, `queue` (persistidos, com cópia em `/data/nimbo-settings`) e `ui` (volátil).
- `nimbo/src/lightbar.js`: cor da luz do controle conforme o estado da fila.
- Navegação: focar uma aba troca de tela; ver `expectTab` em `index.jsx` antes de mexer no foco da barra de abas.

## Traduções

O texto em português é a chave. Edite `tools/i18n.tsv` (pt, en, es, fr, de, it, separado por tab) e rode `PYTHONUTF8=1 python tools/i18n.py build`, que gera `nimbo/src/i18n/strings.js` e lista o que falta. Deve terminar com "0 faltando".

## Publicar versão

1. `APP_VERSION` em `nimbo/src/update.js` e `version` em `nimbo/app.json` (`2.2.3` → `02.230.000`).
2. Compilar e zipar com a pasta `PPSA48921` dentro; o nome do zip precisa conter "PS5" (ex.: `NimboDownloader-PS5-v2.2.3.zip`).
3. Release no GitHub `searonff/nimbo-ps5` com tag `vX.Y.Z` e o zip anexado. O texto da release aparece no app como "Novidades".
