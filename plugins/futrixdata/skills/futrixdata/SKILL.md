---
name: futrixdata
description: Use FutrixData Desktop from Codex to inspect and query authorized local datasources through FutrixData MCP tools.
---

# FutrixData

Use this skill when the user asks Codex to inspect FutrixData datasources, describe schemas, run safe read queries, or use FutrixData managed MCP tools.

## Runtime Dependency

FutrixData Desktop is required. Do not ask the user to install a standalone FutrixData CLI.

The plugin includes a FutrixData MCP sidecar. Before local authorization it exposes
setup tools; after authorization it proxies to FutrixData Desktop's bundled MCP server.

The supported setup path is:

1. Install FutrixData Desktop from `https://futrixdata.com/download?source=codex-plugin`.
2. Open FutrixData Desktop once so it can prepare its bundled CLI bridge.
3. Authorize Codex through FutrixData Desktop.
4. Reload Codex or start a new Codex thread so the FutrixData MCP tools are discovered.

## Plugin Setup Tools

When FutrixData datasource tools are unavailable, call:

- `futrixdata_setup_status` to inspect the local setup state.
- `futrixdata_open_download_page` if FutrixData Desktop or the bundled CLI bridge is missing.
- `futrixdata_open_authorization` if Desktop is installed but Codex is not authorized.

The setup server may also open the download or authorization URL once when it starts, so the user
does not have to find the correct setup page manually.

## Readiness Check

When FutrixData tools are unavailable, ask Codex to run:

```bash
futrixdata-cli codex status --json
```

Interpret the result as:

- `desktopInstalled: false` means the user must install FutrixData Desktop.
- `cliReady: false` means Desktop has not prepared a valid bundled CLI bridge yet, or the bridge points to a missing app.
- `desktopRunning: false` means FutrixData Desktop should be opened.
- `codexAuthorized: false` means the user should authorize Codex from FutrixData Desktop.

## Safety Boundary

Do not request database credentials from the user. Do not read FutrixData datasource files directly. Use FutrixData MCP tools after the Desktop authorization flow has configured Codex.

Risky or write operations remain subject to FutrixData approval, sensitivity, trust, and audit controls.
