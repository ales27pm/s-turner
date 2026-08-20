import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseDirectory, parseFlag, parseHost, parseHttpUrl, parseOrigin, parsePort } from './runtime-config.mjs';

assert.equal(parsePort(undefined), 4173);
assert.equal(parsePort('4180', { name: 'TURNER_SERVICE_PORT' }), 4180);
assert.equal(parseHost(undefined), '127.0.0.1');
assert.equal(parseHost('::1'), '::1');
assert.equal(parseFlag('true', { name: 'TURNER_FALLBACK_ONLY' }), true);
assert.equal(parseFlag('0', { name: 'TURNER_FALLBACK_ONLY' }), false);
assert.equal(parseHttpUrl('https://example.com/hook', { name: 'WEBHOOK' }), 'https://example.com/hook');
assert.equal(parseOrigin('https://example.com', { name: 'PUBLIC_ORIGIN' }), 'https://example.com');
assert(parseDirectory('./.turner-data', { name: 'TURNER_DATA_DIR' }).endsWith('.turner-data'));

assert.throws(() => parsePort('abc'), /PORT must be an integer/);
assert.throws(() => parsePort('70000'), /PORT must be an integer/);
assert.throws(() => parseHost('https:\/\/example.com'), /HOST must be a hostname/);
assert.throws(() => parseHttpUrl('ftp://example.com/hook', { name: 'WEBHOOK' }), /must use http: or https:/);
assert.throws(() => parseOrigin('https://example.com/path', { name: 'PUBLIC_ORIGIN' }), /must contain only an HTTP\(S\) scheme and host/);
assert.throws(() => parseFlag('sometimes', { name: 'FLAG' }), /FLAG must be one of/);
assert.throws(() => parseDirectory('', { name: 'DATA', fallback: '/tmp/data' }), /DATA must be a non-empty/);

async function expectStartupFailure(environment, expectedMessage) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '4173',
      TURNER_DATA_DIR: '/tmp/turner-config-check',
      TURNER_CRM_WEBHOOK_URL: '',
      TURNER_FALLBACK_ONLY: '0',
      TURNER_INDEXABLE: '1',
      TURNER_PUBLIC_ORIGIN: 'https://maisonsturner.ca',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitPromise = once(child, 'exit');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const outcome = await Promise.race([
    exitPromise.then(([code, signal]) => ({ code, signal })),
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 3000)),
  ]);
  if (outcome.timeout) {
    child.kill('SIGKILL');
    await exitPromise;
    throw new Error(`Server did not reject invalid environment: ${JSON.stringify(environment)}`);
  }
  assert.notEqual(outcome.code, 0, `Server accepted invalid environment: ${JSON.stringify(environment)}`);
  assert.match(output, expectedMessage, `Unexpected startup error for ${JSON.stringify(environment)}:\n${output}`);
}

await expectStartupFailure({ PORT: 'not-a-port' }, /PORT must be an integer between 1 and 65535/);
await expectStartupFailure({ HOST: 'bad host' }, /HOST must be a hostname or IP address/);
await expectStartupFailure({ TURNER_CRM_WEBHOOK_URL: 'ftp:\/\/example.com/hook' }, /TURNER_CRM_WEBHOOK_URL must use http: or https:/);
await expectStartupFailure({ TURNER_FALLBACK_ONLY: 'sometimes' }, /TURNER_FALLBACK_ONLY must be one of/);
await expectStartupFailure({ TURNER_INDEXABLE: 'sometimes' }, /TURNER_INDEXABLE must be one of/);
await expectStartupFailure({ TURNER_PUBLIC_ORIGIN: 'https:\/\/example.com/path' }, /TURNER_PUBLIC_ORIGIN must contain only an HTTP\(S\) scheme and host/);

console.log('Runtime environment validation checks passed.');
