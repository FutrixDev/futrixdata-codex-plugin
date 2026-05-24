#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const DOWNLOAD_URL = 'https://futrixdata.com/download?source=codex-plugin';
export const AUTHORIZE_URL = 'futrixdata://codex/connect?source=codex-plugin';
export const FALLBACK_AUTHORIZE_URL = 'futrix://codex/connect?source=codex-plugin';

const SERVER_INFO = { name: 'futrixdata', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';
const AUTO_OPEN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const TOOL_NAMES = {
  setupStatus: 'futrixdata_setup_status',
  openDownload: 'futrixdata_open_download_page',
  openAuthorization: 'futrixdata_open_authorization',
};

function isExecutable(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function splitPathEnv() {
  const value = process.env.PATH || '';
  return value.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
}

function commandAvailable(command) {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) return isExecutable(command);
  const names = [command];
  if (process.platform === 'win32') {
    const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map(ext => ext.trim())
      .filter(Boolean);
    for (const ext of extensions) {
      if (!command.toLowerCase().endsWith(ext.toLowerCase())) names.push(`${command}${ext}`);
    }
  }
  return splitPathEnv().some(dir => names.some(name => isExecutable(join(dir, name))));
}

export function locateFutrixCLI() {
  const binaryName = process.platform === 'win32' ? 'futrixdata-cli.exe' : 'futrixdata-cli';
  const explicit = (process.env.FUTRIXDATA_CLI_PATH || '').trim();
  const candidates = [];
  if (explicit) candidates.push(explicit);
  for (const dir of splitPathEnv()) {
    candidates.push(join(dir, binaryName));
  }
  if (process.env.FUTRIXDATA_CODEX_PATH_ONLY === '1') {
    return candidates.find(isExecutable) || '';
  }
  const home = homedir();
  if (home) {
    candidates.push(join(home, '.local', 'bin', binaryName));
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
      candidates.push(join(localAppData, 'FutrixData', 'bin', binaryName));
    }
  }
  if (process.platform === 'darwin') {
    candidates.push('/Applications/FutrixData.app/Contents/MacOS/futrixdata-cli');
  }
  candidates.push('/usr/local/bin/futrixdata-cli');
  candidates.push('/opt/homebrew/bin/futrixdata-cli');
  return candidates.find(isExecutable) || '';
}

function runCodexStatus(cliPath) {
  if (!cliPath) {
    return {
      ready: false,
      cliReady: false,
      cliStatus: 'not_found',
      installUrl: DOWNLOAD_URL,
      error: 'futrixdata-cli was not found',
    };
  }
  const result = spawnSync(cliPath, ['codex', 'status', '--json'], {
    encoding: 'utf8',
    timeout: 2500,
    maxBuffer: 512 * 1024,
  });
  if (result.error) {
    return {
      ready: false,
      cliPath,
      cliReady: true,
      cliStatus: 'found_but_status_failed',
      installUrl: DOWNLOAD_URL,
      error: result.error.message,
    };
  }
  const stdout = (result.stdout || '').trim();
  if (result.status !== 0) {
    return {
      ready: false,
      cliPath,
      cliReady: true,
      cliStatus: 'found_but_status_failed',
      installUrl: DOWNLOAD_URL,
      error: (result.stderr || stdout || `futrixdata-cli exited ${result.status}`).trim(),
    };
  }
  try {
    const parsed = JSON.parse(stdout);
    return { ...parsed, cliPath: parsed.cliPath || cliPath, installUrl: parsed.installUrl || DOWNLOAD_URL };
  } catch (error) {
    return {
      ready: false,
      cliPath,
      cliReady: true,
      cliStatus: 'found_but_status_unreadable',
      installUrl: DOWNLOAD_URL,
      error: `Could not parse futrixdata-cli codex status output: ${error.message}`,
    };
  }
}

