# Nimbo Downloader para PS5

[English](README.md) · **Português (Brasil)**

App nativo para PS5 desbloqueado que baixa da sua nuvem (**TorBox, Real-Debrid, AllDebrid e Premiumize**) direto para o SSD interno, USB ou armazenamento estendido. Ele extrai os arquivos, organiza o que foi baixado e mostra o que está ocupando espaço. Você usa pelo controle, na TV, ou pelo celular.

![Painel](docs/screens/pt-BR/home.jpg)

## O que ele faz

| | |
|---|---|
| **Nuvem** | Junta TorBox, Real-Debrid, AllDebrid e Premiumize numa lista só, com busca (inclusive pelo nome dos arquivos), filtros por serviço e ordenação. Cada item mostra o tipo do conteúdo e por onde chegou ao serviço (ex.: "Jogo · via Web"). Baixa só os arquivos marcados e pode apagar da nuvem depois. A lista carrega mais itens sozinha ao chegar no fim, sem botão "Mostrar mais". |
| **Login por QR code** | TorBox, Real-Debrid e AllDebrid conectam apontando o celular para a TV. Premiumize usa a chave da API, digitada no PS5 ou colada pelo celular. |
| **Downloads** | Várias conexões por arquivo, retomada, fila salva, limite de velocidade, painel com as etapas (baixar › extrair › pronto) e a atual em destaque e "baixar quando ficar pronto" na nuvem. Cancelar apaga o pedaço baixado e a pasta que ficou vazia. O Painel destaca o próximo item pronto na nuvem (um aperto em Baixar e começa), numera a fila, avisa falhas e quando a fila não cabe no disco. As capas mostram o título limpo da release, o tipo (jogo, série, filme, compactado, música) e etiquetas como ID do jogo, versão, temporada e resolução. |
| **Extração** | ZIP (com senha), 7z, RAR e RAR5, inclusive em várias partes. Pode extrair ao terminar, apagar o compactado e tirar os arquivos das subpastas (tudo solto na pasta escolhida). Senhas de arquivos salvas podem ser adicionadas, editadas e apagadas. |
| **Arquivos** | Navega por SSD, USB e estendido. Botão **Selecionar** (ou □) marca vários arquivos e pastas para copiar, mover, apagar, renomear e extrair. Mostra o nome do jogo ao lado de arquivos como `PPSA07784.ffpfsc`, a data de cada arquivo, ícones desenhados por tipo, ordenação e filtro por tipo (pastas, vídeos, compactados, pacotes, áudio, imagens). Com itens marcados, o Triângulo abre as ações (mover, copiar, apagar, tirar arquivos das pastas) de qualquer ponto da lista. |
| **Armazenamento** | Uso por tipo, maiores pastas e arquivos (com nome do jogo e data), sugestões de limpeza e, para cada jogo instalado, versão, data de instalação e tamanho do jogo, da atualização e das DLCs. Apagar roda em segundo plano, sem travar a tela. |
| **Celular** | Página com PIN, na mesma rede, para ver a fila, colar links (magnet, hoster, direto) em qualquer serviço conectado e baixar da nuvem. Abas embaixo, no alcance do polegar, e o download ativo em destaque. |
| **Idiomas** | Português (Brasil), English, Español, Français, Deutsch e Italiano, inclusive na página do celular. Segue o idioma do PS5 na primeira vez. |
| **Atualização automática** | Procura novas Releases deste repositório a cada 6 h e instala sozinha quando não há downloads rodando. Avisa quando há versão nova (faixa no topo e notificação do PS5), mostra o andamento enquanto instala e mostra as novidades de cada versão em **Sobre › O que há de novo**. |
| **Cópia de segurança dos ajustes** | Logins, ajustes e fila também ficam em `/data/nimbo-settings`, e voltam se você excluir o app pelo menu do PS5 e instalar de novo. |
| **Luz do controle** | Mostra o estado da fila: âmbar baixando, roxo extraindo ou copiando, verde quando termina e vermelho se algo falhar. |
| **Clima** | Música lo-fi (CC0) e sons da interface, com volume e opção de desligar. Painéis translúcidos sobre um céu com nuvens, e fundo próprio na tela inicial do PS5. |

