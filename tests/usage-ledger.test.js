const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildUsageLedgerEntry,
  appendUsageLedgerEntry,
} = require('../scripts/usage-ledger');

test('buildUsageLedgerEntry keeps timing and token fields without secrets', () => {
  const entry = buildUsageLedgerEntry({
    assistant: 'Hermes',
    route: { agent: 'chat-agent', action: 'chat' },
    modelResult: {
      model: 'LongCat-Flash-Chat',
      tier: 'chat',
      endpoint: 'chat_completions',
      apiKeyIndex: 2,
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    },
    elapsedMs: 1234,
    modelElapsedMs: 900,
    promptChars: 20,
    replyChars: 8,
    timestamp: '2026-05-05T00:00:00.000Z',
  });

  assert.deepEqual(entry, {
    timestamp: '2026-05-05T00:00:00.000Z',
    assistant: 'Hermes',
    agent: 'chat-agent',
    action: 'chat',
    model: 'LongCat-Flash-Chat',
    tier: 'chat',
    endpoint: 'chat_completions',
    apiKeyIndex: 2,
    elapsedMs: 1234,
    modelElapsedMs: 900,
    promptChars: 20,
    replyChars: 8,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
});

test('appendUsageLedgerEntry writes one JSON line when enabled', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-ledger-'));
  const file = join(tempDir, 'usage.jsonl');
  try {
    const written = appendUsageLedgerEntry(
      {
        FEISHU_USAGE_LEDGER_ENABLED: 'true',
        FEISHU_USAGE_LEDGER_PATH: file,
      },
      {
        assistant: 'OpenClaw',
        modelResult: {
          model: 'astron-code-latest',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        },
        elapsedMs: 50,
        timestamp: '2026-05-05T00:00:00.000Z',
      },
    );

    assert.equal(written, true);
    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).totalTokens, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildUsageLedgerEntry still records latency when provider omits token usage', () => {
  const entry = buildUsageLedgerEntry({
    assistant: 'Hermes',
    route: { agent: 'chat-agent', action: 'chat' },
    modelResult: {
      model: 'LongCat-Flash-Chat',
      tier: 'chat',
      endpoint: 'chat_completions',
      usage: null,
    },
    elapsedMs: 9000,
    modelElapsedMs: 5000,
    promptChars: 42,
    replyChars: 88,
    timestamp: '2026-05-05T01:00:00.000Z',
  });

  assert.equal(entry.assistant, 'Hermes');
  assert.equal(entry.model, 'LongCat-Flash-Chat');
  assert.equal(entry.modelElapsedMs, 5000);
  assert.equal(entry.promptChars, 42);
  assert.equal(entry.replyChars, 88);
  assert.equal(entry.usageMissing, true);
  assert.equal(entry.totalTokens, undefined);
});
