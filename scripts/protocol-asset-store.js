const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const REDACTED = '[REDACTED]';
const SECRET_KEY_PATTERN = /(authorization|cookie|set-cookie|x-api-key|token|key|password)/i;
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9_-]+|ak_[a-z0-9_-]+|ck_live_[a-z0-9_-]+|github_pat_[a-z0-9_]+)/i;

function getProtocolAssetDir(options = {}, env = process.env) {
  if (options.dir) {
    return options.dir;
  }
  if (env.PROTOCOL_ASSET_DIR) {
    return env.PROTOCOL_ASSET_DIR;
  }
  return join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'protocol-assets');
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function createAssetId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `pa-${stamp}-${rand}`;
}

function normalizePath(urlValue) {
  if (!urlValue || typeof urlValue !== 'string') {
    return '/';
  }
  let pathname = '';
  try {
    pathname = new URL(urlValue).pathname;
  } catch {
    pathname = String(urlValue).split('?')[0].split('#')[0];
  }
  const compact = pathname.replace(/\/{2,}/g, '/');
  if (!compact || compact === '/') {
    return '/';
  }
  return compact.endsWith('/') ? compact.slice(0, -1) : compact;
}

function normalizeContentType(asset = {}) {
  const headers = asset.response?.headers || asset.headers || {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-type');
  if (!key) {
    return '';
  }
  return String(headers[key]).split(';')[0].trim().toLowerCase();
}

function normalizeStatus(asset = {}) {
  const value = asset.status ?? asset.response?.status;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDurationMs(asset = {}) {
  if (Number.isFinite(Number(asset.durationMs))) {
    return Number(asset.durationMs);
  }
  const startedAt = Date.parse(asset.startedAt || asset.request?.startedAt || '');
  const endedAt = Date.parse(asset.endedAt || asset.response?.endedAt || '');
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
    return endedAt - startedAt;
  }
  return 0;
}

function summarizeProtocolAsset(asset = {}) {
  return {
    method: String(asset.method || asset.request?.method || 'GET').toUpperCase(),
    normalizedPath: normalizePath(asset.url || asset.request?.url || ''),
    status: normalizeStatus(asset),
    contentType: normalizeContentType(asset),
    durationMs: normalizeDurationMs(asset),
    tags: Array.isArray(asset.tags) ? asset.tags.map((tag) => String(tag)) : [],
  };
}

function redactStringValue(value) {
  if (!SECRET_VALUE_PATTERN.test(value)) {
    return value;
  }
  return value.replace(SECRET_VALUE_PATTERN, REDACTED);
}

function redactValue(value, keyName = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (SECRET_KEY_PATTERN.test(String(keyName))) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return redactStringValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keyName));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = redactValue(nested, key);
    }
    return output;
  }
  return value;
}

function redactProtocolAsset(asset = {}) {
  return redactValue(asset);
}

function saveProtocolAsset(asset = {}, options = {}) {
  const dir = getProtocolAssetDir(options, options.env || process.env);
  ensureDir(dir);
  const now = options.now ? new Date(options.now) : new Date();
  const id = asset.id || createAssetId(now);
  const createdAt = asset.createdAt || now.toISOString();
  const redacted = redactProtocolAsset(asset);
  const stored = {
    ...redacted,
    id,
    createdAt,
    summary: summarizeProtocolAsset(redacted),
  };
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return stored;
}

function listProtocolAssets(options = {}) {
  const dir = getProtocolAssetDir(options, options.env || process.env);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

module.exports = {
  redactProtocolAsset,
  summarizeProtocolAsset,
  saveProtocolAsset,
  listProtocolAssets,
};