<p>
<img src="docs/screens/pt-BR/cloud.jpg" width="49%"> <img src="docs/screens/pt-BR/files.jpg" width="49%">
<img src="docs/screens/pt-BR/storage.jpg" width="49%"> <img src="docs/screens/pt-BR/about.jpg" width="49%">
</p>

## Requisitos

- PS5 desbloqueado com **etaHEN** e **ShadowMount+**. Testado no firmware 12.40.
- Conta em pelo menos um serviço (TorBox, Real-Debrid, AllDebrid ou Premiumize), só para a aba Nuvem. Arquivos, Armazenamento e links diretos funcionam sem conta.

## Instalar

1. Baixe o `NimboDownloader-PS5-vX.Y.Z.zip` em [Releases](../../releases).
2. Copie a pasta `PPSA48921` inteira para `/data/homebrew/` no PS5. O jeito mais fácil é pelo FTP do etaHEN (porta 1337), com FileZilla ou um app de FTP no celular.
3. Espere o ShadowMount+ registrar o app: o ícone aparece na tela inicial. Se não aparecer, reinicie o PS5 e rode o etaHEN de novo.
4. Abra o Nimbo e conecte seu serviço em **Ajustes › Serviços de nuvem**.

**Atualizar:** é automático (desligue em **Sobre › Atualizar sozinho**). Para forçar: **Sobre › Procurar atualização › Atualizar**. Depois, feche e abra o app. Para atualizar à mão, substitua a pasta `PPSA48921` pelo FTP; não precisa excluir o app pelo menu do PS5.

> **Atualizando da 2.2.6 ou anterior?** Se aparecer "no such file or directory", feche e abra o app e atualize de novo. Acontecia quando a atualização automática e o botão Atualizar rodavam juntos; corrigido na 2.2.7.

> **Vindo da 2.2.2 ou anterior?** Instale a 2.2.3 à mão uma vez: as versões antigas procuram atualização no endereço antigo do repositório. Da 2.2.3 em diante, a atualização automática funciona.

## Controles

| Botão | Ação |
|---|---|
| ✕ | Selecionar |
| ○ | Voltar / fechar · pasta acima (Arquivos) |
| △ | Atualizar a nuvem · filtrar ou abrir ações da seleção (Arquivos) · ação principal da janela aberta (Baixar, Usar esta pasta, Adicionar senha) |
| □ | Buscar (Nuvem) · selecionar vários (Arquivos) · ação secundária da janela (Nova pasta, Marcar todos) |
| L1 / R1 | Trocar de aba |

O touchpad fica desligado, para não mover o cursor sem querer.

## Estrutura

```
nimbo/            app V2 (PS5 React): index.jsx, src/, assets/, sce_sys/
  src/engine.js   fila de downloads, extração e cópias
  src/torbox.js   API do TorBox
  src/debrid/     Real-Debrid, AllDebrid, Premiumize e a interface comum dos serviços
  src/i18n.js     idiomas (traduções em src/i18n/strings.js, geradas de tools/i18n.tsv)
  src/music.jsx   música de fundo (assets/music: a faixa CC0 em trechos WAV)
  src/update.js   atualização pelo GitHub
  src/phone.js    servidor e página do celular
tools/            geradores de arte (make_art, make_keyart, make_dds) e i18n.py (traduções)
src/, web/        V1 (payload ELF + interface no navegador)
docs/             LEIA-ME e prints
```

## Compilar

