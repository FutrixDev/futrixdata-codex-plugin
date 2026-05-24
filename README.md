# FutrixData Codex Plugin

This repository publishes the FutrixData plugin marketplace for Codex.

FutrixData lets Codex inspect schemas and run approved datasource operations through FutrixData Desktop. The plugin does not store datasource credentials and does not replace the desktop app. FutrixData Desktop remains the local runtime, authorization center, and audit boundary.

## Install

Add this marketplace to Codex:

```bash
codex plugin marketplace add FutrixDev/futrixdata-codex-plugin --ref v0.1.2
```

Then open the Codex plugin directory and install FutrixData.

## Desktop Requirement

FutrixData Desktop is required before the plugin can use datasource tools.

1. Install FutrixData Desktop from `https://futrixdata.com/download?source=codex-plugin`.
2. Open FutrixData Desktop once.
3. Authorize Codex from FutrixData Desktop.
4. Reload Codex or start a new Codex thread.

Do not install a separate FutrixData CLI. FutrixData Desktop prepares the local CLI bridge used by Codex.

## Cold Start From Codex

The plugin ships a lightweight FutrixData MCP sidecar.

- If FutrixData Desktop or the bundled CLI bridge is missing, the setup server opens `https://futrixdata.com/download?source=codex-plugin`.
- If FutrixData is installed but Codex is not authorized, the setup server opens `futrixdata://codex/connect?source=codex-plugin`.
- After the user approves Codex in FutrixData Desktop, reload Codex. The sidecar then proxies to the real FutrixData MCP server with the local per-Codex access key.

The setup server never stores datasource credentials and never contains an agent access key. The per-Codex key is minted locally by FutrixData Desktop during authorization.

## Check Setup

If Codex cannot use FutrixData, run:

```bash
futrixdata-cli codex status --json
```

Common states:

- Desktop is not installed: install FutrixData Desktop from the download link above.
- CLI bridge is not ready: open FutrixData Desktop once.
- Desktop is not running: launch FutrixData Desktop.
- Codex is not authorized: connect Codex from FutrixData Desktop.

## Uninstall Or Revoke

To stop using the plugin, remove FutrixData from the Codex plugin directory.

To revoke local authorization, open FutrixData Desktop and remove the Codex connection from the agent or MCP settings.

## Publishing Notes

The root marketplace file is `.agents/plugins/marketplace.json`. It points to `./plugins/futrixdata`, so the repository can be added as a Git backed Codex marketplace.

The first public tag was `v0.1.0`. Use `v0.1.2` or later for the sidecar readiness fixes that prefer executable CLI paths, avoid stale bridge CLI paths, and harden setup URL launches.
