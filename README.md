# VEXB

VEXB is a desktop builder for basic Vortex game extensions. It collects game metadata, detection IDs, deployment paths, installer behavior, tools, and game artwork, then validates and exports a Vortex-ready ZIP containing `index.js`, `info.json`, and `gameart.png` at the archive root.

## Run the Windows app

The portable test build is generated at:

```text
release/VEXB-0.1.0-portable.exe
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