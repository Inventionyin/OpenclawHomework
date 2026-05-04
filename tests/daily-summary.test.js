const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDailySummary } = require('../scripts/daily-summary');

test('buildDailySummary returns summary counts and latest run link', () => {
  const summary = buildDailySummary([
    { conclusion: 'success', runUrl: 'https://example.com/1' },
    { conclusion: 'failure', runUrl: 'https://example.com/2' },
  ]);

  assert.match(summary.subject, /Daily Summary/);
  assert.match(summary.text, /成功 1/);
  assert.match(summary.text, /失败 1/);
  assert.match(summary.text, /https:\/\/example.com\/2/);
  assert.match(summary.html, /https:\/\/example.com\/2/);
});