export function detectSetupStatus() {
  const bridge = readBridgeConfig();
  const bridgeCLIPath = (bridge.cliPath || '').trim();
  const explicitCLIPath = (process.env.FUTRIXDATA_CLI_PATH || '').trim();
  const locatedCLIPath = locateFutrixCLI();
  const cliPath = isExecutable(explicitCLIPath)
    ? explicitCLIPath
    : (isExecutable(bridgeCLIPath) ? bridgeCLIPath : locatedCLIPath);
  const bridgeAccessKey = (bridge.accessKey || '').trim();
  const status = runCodexStatus(cliPath);
  const codexAccessKey = bridgeAccessKey || extractAccessKeyFromCodexConfig();
  const statusKnowsAuthorization = Object.prototype.hasOwnProperty.call(status, 'codexAuthorized')
    && typeof status.codexAuthorizationStatus === 'string';
  const statusKnowsReadiness = Object.prototype.hasOwnProperty.call(status, 'ready');
  const codexAuthorized = Boolean(status.codexAuthorized || (!statusKnowsAuthorization && codexAccessKey));
  const codexAccessKeyBound = Boolean(status.codexAccessKeyBound || codexAccessKey);
  const codexMcpConfigured = Boolean(status.codexMcpConfigured || bridgeAccessKey);
  const needsDownload = status.desktopInstalled === false || status.cliReady === false || !cliPath;
  const needsAuthorization = !needsDownload && !codexAuthorized;
  const payload = {
    ...status,
    ready: statusKnowsReadiness
      ? Boolean(status.ready)
      : Boolean(!needsDownload && codexAuthorized && cliPath),
    cliPath: status.cliPath || cliPath,
    codexAuthorized,
    codexAccessKeyBound,
    codexMcpConfigured,
    needsDownload,
    needsAuthorization,
    downloadUrl: DOWNLOAD_URL,
    authorizeUrl: AUTHORIZE_URL,
    bridgeConfigured: Boolean(bridgeAccessKey),
    bridgePath: bridgeConfigPath(),
  };
  Object.defineProperty(payload, 'accessKey', { value: codexAccessKey, enumerable: false });
  return payload;
}

function bridgeConfigPath() {
  const home = homedir();
  if (!home) return '';
  return join(home, '.futrixdata', 'codex-plugin.json');
}

