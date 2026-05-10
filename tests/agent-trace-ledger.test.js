const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  appendAgentTrace,
  buildAgentTraceEntry,
  getAgentTraceLedgerPath,
  readAgentTraces,
} = require('../scripts/agent-trace-ledger');

test('buildAgentTraceEntry keeps route timing and redacts secret-like fields', () => {
  const entry = buildAgentTraceEntry({
    timestamp: '2026-05-10T00:00:00.000Z',
    traceId: 'trace-1',
    channel: 'feishu',
    userText: '帮我看今天项目情况 GITHUB_TOKEN=ghp_example',
    route: {
      agent: 'clerk-agent',
      action: 'command-center',
      skillId: 'command-center',
      intentSource: 'rules',
    },
    status: 'completed',
    elapsedMs: 123,
    metadata: {
      model: 'longcat',
      apiKey: 'sk-secret',
    },
  });

  assert.equal(entry.traceId, 'trace-1');
  assert.equal(entry.agent, 'clerk-agent');
  assert.equal(entry.action, 'command-center');
  assert.equal(entry.skillId, 'command-center');
  assert.equal(entry.intentSource, 'rules');
  assert.equal(entry.elapsedMs, 123);
  assert.equal(entry.userText, '[redacted secret-like text]');
  assert.deepEqual(entry.metadata, { model: 'longcat', apiKey: '[redacted]' });
});

test('appendAgentTrace writes jsonl when enabled and readAgentTraces returns recent entries', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-trace-ledger-'));
  try {
    const file = join(tempDir, 'traces.jsonl');
    const env = {
      AGENT_TRACE_LEDGER_ENABLED: 'true',
      AGENT_TRACE_LEDGER_PATH: file,
    };

    assert.equal(getAgentTraceLedgerPath(env), file);
    assert.equal(appendAgentTrace(env, {
      traceId: 'trace-a',
      route: { agent: 'ops-agent', action: 'load-summary' },
      status: 'completed',
    }), true);
    assert.equal(appendAgentTrace(env, {
      traceId: 'trace-b',
      route: { agent: 'clerk-agent', action: 'task-center-brain' },
      status: 'failed',
      error: 'boom',
    }), true);

    assert.match(readFileSync(file, 'utf8'), /trace-a/);
    assert.deepEqual(readAgentTraces(env, 1).map((entry) => entry.traceId), ['trace-b']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendAgentTrace is disabled by default', () => {
  assert.equal(appendAgentTrace({}, { traceId: 'trace-disabled' }), false);
});
