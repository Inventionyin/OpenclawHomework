const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDashboardHtml,
  escapeHtml,
  summarizeDashboardState,
} = require('../scripts/dashboard');

test('summarizeDashboardState keeps read-only dashboard fields compact', () => {
  const state = summarizeDashboardState({
    plan: {
      todaySummaryText: '今日任务正常',
      tomorrowPlan: ['跑 UI 自动化', '发送日报'],
    },
    tasks: {
      counts: { total: 4, today: 2, failed: 1, recoverable: 1 },
      byType: [{ type: 'ui-automation', label: 'UI 自动化', today: 1, failed: 1, total: 2 }],
      latest: { id: 'task-1', status: 'failed' },
      quickCommands: ['文员，查看失败任务'],
    },
    usage: {
      entries: [{ assistant: 'Hermes', model: 'LongCat-Flash-Chat', estimatedTotalTokens: 200 }],
      totalTokens: 200,
      estimatedTokens: 200,
    },
    mail: {
      todayEntries: [{ action: 'daily', subject: '日报' }],
      entries: [{ action: 'daily', subject: '日报' }],
    },
    snapshot: {
      runs: [{ conclusion: 'success' }],
      latestRun: { conclusion: 'success', runUrl: 'https://github.com/run' },
    },
    warnings: ['usage_ledger_unavailable'],
  }, {
    ASSISTANT_NAME: 'Hermes',
    PORT: '8788',
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_STREAMING_ENABLED: 'true',
  }, {
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.equal(state.ok, true);
  assert.equal(state.assistant, 'Hermes');
  assert.equal(state.service.port, 8788);
  assert.equal(state.service.asyncWebhook, true);
  assert.equal(state.service.streaming, true);
  assert.equal(state.tasks.counts.failed, 1);
  assert.equal(state.usage.totalTokens, 200);
  assert.equal(state.mail.todayCount, 1);
  assert.equal(state.snapshot.runCount, 1);
  assert.deepEqual(state.warnings, ['usage_ledger_unavailable']);
});

test('buildDashboardHtml renders escaped dashboard data', () => {
  const html = buildDashboardHtml({
    generatedAt: '2026-05-07T00:00:00.000Z',
    assistant: 'Hermes <script>',
    service: { commit: 'abc1234' },
    tasks: {
      counts: { today: 1, running: 0, failed: 0, recoverable: 0 },
      byType: [{ label: 'UI <自动化>', today: 1, running: 0, failed: 0, total: 1 }],
    },
    plan: { tomorrowPlan: ['继续跑测试'] },
    pipeline: {},
    usage: { totalTokens: 0, realTokens: 0, estimatedTokens: 0, entries: [] },
    mail: { todayCount: 0, totalCount: 0, todayEntries: [] },
    snapshot: {},
    warnings: [],
  });

  assert.match(html, /OpenClaw\/Hermes 控制台/);
  assert.match(html, /Hermes &lt;script&gt;/);
  assert.match(html, /UI &lt;自动化&gt;/);
  assert.doesNotMatch(html, /Hermes <script>/);
});

test('escapeHtml escapes special characters', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
