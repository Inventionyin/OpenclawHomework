const { appendFileSync, existsSync, mkdirSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function hasSecretLikeText(value) {
  const text = String(value || '');
  return /(?:\b(?:key|token|secret|password)\b|sk_[a-z0-9_-]+|ak_[a-z0-9_-]+|ghp_[a-z0-9_-]+)/i.test(text);
}

function redactScalar(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && hasSecretLikeText(value)) {
    return '[redacted secret-like text]';
  }
  return value;
}

function redactObject(value, depth = 0) {
  if (value === undefined || value === null) return undefined;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/(?:key|token|secret|password|authorization|sk_|ak_|ghp_)/i.test(key)) {
          return [key, '[redacted]'];
        }
        return [key, redactObject(item, depth + 1)];
      }),
    );
  }
  return redactScalar(value);
}

function buildOpsEventEntry(input = {}) {
  const entry = {
    timestamp: input.timestamp || new Date().toISOString(),
    module: input.module,
    event: input.event,
    runId: input.runId || input.run_id,
    status: input.status,
    reason: redactScalar(input.reason),
    durationMs: numberOrUndefined(input.durationMs),
    metadata: redactObject(input.metadata),
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function getOpsEventLedgerPath(env = process.env) {
  return String(
    env.OPS_EVENT_LEDGER_PATH
      || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'ops-events', 'events.jsonl'),
  ).trim();
}

function isOpsEventLedgerEnabled(env = process.env) {
  return String(env.OPS_EVENT_LEDGER_ENABLED || 'false').toLowerCase() === 'true';
}

function appendOpsEvent(env = process.env, input = {}) {
  if (!isOpsEventLedgerEnabled(env)) {
    return false;
  }
  const file = getOpsEventLedgerPath(env);
  if (!file) {
    return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(buildOpsEventEntry(input))}\n`, 'utf8');
  return true;
}

function readOpsEvents(env = process.env, limit = 200) {
  const file = getOpsEventLedgerPath(env);
  if (!file || !existsSync(file)) {
    return [];
  }
  const safeLimit = Math.max(0, Number(limit) || 0);
  return readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-safeLimit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  buildOpsEventEntry,
  appendOpsEvent,
  readOpsEvents,
  getOpsEventLedgerPath,
  isOpsEventLedgerEnabled,
};
