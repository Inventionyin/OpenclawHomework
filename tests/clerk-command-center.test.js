const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildClerkCommandCenterReply,
  buildClerkCommandCenterState,
  buildClerkDailyReportReply,
} = require('../scripts/agents/clerk-command-center');

function samplePlan() {
  return {
    todaySummaryText: '今天任务 4 个，完成 2 个，失败 1 个，运行中 1 个。',
    tomorrowPlan: [
      '优先复盘失败任务：UI 自动化 ui-fail。',
      '补一轮 UI 自动化冒烟或 contracts 任务，顺手归档 Allure/Actions 链接。',
    ],
  };
}

function sampleTaskSummary() {
  return {
    counts: {
      total: 6,
      today: 4,
      queued: 0,
      running: 1,
      completed: 2,
      failed: 1,
      interrupted: 0,
      recoverable: 1,
    },
    byType: [
      {
        type: 'ui-automation',
        label: 'UI 自动化',
        total: 3,
        today: 2,
        running: 1,
        completed: 0,
        failed: 1,
      },
      {
        type: 'daily-digest',
        label: '主动日报',
        total: 1,
        today: 1,
        running: 0,
        completed: 1,
        failed: 0,
      },
    ],
    latest: { id: 'ui-fail', type: 'ui-automation', status: 'failed' },
    recoverableTasks: [{ id: 'ui-stale', type: 'ui-automation', status: 'running' }],
    todayTasks: [],
  };
}

test('buildClerkCommandCenterState gathers injected task, ledger, mail, and snapshot data', () => {
  const calls = [];
  const now = new Date('2026-05-06T04:00:00.000Z');
  const env = { LOCAL_PROJECT_DIR: '/workspace/openclaw' };

  const state = buildClerkCommandCenterState({
    env,
    now,
    summarizeDailyPlan: (input) => {
      calls.push(['plan', input.env, input.now]);
      return samplePlan();
    },
    summarizeTasks: (input) => {
      calls.push(['tasks', input.env, input.now]);
      return sampleTaskSummary();
    },
    readUsageLedger: (inputEnv, limit) => {
      calls.push(['usage', inputEnv, limit]);
      return [
        { timestamp: '2026-05-06T03:00:00.000Z', assistant: 'OpenClaw', totalTokens: 120, modelElapsedMs: 500 },
        { timestamp: '2026-05-06T03:10:00.000Z', assistant: 'Hermes', estimatedTotalTokens: 80, modelElapsedMs: 700 },
      ];
    },
    readMailLedger: (inputEnv, limit) => {
      calls.push(['mail', inputEnv, limit]);
      return [
        { timestamp: '2026-05-06T02:00:00.000Z', action: 'daily', sent: true },
        { timestamp: '2026-05-05T02:00:00.000Z', action: 'archive', sent: false },
      ];
    },
    readDailySummarySnapshot: (inputEnv) => {
      calls.push(['snapshot', inputEnv]);
      return {
        runs: [
          {
            id: 42,
            conclusion: 'success',
            runUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/42',
            artifactsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/42#artifacts',
            targetRef: 'main',
            runMode: 'contracts',
          },
        ],
      };
    },
  });

  assert.equal(state.plan.todaySummaryText, samplePlan().todaySummaryText);
  assert.equal(state.tasks.counts.today, 4);
  assert.equal(state.usage.entries.length, 2);
  assert.equal(state.usage.totalTokens, 200);
  assert.equal(state.mail.entries.length, 2);
  assert.equal(state.mail.todayEntries.length, 1);
  assert.equal(state.snapshot.latestRun.id, 42);
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(calls.map((call) => call[0]), ['plan', 'tasks', 'usage', 'mail', 'snapshot']);
});

