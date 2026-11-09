# Nimbo Downloader for PS5

**English** · [Português (Brasil)](README.pt-BR.md)

A native app for jailbroken PS5 consoles that downloads from your cloud (**TorBox, Real-Debrid, AllDebrid and Premiumize**) straight to the internal SSD, USB or extended storage. It extracts archives, organizes your downloads and shows what is taking up space. Use it with the controller on the TV, or from your phone.

![Home](docs/screens/home.jpg)

## What it does

| | |
|---|---|
| **Cloud** | Combines TorBox, Real-Debrid, AllDebrid and Premiumize in a single list, with search (including file names inside each item), per-service filters and sorting. Downloads only the files you mark and can delete them from the cloud afterwards. |
| **QR code login** | TorBox, Real-Debrid and AllDebrid connect by pointing your phone at the TV. Premiumize uses its API key, typed on the PS5 or pasted from your phone. |
| **Downloads** | Multiple connections per file, resume, a saved queue, speed limit and "download when ready" for items still being prepared in the cloud. |
| **Extraction** | ZIP (including password-protected), 7z, RAR and RAR5, also split into parts. Can extract when a download finishes and delete the archive afterwards. Saved archive passwords can be added, edited and deleted. |
| **Files** | Browse the SSD, USB and extended storage. The **Select** button (or □) marks several files and folders to copy, move, delete, rename and extract. Shows the game name next to files like `PPSA07784.ffpfsc`, the date of each file, icons by type and sorting. |
| **Storage** | Usage by type, largest folders and files (with game name and date), cleanup suggestions and, for each installed game, version, install date and the size of the game, its updates and DLCs. Deleting runs in the background without freezing the screen. |
| **Phone** | A PIN-protected page on the same network to see the queue, paste links (magnet, file hosts, direct) into any connected service and download from the cloud. |
| **Languages** | Português (Brasil), English, Español, Français, Deutsch and Italiano, including the phone page. Follows the PS5 language on first launch. |
| **Auto-update** | Checks this repository's Releases every 6 hours and installs new versions by itself when no downloads are running. Keeps the previous version so you can roll back. |
| **Backup of your settings** | Logins, settings and the queue are also saved to `/data/nimbo-settings`, so they come back if you delete the app from the PS5 menu and reinstall it. |
| **Ambience** | Lo-fi music (CC0) and interface sounds, with volume control and an off switch. Animated sky and custom art on the PS5 home screen. |

<p>
<img src="docs/screens/cloud.jpg" width="49%"> <img src="docs/screens/files.jpg" width="49%">
<img src="docs/screens/storage.jpg" width="49%"> <img src="docs/screens/about.jpg" width="49%">
</p>

## Requirements

- A jailbroken PS5 with **etaHEN** and **ShadowMount+**. Tested on firmware 12.40.
- An account with at least one service (TorBox, Real-Debrid, AllDebrid or Premiumize), only for the Cloud tab. Files, Storage and direct links work without an account.

## Install

1. Download `NimboDownloader-PS5-vX.Y.Z.zip` from [Releases](../../releases).
2. Copy the whole `PPSA48921` folder to `/data/homebrew/` on the PS5. The easiest way is etaHEN's FTP server (port 1337), using FileZilla or an FTP app on your phone.
3. Wait for ShadowMount+ to register the app: its icon shows up on the home screen. If it doesn't, restart the PS5 and run etaHEN again.
4. Open Nimbo and connect your service in **Settings › Cloud services**.

**Update:** automatic (turn it off in **About › Auto-update**). To force it: **About › Check for updates › Update**. Then close and reopen the app. If the new version misbehaves, use **About › Go back to the previous version**. To update manually, replace the `PPSA48921` folder over FTP; there's no need to delete the app from the PS5 menu.

## Controls

| Button | Action |
|---|---|
| ✕ | Select |
| ○ | Back / close |
| △ | Refresh the cloud |
| □ | Search (Cloud) · select several (Files) |
| L1 / R1 | Switch tab |

## Project layout

