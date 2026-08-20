import { resolve } from 'node:path';

function configuredValue(value, fallback) {
  return value === undefined ? String(fallback) : String(value).trim();
}

export function parsePort(value, { name = 'PORT', fallback = 4173 } = {}) {
  const raw = configuredValue(value, fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between 1 and 65535.`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function parseHost(value, { name = 'HOST', fallback = '127.0.0.1' } = {}) {
  const host = configuredValue(value, fallback);
  if (!host || host.length > 253 || /[\s\\/?#\0]/u.test(host)) {
    throw new Error(`${name} must be a hostname or IP address without whitespace or URL syntax.`);
  }
  return host;
}

export function parseHttpUrl(value, { name, optional = false } = {}) {
  const raw = value === undefined ? '' : String(value).trim();
  if (!raw && optional) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use http: or https:.`);
  }
  return parsed.href;
}

export function parseOrigin(value, { name = 'PUBLIC_ORIGIN', fallback } = {}) {
  const raw = configuredValue(value, fallback);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute HTTP(S) origin.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} must contain only an HTTP(S) scheme and host, without credentials, path, query, or fragment.`);
  }
  return parsed.origin;
}

export function parseFlag(value, { name, fallback = false } = {}) {
  if (value === undefined) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true'].includes(raw)) return true;
  if (['0', 'false'].includes(raw)) return false;
  throw new Error(`${name} must be one of: 0, 1, false, true.`);
}

export function parseDirectory(value, { name, fallback } = {}) {
  const raw = value === undefined ? String(fallback) : String(value);
  if (!raw.trim() || raw.includes('\0')) throw new Error(`${name} must be a non-empty filesystem path.`);
  return resolve(raw);
}
