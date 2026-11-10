# VEXB 0.5.0

VEXB is a desktop builder for Vortex game extensions. It can read an installed Unreal Engine game to fill in the basics (see [Auto-Fill](#auto-fill-unreal-engine)), collects game metadata, detection IDs, a primary mod destination, additional deployment targets, installer behavior, tools, and game artwork, then validates and exports a Vortex-ready ZIP containing `index.js`, `info.json`, `gameart.png`, and `vexb.json` at the archive root, or writes the same files straight into Vortex's plugins folder.

## Auto-Fill (Unreal Engine)

**Auto-Fill** (top bar, and the card on **Game details**) reads an installed Unreal Engine game and proposes the baseline settings. Pick the install folder; a folder inside it (such as `<Project>/Binaries/Win64`) or a Game Pass folder with the game under `Content` also works. Nothing is written until the review dialog's **Apply**: rows for empty or default fields start checked, and rows that would replace a value already entered start unchecked and show the current value.

What it reads from the install:

- **Unreal project**: the folder beside `Engine` that has `Binaries/Win64` (or `Binaries/WinGDK` for Game Pass) and `Content/Paks`.
- **Game executable**: the launcher at the install root (`<Project>.exe`, the store's launch entry, or the only executable there), otherwise the shipping executable. Uninstallers, crash reporters, prerequisite installers and anti-cheat bootstrappers are ignored.
- **Required files**: the launcher plus `<Project>/Binaries/Win64/<Project>-Win64-Shipping.exe`.
- **Store IDs**: Steam from the library's `appmanifest_*.acf` (or `steam_appid.txt`), GOG from `goggame-*.info`, Epic from `.egstore` and the Epic Games Launcher manifests (the `AppName` Vortex matches on), Xbox from `MicrosoftGame.config` / `appxmanifest.xml` (the package identity name).
- **UE4SS**: whether it's installed in a `ue4ss` folder (3.x) or beside the executable (older builds), and which proxy DLL it uses.
- **Paks**: whether the game uses IoStore (`.utoc`/`.ucas`).

What it looks up online (each lookup is optional; failures are listed in the dialog and the rest still fills in):

- **Nexus game ID and name** from Nexus Mods' public game list (cached for a day in the VEXB profile). A game that isn't listed gets an ID made from its name, flagged as a guess.
- **Steam App ID** from a Steam store search, and **GOG App ID** from a GOG catalog search, when the install belongs to another store. Only exact title matches are used.
- **Game artwork** from the game's Steam library hero image, which Steam requires to be free of text and logos. It's centre-cropped to a 640 × 360 PNG; check it before release.

What it fills in (the same layout as the Rollout Inline extension):

| Setting | Value |
|---|---|
| Primary mod destination | `.` (archives are routed by the targets below) |
| Launch through Steam | on when a Steam App ID is found |
| UE4SS Runtime | `<Project>/Binaries/Win64`, markers `dwmapi.dll`, `ue4ss.dll` (plus `xinput1_3.dll` when the install uses it), priority 10 |
| UE4SS Mods | `<Project>/Binaries/Win64/ue4ss/Mods` (or `Binaries/Win64/Mods` for older UE4SS), markers `**/Scripts/*.lua`, `**/dlls/*.dll`, keeps archive layout, priority 20 |
| PAK Mods | `<Project>/Content/Paks`, markers `*.pak` plus `*.utoc`/`*.ucas` for IoStore games, priority 20 |
| Logic Mods | `<Project>/Content/Paks/LogicMods`, same markers, required archive path `LogicMods/**`, priority 19 |
| Install behavior | normalize `.pak` archives (priority 25), mixed archives, keep unclaimed files, create and maintain deployment folders |

Targets with the same ID as an existing target replace it; other targets are kept. Author, version, the sidebar icon and UE4SS signature files are left to you. Unity games are recognised and turned away for now.

## Suggested paths

Deployment targets VEXB recognizes show **Use suggested** beside their destination, and **Detection & paths** does the same for the primary mod destination of an Unreal game. **Use suggested paths** at the top of **Deployment targets** applies every suggestion at once. A field that already matches says so instead.

For Unreal games the suggestions are built from the game's main folder (the project folder beside `Engine`, such as `RollerSkate`). VEXB finds it in the first path of the form `<Main>/Binaries/Win64/...`, `<Main>/Binaries/WinGDK/...` or `<Main>/Content/Paks/...` among the required files, the game executable, the deployment targets, the bundled tool and the signatures folder. Failing that, a root launcher such as `RollerSkate.exe` is taken as the folder name once an Unreal target exists. **Deployment targets** shows which folder was found and where it came from.

| Target | Suggested destination |
|---|---|
| UE4SS loader | `<Main>/Binaries/Win64` |
| UE4SS mods | `<Main>/Binaries/Win64/ue4ss/Mods` (UE4SS 3.x; older builds keep `Mods` beside the executable) |
| PAK files | `<Main>/Content/Paks` |
| LogicMods | `<Main>/Content/Paks/LogicMods` |
| BepInEx loader | `.` |
| BepInEx plugins | `BepInEx/plugins` |
| BepInEx patchers | `BepInEx/patchers` |
| Game root | `.` |
| Primary mod destination (Unreal) | `.` |

Game Pass builds use `Binaries/WinGDK` in place of `Binaries/Win64`. Targets are recognized by their ID (`ue4ss-loader`, `ue4ss-mods`, `pak-mods`, `logic-mods`, `bepinex`, `bepinex-plugins`, `bepinex-patchers`, `game-root`) or, for custom targets, by words in the ID or name (`logic`, `ue4ss`, `pak`, `bepinex` with `plugin` or `patcher`). Adding a quick-start target whose folder depends on the game fills in the suggestion straight away when the main folder is known.

The quick starts now include **LogicMods** (`*.pak`, `*.utoc`, `*.ucas` under `LogicMods/**`, priority 19), **BepInEx loader** (`winhttp.dll`, `doorstop_config.ini` to the game root, priority 10) and **BepInEx patchers** (`*.dll` under `patchers/**`, priority 19). **PAK files** also matches `.utoc`/`.ucas`, and **UE4SS loader** matches `dwmapi.dll`, `xinput1_3.dll` and `ue4ss.dll`.

## Deployment targets

The primary destination handles the usual mod folder (for example an Unreal Engine PAK directory). The **Deployment targets** step adds separate Vortex mod types and optional archive routing for destinations such as:

- UE4SS itself beside the real game executable
- the matching UE4SS `Mods` directory for Lua and C++ mods
- a distinct PAK or Lua destination
- `BepInEx/plugins`
- any custom path relative to the game directory

Each target can create its folder, preserve its archive layout, and use marker files or globs to route matching archives. **Keep archive layout** keeps the mod's own folder (found from the marker, e.g. the folder holding `Scripts/`) and everything inside it, while dropping wrapper folders above it, so an archive packed with the full game path (`Game/Binaries/Win64/ue4ss/Mods/MyMod/...`) installs the same as one opening straight to `MyMod/...`. A marker that spells out a longer path keeps that path. A target with no marker remains available as a manual Vortex mod-type choice.

## Launch through Steam

Entering a **Steam App ID** only records it for Steam integration (`environment.SteamAPPId` and `details.steamAppId`); Vortex still starts the executable directly. Games that depend on Steam Input, controller profiles, the Overlay, or Steam DRM can lose those features when started that way.

Turn on **Launch through Steam** (Detection & paths, available once a numeric Steam App ID is entered) to generate a `requiresLauncher` callback. Vortex then asks the Steam client to launch the game when the installation belongs to Steam:

- store reported as `steam`: launched through Steam
- store reported as anything else (GOG, Epic, Xbox, …): launched normally
- store unknown: launched through Steam only when the discovered folder is the Steam installation of that App ID (compared case-insensitively, ignoring separator differences)

Game discovery is unchanged, so non-Steam copies are still found through the store IDs. The option is off by default and for older drafts.

## Required archive paths

Archive markers say what a target's files look like; a **Required archive path / folder** says where they must sit inside the archive. A target with both only claims an archive when one file matches a marker *and* the path rule, so two targets can share `*.pak`, `*.utoc`, `*.ucas` and still route differently.

- `LogicMods/*` matches `LogicMods/CoolMod.pak` (also under a wrapper such as `CoolMod-v1/LogicMods/`), but not `CoolMod.pak` or `Other/CoolMod.pak`.
- `*` stays within one folder and `**` spans any depth; a rule without wildcards, such as `LogicMods`, means everything under that folder.
- Matching ignores case, accepts `\` or `/`, and drops a leading `./`. Absolute paths and `..` are rejected.

With **Keep archive layout** off, the folder matched by the rule is the part that gets stripped, so `LogicMods/CoolMod.pak` deploys as `<destination>/CoolMod.pak`. With it on, the archive's full layout is kept as before. Give a path-restricted target a lower priority number than a general target that shares its markers; VEXB shows a warning when the order is the other way around. Targets without a rule behave exactly as before.

## Mixed mod archives

A Vortex mod has exactly one mod type, so an archive holding content for several deployment targets (for example PAK files plus a UE4SS mod folder) can't be installed as any single target. With **Support mixed mod archives** on (Install behavior; default for new projects), the generated extension handles these as one mod:

1. **Classification.** Targets with archive markers are tried in priority order (lowest number first). Each marker hit defines a region:
   - a target with a required archive path claims the folder that rule matched;
   - a marker that names a file or folder layout (`enabled.txt`, `xinput1_3.dll`, `Scripts/*.lua`) claims the folder above that layout, so `Pack/MyMod/Scripts/main.lua` claims everything in `Pack/MyMod`;
   - a bare file type (`*.pak`) claims the matching files in that folder plus same-named companions matched by the target's markers (`Foo.pak`, `Foo.utoc`, `Foo.ucas`).

   A file claimed by a higher-priority target is never claimed again. Files outside every region, such as an archive-level `README.txt`, are left out unless **Keep files no target claims** is on (see below).
2. **Selection.** A mixed installer runs before the per-target installers. It only accepts an archive when two or more targets receive files; otherwise the normal single-target installers handle it exactly as before.
3. **Destinations.** Every file is copied to `<target destination>/<path inside region>`, relative to the game folder, and the mod gets the single type `<game-id>-mixed`, which deploys to the game folder. With **Keep archive layout** off, a target strips the same root a single-target install would; with it on, the region's own folder is kept (so wrappers above it are still dropped).
4. **Safety.** Archive paths containing `..` or an absolute root, destinations that would leave the game folder, and two files resolving to the same destination all fail the install with a clear message.

### Keep files no target claims

With **Keep files no target claims** on (shown under the mixed archive option; on for new projects, off for older drafts), files that no target recognizes are installed instead of dropped. They keep the archive's own layout relative to the game folder, so `CustomMusic/song.ogg` deploys to `<game>/CustomMusic/song.ogg`.

- Files directly beside a claimed file type (a `readme.txt` next to `Foo.pak`) belong to that mod and are still left out, as in a single-target install.
- Readme, changelog, license, `.md`, `.pdf`, and `.url` files at the top of the archive are skipped.
- When every file sits inside one top-level folder that the game folder doesn't have (`MyMod-v1.2/...`), that wrapper is dropped. If the game does have a folder of that name (`RollerSkate/...`), the archive is treated as laid out like the game and nothing is dropped.
- An archive with only one recognized target plus extra files is also installed by the mixed installer, so a PAK mod that ships a `CustomMusic` folder keeps it. Archives with no extra files still go to the single-target installers exactly as before.
- The same safety checks apply: `..` or absolute paths and duplicate destinations fail the install.

The mixed type never claims mods on its own and is not added to deployment-directory maintenance; each target's folder is still maintained as usual. The target ID `mixed` is reserved while the option is on. Older drafts load with it off, and projects with fewer than two marker targets generate no mixed code.

## Maintain deployment directories

**Detection & paths** includes a **Maintain deployment directories** switch (on by default for new projects). When enabled, the generated extension builds its folder list from the same values it registers with Vortex (the primary mod path plus every `DEPLOYMENT_TARGETS` entry), deduplicates it, skips root destinations, and calls `fs.ensureDirWritableAsync` on each folder:

- during game setup, alongside any other setup work, and
- after a Vortex purge of a profile for this game (`did-purge`), so a folder removed by the purge cannot leave Hardlink Deployment reporting "Can't write to output directory".

Purge-time failures are logged as warnings with the game ID, folder, and error instead of interrupting Vortex. Drafts saved before this option existed load with it off, so their output is unchanged until it is turned on. Per-target **Create this folder** settings are unaffected.

## UE4SS signature files

When UE4SS can't find engine functions in a game on its own, custom AOB signature scripts (for example `GUObjectArray.lua` or `FName_ToString.lua`) go in its `UE4SS_Signatures` folder. Turn on **Bundle UE4SS signature files** in **Install behavior** and add the `.lua` files; they are saved with the draft and packed into `UE4SS_Signatures/` inside the extension ZIP.

The generated extension copies them into the game:

- during game setup, and
- after every Vortex deployment of a profile for this game (`did-deploy`), restoring any file that was deleted or overwritten. Other files already in the folder are left alone.

The folder defaults to `<UE4SS loader destination>/ue4ss/UE4SS_Signatures` (the UE4SS 3.x layout) when a target with the ID `ue4ss-loader` exists. Enter a different path relative to the game for other layouts; older UE4SS builds keep `UE4SS_Signatures` beside `UE4SS.dll`. Vortex doesn't track these copies, so they stay in place after a purge. Copy failures after a deployment are logged as warnings rather than shown as errors.

## Projects and recent extensions

Every extension you work on is a project. The project picker in the top bar lists the most recently opened ones, so switching between extensions is two clicks; **New project** starts a blank one without discarding the current one. **Projects & extensions** in the sidebar shows every saved project, and the bin icon on a card removes the project from VEXB without touching anything installed in Vortex.

Projects, including their artwork, sidebar icon, and signature files, are stored in the VEXB app profile (`%APPDATA%\vexb\projects`). The open project is also mirrored to local storage while you type, so VEXB restores it after reopening or an unexpected close. When run in a plain browser (`npm run dev`), projects are kept in local storage instead and images may be dropped if storage fills up.

## Editing installed Vortex extensions

**Projects & extensions** also lists the extensions in Vortex's plugins folder (`%APPDATA%\Vortex\plugins` by default; use **Change…** for shared-mode or portable installs). Non-game extensions are hidden unless you tick the checkbox under the filter. Each extension is labelled:

- **VEXB project**: has a `vexb.json` next to `index.js`, so every setting reopens exactly as saved.
- **VEXB output**: built by an older VEXB without `vexb.json`. Settings are read back from the generated `index.js` (targets, store IDs, mixed archives, signatures, and so on).
- **Hand-written**: anything else. VEXB reads what it can recognise (game ID, name, executable, mod path, required files, store IDs) and lists what it couldn't, so fill those in before writing it back.

**Edit** opens the extension as a project linked to its folder. Once a folder is linked, the row shows **Open project**, and the refresh icon reloads the project from what's on disk. Images that aren't a 640 × 360 PNG (many extensions ship `gameart.jpg`) have to be replaced before the package checks pass.

On **Review & export**, **Install in Vortex** / **Update in Vortex** writes the package straight into the plugins folder: the linked folder, or `game-<game id>-<version>` for a new project. A linked folder whose name ends in the installed version (`game-rollout-inline-0.2.0`) is renamed to the new version (`game-rollout-inline-0.2.1`) so the folder name never contradicts `info.json`. If the linked folder has gone (renamed or replaced by an extracted ZIP), VEXB offers to update the one other VEXB-built extension for the same game ID instead of recreating the old folder. Before it writes, VEXB:

- copies every file it is about to replace into `%APPDATA%\vexb\backups\<folder>\<time>`,
- keeps the fields Vortex adds to `info.json` (`modId`, `fileId`, `type`, `path`, ...) so update checks keep working,
- asks first if the folder already exists and isn't linked, if the extension was hand-written (its `index.js` is replaced), or if another installed extension registers the same game ID.

Restart Vortex afterwards; it only loads extensions at startup. Files VEXB doesn't generate are left in place.

Every ZIP and every in-place install now includes `vexb.json`, which holds the project settings. Vortex ignores it.

## Sidebar icon

Vortex has no dedicated square-icon field. Its game sidebar uses a logo stored on the game's discovery entry before the extension's registered logo, so without one it shows a crop of the 16:9 `gameart.png`.

The **Game artwork** step accepts an optional square PNG (at least 128 × 128, 256 × 256 recommended, under 1 MB). It is packed as `gameicon.png`, and the generated extension sets it as the discovery logo with `actions.setGameParameters` once the game is discovered, reapplying it if the discovery entry is rewritten. Game tiles and profile cards keep `gameart.png`. If Nexus Mods has a thumbnail for the game, Vortex downloads it and prefers it in the sidebar.

Because the discovery logo is saved in Vortex's settings, a later version of the extension that drops the icon still points at `gameicon.png`, and the sidebar will fall back to a placeholder. Keep shipping the file once released.

## Artwork note

VEXB checks PNG type, dimensions, and file size. It does not perform OCR or title detection; “No text or game title” is a manual review item, not a failed check.

## Run the Windows app

The portable test build is generated at:

```text
release/VEXB-0.5.0-portable.exe
```

Double-click the executable to run VEXB. It does not require installation.

## Development

```powershell
npm install
npm run dev
```

Useful commands:

```powershell
npm run build
npm run lint
npm run desktop
npm run package:win
```

## Manual steps

VEXB cannot run or verify generated code inside Vortex, test real game installations or mod archives, authenticate with Nexus Mods or GitHub, upload releases, judge artwork content or licensing, or complete the Nexus Mods human review. The Review & export screen discloses these steps and links to the current official instructions.

The JavaScript creation guide supplied for this project is listed under outdated documentation in the Vortex wiki. VEXB uses its core API patterns but validates packaging against the newer official testing and packaging pages.