O app é feito com **[PS5 React](https://github.com/JVK3R/ps5-react)** (React sobre QuickJS, renderização nativa em 1080p). No Windows, use o WSL 2 com Ubuntu e clone o SDK dentro do Linux (`~/`), não em `/mnt/c`.

```bash
# dentro do PS5 React
CC=clang CXX=clang++ python3 tools/cli.py preview --app-dir /caminho/nimbo-ps5/nimbo   # prévia no PC
CC=clang CXX=clang++ python3 tools/cli.py build   --app-dir /caminho/nimbo-ps5/nimbo   # gera dist/PPSA48921
```

A arte é gerada pelos scripts em `tools/`. A tela inicial do PS5 usa `sce_sys/pic0.dds` (3840×2160, BC7), criado por `tools/make_dds.py`.

**Traduções:** edite `tools/i18n.tsv` (o texto em português é a chave) e rode `python3 tools/i18n.py build`, que gera `nimbo/src/i18n/strings.js` e avisa o que faltar.

**Publicar uma versão:** troque `APP_VERSION` em `nimbo/src/update.js` e `version` em `nimbo/app.json`, compile e crie uma Release com a tag `vX.Y.Z` e o zip anexado. O nome do zip precisa conter "PS5" e a pasta `PPSA48921` dentro dele, porque é isso que o app procura para se atualizar.

## Versão 1 (legado)

A primeira versão era um payload ELF (`nimbo-ps5.elf`), rodado pelo PS5 Payload Manager, com a interface aberta no navegador do PS5. O código continua em `src/` e `web/`. Para compilar: `./scripts/build-deps-ps5.sh && make ps5 && ./scripts/package.sh` (SDK em `/opt/ps5-payload-sdk`).

## Aviso legal

O Nimbo Downloader é um **gerenciador de downloads e de arquivos**. Ele não fornece, hospeda, indexa nem indica nenhum conteúdo. Ele só transfere arquivos que o próprio usuário guardou na conta dele em um serviço de terceiros, ou links que o próprio usuário informou.

- O app **não foi criado para pirataria** nem para contornar proteção de direitos autorais, e o autor não apoia esse uso. A finalidade é baixar e organizar conteúdo que você tem o direito de usar: seus backups, homebrew, software livre, mídia de domínio público ou conteúdo adquirido legalmente.
- **A responsabilidade pelo que é baixado é exclusivamente do usuário.** Cabe a ele cumprir as leis do seu país e os termos de uso dos serviços que usa (TorBox, Real-Debrid, AllDebrid, Premiumize e outros).
- Desbloquear o console pode violar os termos de uso do fabricante, anular a garantia e trazer riscos ao aparelho. Faça isso por sua conta e risco.
- Projeto pessoal e independente, **sem vínculo** com Sony Interactive Entertainment, PlayStation, TorBox, Real-Debrid, AllDebrid, Premiumize ou qualquer serviço citado. Marcas citadas pertencem aos seus donos.
- O software é fornecido **"como está", sem garantias**, nos termos da licença GPLv3. O autor não responde por perda de dados, danos ao console ou mau uso.

## Créditos e licenças

O Nimbo é GPLv3. Tudo o que vem de terceiros tem licença que permite usar e redistribuir, e está listado em **[CREDITS.md](CREDITS.md)**:

- **Música:** “Chill lofi inspired”, de omfgdude ([OpenGameArt](https://opengameart.org/content/chill-lofi-inspired)), **CC0** (domínio público: uso livre, inclusive comercial, sem exigir crédito).
- **Sons da interface:** Google Material Design sound resources, **CC BY 4.0** (crédito no app e no CREDITS.md).
- **Fonte:** Nunito, **SIL OFL 1.1**.
- **Framework:** PS5 React, de half144 e colaboradores (hoje continuado em https://github.com/JVK3R/ps5-react), GPLv3.
- **qrcode-generator** (MIT). A V1 usa cJSON, curl, mbedTLS, libarchive, zlib e xz.

Os créditos também aparecem no app, na aba **Sobre**.
