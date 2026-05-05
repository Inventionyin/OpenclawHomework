const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDailySummary } = require('../scripts/daily-summary');

test('buildDailySummary returns summary counts and latest run link', () => {
  const summary = buildDailySummary([
    { conclusion: 'success', runUrl: 'https://example.com/1' },
    { conclusion: 'failure', runUrl: 'https://example.com/2' },
  ]);

  assert.equal(summary.subject, '自动化测试日报');
  assert.match(summary.text, /成功 1/);
  assert.match(summary.text, /失败 1/);
  assert.match(summary.text, /https:\/\/example.com\/2/);
  assert.match(summary.html, /https:\/\/example.com\/2/);
});

test('buildDailySummary includes token ledger and multi-agent highlights when provided', () => {
  const summary = buildDailySummary({
    runs: [
      {
        conclusion: 'success',
        runUrl: 'https://example.com/run-1',
        artifactsUrl: 'https://example.com/run-1#artifacts',
        targetRef: 'main',
        runMode: 'smoke',
      },
      {
        conclusion: 'failure',
        runUrl: 'https://example.com/run-2',
        artifactsUrl: 'https://example.com/run-2#artifacts',
        targetRef: 'develop',
        runMode: 'contracts',
      },
    ],
    usageEntries: [
      { assistant: 'Hermes', totalTokens: 120, modelElapsedMs: 2400 },
      { assistant: 'OpenClaw', totalTokens: 80, modelElapsedMs: 1600 },
    ],
    multiAgentSummary: {
      totalItems: 6,
      failedJobs: 1,
      winner: 'Hermes',
      totalTokens: 900,
    },
  });

  assert.match(summary.text, /今日成功 1/);
  assert.match(summary.text, /今日失败 1/);
  assert.match(summary.text, /develop/);
  assert.match(summary.text, /contracts/);
  assert.match(summary.text, /run-2#artifacts/);
  assert.match(summary.text, /Hermes：120 tokens/);
  assert.match(summary.text, /OpenClaw：80 tokens/);
  assert.match(summary.text, /多 Agent 训练场：6 个样本/);
  assert.match(summary.text, /赢家：Hermes/);
  assert.match(summary.html, /日报看板/);
  assert.match(summary.html, /run-2#artifacts/);
  assert.match(summary.html, /Hermes/);
  assert.match(summary.html, /Multi-Agent Lab/);
});
