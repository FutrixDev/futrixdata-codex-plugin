import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectSetupStatus, DOWNLOAD_URL, openUrl } from '../plugins/futrixdata/scripts/futrixdata-codex-sidecar.mjs';

test('detectSetupStatus reports download requirement when no CLI is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-home-'));
  process.env.PATH = dir;
  delete process.env.FUTRIXDATA_CLI_PATH;
  process.env.FUTRIXDATA_CODEX_PATH_ONLY = '1';

  const status = detectSetupStatus();

  assert.equal(status.ready, false);
  assert.equal(status.needsDownload, true);
  assert.equal(status.downloadUrl, DOWNLOAD_URL);

  delete process.env.FUTRIXDATA_CODEX_PATH_ONLY;
});

test('detectSetupStatus consumes FutrixData codex status JSON from explicit CLI path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-home-'));
  const cliPath = join(dir, process.platform === 'win32' ? 'futrixdata-cli.cmd' : 'futrixdata-cli');
  const body = JSON.stringify({
    ready: true,
    desktopInstalled: true,
    desktopRunning: true,
    cliReady: true,
    codexDetected: true,
    codexMcpConfigured: true,
    codexAuthorized: true,
  });
  if (process.platform === 'win32') {
    writeFileSync(cliPath, `@echo off\r\necho ${body.replaceAll('"', '\\"')}\r\n`);
  } else {
    writeFileSync(cliPath, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`);
    chmodSync(cliPath, 0o755);
  }
  process.env.FUTRIXDATA_CLI_PATH = cliPath;

  const status = detectSetupStatus();

  assert.equal(status.ready, true);
  assert.equal(status.needsDownload, false);
  assert.equal(status.needsAuthorization, false);
  assert.equal(status.cliPath, cliPath);
});

test('detectSetupStatus respects explicit not-ready status from FutrixData CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-home-'));
  const cliPath = join(dir, process.platform === 'win32' ? 'futrixdata-cli.cmd' : 'futrixdata-cli');
  const body = JSON.stringify({
    ready: false,
    desktopInstalled: true,
    desktopRunning: false,
    cliReady: true,
    codexDetected: true,
    codexMcpConfigured: true,
    codexAuthorized: true,
    codexAuthorizationStatus: 'authorized',
  });
  if (process.platform === 'win32') {
    writeFileSync(cliPath, `@echo off\r\necho ${body.replaceAll('"', '\\"')}\r\n`);
  } else {
    writeFileSync(cliPath, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`);
    chmodSync(cliPath, 0o755);
  }
  process.env.FUTRIXDATA_CLI_PATH = cliPath;
  delete process.env.FUTRIXDATA_CODEX_PATH_ONLY;

  const status = detectSetupStatus();

  assert.equal(status.ready, false);
  assert.equal(status.needsDownload, false);
  assert.equal(status.needsAuthorization, false);
  assert.equal(status.desktopRunning, false);
});

test('detectSetupStatus treats the FutrixData Desktop plugin bridge as Codex authorization', () => {
  const dir = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-'));
  const home = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-home-'));
  const cliPath = join(dir, 'futrixdata-cli');
  const body = JSON.stringify({
    ready: false,
    desktopInstalled: true,
    desktopRunning: true,
    cliReady: true,
    codexDetected: false,
    codexMcpConfigured: false,
    codexAuthorized: false,
  });
  writeFileSync(cliPath, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`);
  chmodSync(cliPath, 0o755);
  mkdirSync(join(home, '.futrixdata'), { recursive: true });
  writeFileSync(join(home, '.futrixdata', 'codex-plugin.json'), JSON.stringify({
    accessKey: 'agent_bridge_1234',
    cliPath,
  }));
  process.env.HOME = home;
  process.env.FUTRIXDATA_CLI_PATH = cliPath;
  process.env.FUTRIXDATA_CODEX_PATH_ONLY = '1';

  const status = detectSetupStatus();

  assert.equal(status.codexAuthorized, true);
  assert.equal(status.codexMcpConfigured, true);
  assert.equal(status.bridgeConfigured, true);
  assert.equal(JSON.stringify(status).includes('agent_bridge_1234'), false);

  delete process.env.FUTRIXDATA_CODEX_PATH_ONLY;
});

test('detectSetupStatus uses the Desktop bridge CLI path when PATH discovery is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-'));
  const home = mkdtempSync(join(tmpdir(), 'futrixdata-codex-plugin-home-'));
  const cliPath = join(dir, 'futrixdata-cli');
  const body = JSON.stringify({
    ready: true,
    desktopInstalled: true,
    desktopRunning: true,
    cliReady: true,
    codexDetected: true,
    codexMcpConfigured: true,
    codexAuthorized: true,
    codexAuthorizationStatus: 'authorized',
  });
  writeFileSync(cliPath, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`);
  chmodSync(cliPath, 0o755);
  mkdirSync(join(home, '.futrixdata'), { recursive: true });
  writeFileSync(join(home, '.futrixdata', 'codex-plugin.json'), JSON.stringify({
    accessKey: 'agent_bridge_cli_path_1234',
    cliPath,
  }));
  process.env.HOME = home;
  process.env.PATH = '';
  delete process.env.FUTRIXDATA_CLI_PATH;
  process.env.FUTRIXDATA_CODEX_PATH_ONLY = '1';

  const status = detectSetupStatus();

  assert.equal(status.ready, true);
  assert.equal(status.needsDownload, false);
  assert.equal(status.cliPath, cliPath);

  delete process.env.FUTRIXDATA_CODEX_PATH_ONLY;
});

test('openUrl reports a missing opener without an unhandled child-process error', () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '';

  const result = openUrl('https://futrixdata.com/download?source=codex-plugin');

  if (process.platform === 'darwin') {
    assert.equal(result.ok, false);
    assert.match(result.error, /open was not found/);
  } else if (process.platform === 'win32') {
    assert.equal(result.ok, false);
    assert.match(result.error, /cmd was not found/);
  } else {
    assert.equal(result.ok, false);
    assert.match(result.error, /gio was not found/);
  }
  process.env.PATH = originalPath;
});
