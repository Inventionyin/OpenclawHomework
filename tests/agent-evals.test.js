const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  loadGoldenIntentCases,
  runGoldenIntentEvals,
  scoreRoute,
} = require('../scripts/agent-evals');

test('scoreRoute compares expected agent and action', () => {
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'load-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), true);
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'disk-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), false);
});

test('loadGoldenIntentCases reads json cases', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-evals-'));
  try {
    const file = join(tempDir, 'cases.json');
    writeFileSync(file, JSON.stringify([{ text: '你好', expected: { agent: 'chat-agent', action: 'chat' } }]), 'utf8');
    assert.equal(loadGoldenIntentCases(file).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runGoldenIntentEvals returns pass and failure details', () => {
  const result = runGoldenIntentEvals({
    cases: [
      { text: '内存多少', expected: { agent: 'ops-agent', action: 'load-summary' } },
      { text: '你好', expected: { agent: 'chat-agent', action: 'chat' } },
    ],
    routeIntent: (text) => (text === '内存多少'
      ? { agent: 'ops-agent', action: 'load-summary' }
      : { agent: 'clerk-agent', action: 'command-center' }),
  });

  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].text, '你好');
});