test('buildClerkCommandCenterReply renders a one-screen overview with next actions', () => {
  const reply = buildClerkCommandCenterReply({
    now: new Date('2026-05-06T04:00:00.000Z'),
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => [
      { assistant: 'OpenClaw', totalTokens: 120 },
      { assistant: 'Hermes', estimatedTotalTokens: 80 },
    ],
    readMailLedger: () => [
      { timestamp: '2026-05-06T02:00:00.000Z', sent: true },
    ],
    readDailySummarySnapshot: () => ({
      runs: [
        {
          id: 42,
          runUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/42',
          targetRef: 'main',
          runMode: 'contracts',
        },
      ],
    }),
  });

  assert.match(reply, /文员总控：今天一屏看懂/);
  assert.match(reply, /今天任务 4 个/);
  assert.match(reply, /UI 自动化：今天 2 个/);
  assert.match(reply, /模型账本：2 条/);
  assert.match(reply, /邮件流水：今天 1 条/);
  assert.match(reply, /actions\/runs\/42/);
  assert.match(reply, /文员，发送今天日报到邮箱/);
  assert.match(reply, /文员，查看失败任务/);
});

test('buildClerkCommandCenterState degrades bad ledgers and broken snapshots', () => {
  const state = buildClerkCommandCenterState({
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => {
      throw new Error('usage ledger is broken');
    },
    readMailLedger: () => 'not an array',
    readDailySummarySnapshot: () => {
      throw new Error('snapshot json is broken');
    },
  });

  assert.deepEqual(state.usage.entries, []);
  assert.deepEqual(state.mail.entries, []);
  assert.deepEqual(state.snapshot.runs, []);
  assert(state.warnings.includes('usage_ledger_unavailable'));
  assert(state.warnings.includes('mail_ledger_unavailable'));
  assert(state.warnings.includes('daily_snapshot_unavailable'));

  const reply = buildClerkCommandCenterReply({
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => {
      throw new Error('usage ledger is broken');
    },
    readMailLedger: () => 'not an array',
    readDailySummarySnapshot: () => {
      throw new Error('snapshot json is broken');
    },
  });
  assert.match(reply, /模型账本：暂无可用记录/);
  assert.match(reply, /邮件流水：暂无可用记录/);
  assert.match(reply, /日报快照：暂无最近 run/);
  assert.match(reply, /降级提示/);
});

test('buildClerkDailyReportReply builds daily preview from plan, snapshot, and usage ledger', () => {
  const buildCalls = [];
  const reply = buildClerkDailyReportReply({ recipientEmail: 'classmate@example.com' }, {
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => [
      { assistant: 'OpenClaw', totalTokens: 120 },
    ],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({
      runs: [
        {
          id: 42,
          conclusion: 'success',
          runUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/42',
        },
      ],
    }),
    buildDailySummary: (input) => {
      buildCalls.push(input);
      return {
        text: `日报正文：${input.runs.length} runs，${input.usageEntries.length} usage，${input.recipientEmail}`,
        html: '<div>ok</div>',
      };
    },
  });

  assert.match(reply, /文员日报预览/);
  assert.match(reply, /今天任务 4 个/);
  assert.match(reply, /优先复盘失败任务/);
  assert.match(reply, /日报正文：1 runs，1 usage，classmate@example.com/);
  assert.match(reply, /服务器部分仍建议只引用状态摘要/);
  assert.equal(buildCalls.length, 1);
  assert.equal(buildCalls[0].runs[0].id, 42);
});

test('buildClerkDailyReportReply degrades broken ledger and snapshot readers', () => {
  const reply = buildClerkDailyReportReply({}, {
    summarizeDailyPlan: () => samplePlan(),
    readUsageLedger: () => {
      throw new Error('usage ledger broken');
    },
    readDailySummarySnapshot: () => 'broken snapshot',
    buildDailySummary: (input) => ({
      text: `日报正文：${input.runs.length} runs，${input.usageEntries.length} usage`,
    }),
  });

  assert.match(reply, /文员日报预览/);
  assert.match(reply, /日报正文：0 runs，0 usage/);
  assert.match(reply, /服务器部分仍建议只引用状态摘要/);
});
