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

function toArrayFilter(value) {
  if (!value) return null;
  const items = Array.isArray(value) ? value : String(value).split(',');
  const normalized = items.map((item) => String(item || '').trim()).filter(Boolean);
  return normalized.length ? new Set(normalized) : null;
}

function isDegradedStatus(status = '') {
  return /degraded/i.test(String(status || ''));
}

function percentile(values = [], p = 0.95) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function emptyOpsEventSummary(options = {}) {
  return {
    window: {
      since: options.since || '',
      until: options.until || '',
      scanned: 0,
      matched: 0,
    },
    totals: {
      total: 0,
      completed: 0,
      failed: 0,
      degraded: 0,
      unknown: 0,
    },
    byModule: {},
    byEvent: {},
    timeline: [],
    latestByRunId: [],
    failureSamples: [],
    slowest: [],
    dataQuality: {
      invalidJsonLines: 0,
      missingTimestamp: 0,
      missingModule: 0,
      missingEvent: 0,
    },
  };
}

function summarizeOpsEvents(env = process.env, options = {}) {
  const limit = Math.max(1, Number(options.limit || 2000));
  const events = readOpsEvents(env, limit);
  const summary = emptyOpsEventSummary(options);
  summary.window.scanned = events.length;

  const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
  const untilMs = options.until ? Date.parse(options.until) : Number.POSITIVE_INFINITY;
  const modules = toArrayFilter(options.modules);
  const statuses = toArrayFilter(options.statuses);
  const eventNames = toArrayFilter(options.events);
  const runIds = toArrayFilter(options.runIds);
  const latestByRunId = new Map();
  const timeline = new Map();

  for (const event of events) {
    if (!event.timestamp) summary.dataQuality.missingTimestamp += 1;
    if (!event.module) summary.dataQuality.missingModule += 1;
    if (!event.event) summary.dataQuality.missingEvent += 1;

    const timestampMs = Date.parse(event.timestamp || '');
    if (Number.isFinite(timestampMs) && timestampMs < sinceMs) continue;
    if (Number.isFinite(timestampMs) && timestampMs > untilMs) continue;
    if (modules && !modules.has(String(event.module || ''))) continue;
    if (statuses && !statuses.has(String(event.status || ''))) continue;
    if (eventNames && !eventNames.has(String(event.event || ''))) continue;
    if (runIds && !runIds.has(String(event.runId || ''))) continue;

    summary.window.matched += 1;
    summary.totals.total += 1;
    const status = String(event.status || 'unknown');
    if (status === 'completed') summary.totals.completed += 1;
    else if (status === 'failed') summary.totals.failed += 1;
    else if (isDegradedStatus(status)) summary.totals.degraded += 1;
    else summary.totals.unknown += 1;

    const moduleName = String(event.module || 'unknown');
    const moduleRow = summary.byModule[moduleName] || {
      total: 0,
      completed: 0,
      failed: 0,
      degraded: 0,
      unknown: 0,
      durations: [],
      avgDurationMs: 0,
      p95DurationMs: 0,
    };
    moduleRow.total += 1;
    if (status === 'completed') moduleRow.completed += 1;
    else if (status === 'failed') moduleRow.failed += 1;
    else if (isDegradedStatus(status)) moduleRow.degraded += 1;
    else moduleRow.unknown += 1;
    if (Number.isFinite(Number(event.durationMs))) {
      moduleRow.durations.push(Number(event.durationMs));
    }
    summary.byModule[moduleName] = moduleRow;

    const eventName = String(event.event || 'unknown');
    const eventRow = summary.byEvent[eventName] || { total: 0, failed: 0, degraded: 0 };
    eventRow.total += 1;
    if (status === 'failed') eventRow.failed += 1;
    if (isDegradedStatus(status)) eventRow.degraded += 1;
    summary.byEvent[eventName] = eventRow;

    const day = Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString().slice(0, 10) : 'unknown';
    const dayRow = timeline.get(day) || { day, total: 0, failed: 0, degraded: 0 };
    dayRow.total += 1;
    if (status === 'failed') dayRow.failed += 1;
    if (isDegradedStatus(status)) dayRow.degraded += 1;
    timeline.set(day, dayRow);

    const sample = {
      timestamp: event.timestamp || '',
      module: moduleName,
      event: eventName,
      runId: event.runId || '',
      status,
      reason: event.reason || '',
      durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : 0,
    };
    if (status === 'failed' || isDegradedStatus(status)) {
      summary.failureSamples.push(sample);
    }
    if (event.runId) {
      latestByRunId.set(event.runId, sample);
    }
    summary.slowest.push(sample);
  }

  for (const row of Object.values(summary.byModule)) {
    const totalDuration = row.durations.reduce((total, value) => total + value, 0);
    row.avgDurationMs = row.durations.length ? Math.round(totalDuration / row.durations.length) : 0;
    row.p95DurationMs = percentile(row.durations, 0.95);
    delete row.durations;
  }
  summary.timeline = Array.from(timeline.values()).sort((a, b) => a.day.localeCompare(b.day));
  summary.latestByRunId = Array.from(latestByRunId.values()).slice(-10).reverse();
  const sampleSize = Math.max(1, Number(options.sampleSize || 5));
  summary.failureSamples = summary.failureSamples.slice(-sampleSize).reverse();
  summary.slowest = summary.slowest
    .filter((event) => Number.isFinite(Number(event.durationMs)))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, sampleSize);
  return summary;
}

module.exports = {
  buildOpsEventEntry,
  appendOpsEvent,
  readOpsEvents,
  getOpsEventLedgerPath,
  isOpsEventLedgerEnabled,
  summarizeOpsEvents,
};
