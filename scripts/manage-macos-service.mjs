#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.maisons-turner.web';
const action = process.argv[2];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launchAgentsDirectory = join(homedir(), 'Library', 'LaunchAgents');
const agentPath = join(launchAgentsDirectory, `${label}.plist`);
const logsDirectory = join(projectRoot, '.turner-data', 'logs');

if (process.platform !== 'darwin' || typeof process.getuid !== 'function') {
  throw new Error('The persistent service manager is only supported on macOS.');
}

const domain = `gui/${process.getuid()}`;
const service = `${domain}/${label}`;

function findNodeExecutable() {
  const result = spawnSync('/usr/bin/which', ['node'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : process.execPath;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function launchctl(args, { allowMissing = false, inherit = false } = {}) {
  const result = spawnSync('/bin/launchctl', args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowMissing) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`launchctl ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }

  return result;
}

function plist() {
  const values = {
    label,
    node: findNodeExecutable(),
    server: join(projectRoot, 'server.mjs'),
    projectRoot,
    stdout: join(logsDirectory, 'server.out.log'),
    stderr: join(logsDirectory, 'server.err.log'),
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(values.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(values.node)}</string>
    <string>${escapeXml(values.server)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(values.projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>PORT</key>
    <string>4173</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(values.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(values.stderr)}</string>
</dict>
</plist>
`;
}

async function install() {
  await mkdir(launchAgentsDirectory, { recursive: true, mode: 0o700 });
  await mkdir(logsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(agentPath, plist(), { encoding: 'utf8', mode: 0o600 });
  await chmod(agentPath, 0o600);

  launchctl(['bootout', service], { allowMissing: true });
  launchctl(['bootstrap', domain, agentPath]);
  launchctl(['enable', service]);
  launchctl(['kickstart', '-k', service]);

  console.log(`Installed and started ${label}.`);
  console.log(`LaunchAgent: ${agentPath}`);
  console.log(`Logs: ${logsDirectory}`);
}

async function uninstall() {
  launchctl(['bootout', service], { allowMissing: true });
  await rm(agentPath, { force: true });
  console.log(`Stopped and removed ${label}.`);
}

async function main() {
  switch (action) {
    case 'install':
      await install();
      break;
    case 'status':
      launchctl(['print', service], { inherit: true });
      break;
    case 'uninstall':
      await uninstall();
      break;
    default:
      throw new Error('Usage: node scripts/manage-macos-service.mjs <install|status|uninstall>');
  }
}

await main();