function readBridgeConfig() {
  const path = bridgeConfigPath();
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function extractAccessKeyFromCodexConfig() {
  const home = homedir();
  if (!home) return '';
  const configPath = join(home, '.codex', 'config.toml');
  if (!existsSync(configPath)) return '';
  let text = '';
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return '';
  }
  const section = text.match(/\[mcp_servers\.futrixdata\]([\s\S]*?)(?:\n\[|$)/);
  if (!section) return '';
  const keyMatch = section[1].match(/--agent-access-key(?:=|",\s*")([A-Za-z0-9_./:-]+)/);
  return keyMatch?.[1]?.trim() || '';
}

function statePath() {
  const home = homedir();
  if (!home) return '';
  return join(home, '.futrixdata', 'codex-plugin-state.json');
}

function readState() {
  const path = statePath();
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  const path = statePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function shouldAutoOpen(key, now = Date.now()) {
  if (process.env.FUTRIXDATA_CODEX_AUTO_OPEN !== '1') return false;
  const state = readState();
  const last = Number(state[key] || 0);
  if (Number.isFinite(last) && now - last < AUTO_OPEN_INTERVAL_MS) return false;
  state[key] = now;
  writeState(state);
  return true;
}

function spawnDetached(command, args) {
  if (!commandAvailable(command)) {
    return { ok: false, error: `${command} was not found` };
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function openUrl(url) {
  if (process.platform === 'darwin') return spawnDetached('open', [url]);
  if (process.platform === 'win32') return spawnDetached('cmd', ['/c', 'start', '', url]);
  const xdg = spawnDetached('xdg-open', [url]);
  if (xdg.ok) return xdg;
  return spawnDetached('gio', ['open', url]);
}

function maybeAutoOpen(status) {
  if (status.needsDownload && shouldAutoOpen('lastDownloadOpenAt')) {
    openUrl(DOWNLOAD_URL);
    return;
  }
  if (status.needsAuthorization && shouldAutoOpen('lastAuthorizationOpenAt')) {
    openUrl(AUTHORIZE_URL);
    setTimeout(() => openUrl(FALLBACK_AUTHORIZE_URL), 750).unref?.();
  }
}

function tryProxyToFutrixMCP(status) {
  const cliPath = status.cliPath || locateFutrixCLI();
  const accessKey = (status.accessKey || '').trim();
  if (!cliPath || !accessKey || status.needsDownload || status.needsAuthorization) return false;
  const child = spawn(cliPath, ['mcp', 'serve', '--agent-access-key', accessKey], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  child.on('error', error => {
    console.error(`[futrixdata] failed to start bundled MCP: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  return true;
}

function statusText(status) {
  const lines = [];
  lines.push(`FutrixData setup status: ${status.ready ? 'ready' : 'not ready'}`);
  lines.push(`Desktop installed: ${String(Boolean(status.desktopInstalled))}`);
  lines.push(`Desktop running: ${String(Boolean(status.desktopRunning))}`);
  lines.push(`CLI ready: ${String(Boolean(status.cliReady))}`);
  if (status.cliPath) lines.push(`CLI path: ${status.cliPath}`);
  lines.push(`Codex detected: ${String(Boolean(status.codexDetected))}`);
  lines.push(`Codex MCP configured: ${String(Boolean(status.codexMcpConfigured))}`);
  lines.push(`Codex authorized: ${String(Boolean(status.codexAuthorized))}`);
  if (status.bridgeConfigured) lines.push(`Plugin bridge: ${status.bridgePath}`);
  if (status.error) lines.push(`Error: ${status.error}`);
  if (status.desktopError) lines.push(`Desktop error: ${status.desktopError}`);
  if (status.codexAuthorizationError) lines.push(`Authorization error: ${status.codexAuthorizationError}`);
  if (status.needsDownload) lines.push(`Next step: install FutrixData Desktop from ${DOWNLOAD_URL}`);
  else if (status.needsAuthorization) lines.push(`Next step: open ${AUTHORIZE_URL} to authorize Codex in FutrixData Desktop.`);
  else if (!status.ready) lines.push('Next step: open FutrixData Desktop, authorize Codex, then reload Codex.');
  else lines.push('Next step: reload Codex if FutrixData tools are not visible yet.');
  return lines.join('\n');
}

function tools() {
  return [
    {
      name: TOOL_NAMES.setupStatus,
      description: 'Check whether FutrixData Desktop, its bundled CLI bridge, and Codex authorization are ready.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: TOOL_NAMES.openDownload,
      description: 'Open the FutrixData Desktop download page when the local desktop app or CLI bridge is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: TOOL_NAMES.openAuthorization,
      description: 'Open FutrixData Desktop and trigger the Codex authorization flow.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
}

function callTool(name) {
  const status = detectSetupStatus();
  if (name === TOOL_NAMES.setupStatus) {
    return { content: [{ type: 'text', text: statusText(status) }] };
  }
  if (name === TOOL_NAMES.openDownload) {
    const opened = openUrl(DOWNLOAD_URL);
    return {
      content: [{ type: 'text', text: opened.ok ? `Opened ${DOWNLOAD_URL}` : `Could not open ${DOWNLOAD_URL}: ${opened.error}` }],
      isError: !opened.ok,
    };
  }
  if (name === TOOL_NAMES.openAuthorization) {
    const opened = openUrl(AUTHORIZE_URL);
    setTimeout(() => openUrl(FALLBACK_AUTHORIZE_URL), 750).unref?.();
    return {
      content: [{
        type: 'text',
        text: opened.ok
          ? `Opened FutrixData authorization. After approving, reload Codex so the FutrixData MCP tools are discovered.`
          : `Could not open FutrixData authorization: ${opened.error}`,
      }],
      isError: !opened.ok,
    };
  }
  return {
    content: [{ type: 'text', text: `Unknown FutrixData setup tool: ${name}` }],
    isError: true,
  };
}

class MCPFramer {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      this.onMessage(JSON.parse(body));
    }
  }
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function result(id, value) {
  writeMessage({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleMessage(message) {
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
  switch (message.method) {
    case 'initialize':
      result(message.id, {
        protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'tools/list':
      result(message.id, { tools: tools() });
      return;
    case 'tools/call':
      result(message.id, callTool(message.params?.name || ''));
      return;
    case 'ping':
      result(message.id, {});
      return;
    default:
      error(message.id, -32601, `Unsupported method: ${message.method}`);
  }
}

export function serveMCP() {
  const status = detectSetupStatus();
  if (tryProxyToFutrixMCP(status)) return;
  maybeAutoOpen(status);
  const framer = new MCPFramer(handleMessage);
  process.stdin.on('data', chunk => {
    try {
      framer.push(chunk);
    } catch (error_) {
      console.error(`[futrixdata-setup] ${error_.stack || error_.message}`);
    }
  });
}

function main() {
  const command = process.argv[2] || 'status';
  if (command === 'mcp') {
    serveMCP();
    return;
  }
  const status = detectSetupStatus();
  if (command === 'open-download') {
    openUrl(DOWNLOAD_URL);
  } else if (command === 'open-authorization') {
    openUrl(AUTHORIZE_URL);
  }
  process.stdout.write(JSON.stringify(status, null, 2));
  process.stdout.write('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
