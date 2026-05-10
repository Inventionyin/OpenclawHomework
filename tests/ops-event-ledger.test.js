const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildOpsEventEntry,
  appendOpsEvent,
  readOpsEvents,
  getOpsEventLedgerPath,
} = require('../scripts/ops-event-ledger');

test('buildOpsEventEntry keeps required fields and redacts secret-like metadata', () => {
  const entry = buildOpsEventEntry({
    timestamp: '2026-05-10T00:00:00.000Z',
    module: 'watchdog',
    event: 'restart',
    runId: 'run-1',
    status: 'failed',
    reason: 'token leaked: ghp_abc123',
    durationMs: 123,
    metadata: {
      apiKey: 'sk-live-abc',
      nested: {
        authToken: 'ak_test_001',
      },
      note: 'value contains token sk_demo',
      safe: 'ok',
    },
  });

  assert.equal(entry.timestamp, '2026-05-10T00:00:00.000Z');
  assert.equal(entry.module, 'watchdog');
  assert.equal(entry.event, 'restart');
  assert.equal(entry.runId, 'run-1');
  assert.equal(entry.status, 'failed');
  assert.equal(entry.reason, '[redacted secret-like text]');
  assert.equal(entry.durationMs, 123);
  assert.deepEqual(entry.metadata, {
    apiKey: '[redacted]',
    nested: {
      authToken: '[redacted]',
    },
    note: '[redacted secret-like text]',
    safe: 'ok',
  });
});

test('appendOpsEvent is disabled by default', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ops-event-ledger-disabled-'));
  const file = join(tempDir, 'events.jsonl');
  try {
    const written = appendOpsEvent({ OPS_EVENT_LEDGER_PATH: file }, { module: 'm', event: 'e' });
    assert.equal(written, false);
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendOpsEvent writes jsonl when enabled and readOpsEvents returns latest N entries', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ops-event-ledger-enabled-'));
  const file = join(tempDir, 'events.jsonl');
  const env = {
    OPS_EVENT_LEDGER_ENABLED: 'true',
    OPS_EVENT_LEDGER_PATH: file,
  };

  try {
    assert.equal(getOpsEventLedgerPath(env), file);
    assert.equal(appendOpsEvent(env, { module: 'ops', event: 'start', runId: 'r1' }), true);
    assert.equal(appendOpsEvent(env, { module: 'ops', event: 'done', runId: 'r2' }), true);
    assert.equal(appendOpsEvent(env, { module: 'ops', event: 'cleanup', runId: 'r3' }), true);

    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 3);
    assert.deepEqual(readOpsEvents(env, 2).map((entry) => entry.runId), ['r2', 'r3']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getOpsEventLedgerPath defaults to data/ops-events/events.jsonl', () => {
  const env = { LOCAL_PROJECT_DIR: 'D:\\tmp\\project' };
  const actual = getOpsEventLedgerPath(env).replace(/\\/g, '/');
  assert.equal(actual, 'D:/tmp/project/data/ops-events/events.jsonl');
});