```
nimbo/            V2 app (PS5 React): index.jsx, src/, assets/, sce_sys/
  src/engine.js   download queue, extraction and copies
  src/torbox.js   TorBox API
  src/debrid/     Real-Debrid, AllDebrid, Premiumize and the common service interface
  src/i18n.js     languages (translations in src/i18n/strings.js, generated from tools/i18n.tsv)
  src/music.jsx   background music (assets/music: the CC0 track split into WAV segments)
  src/update.js   updates from GitHub
  src/phone.js    phone server and web page
tools/            art generators (make_art, make_keyart, make_dds) and i18n.py (translations)
src/, web/        V1 (ELF payload + browser interface)
docs/             readme files and screenshots
```

## Building

The app is built with **PS5 React** (React on QuickJS, native rendering at 1080p).

```bash
# inside PS5 React
python3 tools/cli.py dev   --app-dir /path/to/nimbo-ps5/nimbo   # preview on the PC
python3 tools/cli.py build --app-dir /path/to/nimbo-ps5/nimbo   # builds dist/PPSA48921
```

The art is generated by the scripts in `tools/`. The PS5 home screen uses `sce_sys/pic0.dds` (3840×2160, BC7), created by `tools/make_dds.py`.

**Translations:** edit `tools/i18n.tsv` (the Portuguese text is the key) and run `python3 tools/i18n.py build`. It generates `nimbo/src/i18n/strings.js` and reports anything missing.

**Publishing a version:** change `APP_VERSION` in `nimbo/src/update.js` and `version` in `nimbo/app.json`, build, and create a Release tagged `vX.Y.Z` with the zip attached. The zip name must contain "PS5" and the `PPSA48921` folder must be inside it, because that's what the app looks for when updating.

## Version 1 (legacy)

The first version was an ELF payload (`nimbo-ps5.elf`) run by PS5 Payload Manager, with its interface opened in the PS5 web browser. The code is still in `src/` and `web/`. To build it: `./scripts/build-deps-ps5.sh && make ps5 && ./scripts/package.sh` (SDK in `/opt/ps5-payload-sdk`).

## Legal notice

Nimbo Downloader is a **download and file manager**. It does not provide, host, index or point to any content. It only transfers files that the user stored in their own account on a third-party service, or links the user entered.

- The app **was not made for piracy** or for circumventing copyright protection, and the author does not endorse such use. Its purpose is to download and organize content you have the right to use: your own backups, homebrew, free software, public-domain media or legally acquired content.
- **The user is solely responsible for what they download.** It is up to the user to follow the laws of their country and the terms of the services they use (TorBox, Real-Debrid, AllDebrid, Premiumize and others).
- Jailbreaking a console may violate the manufacturer's terms of use, void the warranty and put the device at risk. Do it at your own risk.
- This is a personal, independent project with **no affiliation** with Sony Interactive Entertainment, PlayStation, TorBox, Real-Debrid, AllDebrid, Premiumize or any service mentioned. Trademarks belong to their owners.
- The software is provided **"as is", without warranty**, under the GPLv3 license. The author is not liable for data loss, damage to the console or misuse.

The screenshots use free, open content (Blender open movies, Linux distributions, Creative Commons music) and made-up game names.

## Credits and licenses

Nimbo is GPLv3. Everything from third parties is licensed for use and redistribution and is listed in **[CREDITS.md](CREDITS.md)** (in Portuguese):

- **Music:** "Chill lofi inspired" by omfgdude ([OpenGameArt](https://opengameart.org/content/chill-lofi-inspired)), **CC0** (public domain: free to use, including commercially, no credit required).
- **Interface sounds:** Google Material Design sound resources, **CC BY 4.0** (credited in the app and in CREDITS.md).
- **Font:** Nunito, **SIL OFL 1.1**.
- **Framework:** PS5 React by half144 and contributors (https://github.com/half144/ps5-react), GPLv3.
- **qrcode-generator** (MIT). V1 uses cJSON, curl, mbedTLS, libarchive, zlib and xz.

The credits also appear in the app's **About** tab.
