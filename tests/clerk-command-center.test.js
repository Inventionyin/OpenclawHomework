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

test('buildClerkCommandCenterState enriches task summary from task-center digest when available', () => {
  const state = buildClerkCommandCenterState({
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    summarizeTaskCenterDigest: () => ({
      todaySummary: '主动任务总结：UI、新闻、日报都已接入任务中枢。',
      tomorrowPlan: [
        '先复盘 news-digest 失败项。',
        '再跑一轮 UI contracts。',
      ],
      failedItems: [
        { id: 'news-fail', type: 'news-digest', error: 'rss timeout' },
      ],
      recoverableItems: [
        { id: 'token-stale', type: 'token-factory' },
      ],
      nextSuggestedActions: [
        '文员，查看失败任务',
        '文员，恢复 token-stale',
      ],
    }),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({ runs: [] }),
  });

  assert.equal(state.tasks.todaySummaryText, '主动任务总结：UI、新闻、日报都已接入任务中枢。');
  assert.deepEqual(state.tasks.tomorrowPlanText, [
    '先复盘 news-digest 失败项。',
    '再跑一轮 UI contracts。',
  ]);
  assert.deepEqual(state.tasks.blockers, [
    '新闻摘要 news-fail：rss timeout',
    'token 工厂 token-stale：可恢复',
  ]);
  assert.deepEqual(state.tasks.quickCommands, [
    '文员，查看失败任务',
    '文员，恢复 token-stale',
  ]);
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
  assert.match(reply, /今日总结：/);
  assert.match(reply, /明日计划：/);
  assert.match(reply, /当前卡点：/);
  assert.match(reply, /可复制指令：/);
  assert.match(reply, /今天任务 4 个/);
  assert.match(reply, /UI 自动化：今天 2 个/);
  assert.match(reply, /模型账本：2 条/);
  assert.match(reply, /邮件流水：今天 1 条/);
  assert.match(reply, /actions\/runs\/42/);
  assert.match(reply, /文员，发送今天日报到邮箱/);
  assert.match(reply, /文员，查看失败任务/);
});

test('buildClerkCommandCenterReply includes daily pipeline stage diagnosis when available', () => {
  const reply = buildClerkCommandCenterReply({
    now: new Date('2026-05-06T04:00:00.000Z'),
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    summarizeDailyPipeline: () => ({
      day: '2026-05-06',
      totalStages: 4,
      completedStages: 3,
      failedStages: 1,
      failedStageIds: ['scheduled-ui'],
      stageStatuses: [
        { id: 'news-digest', status: 'completed' },
        { id: 'scheduled-ui', status: 'failed', reason: 'runner_failed' },
        { id: 'scheduled-token-lab', status: 'completed' },
      ],
      failureDiagnosis: 'scheduled-ui 失败：runner_failed。',
      nextAction: '先修复 scheduled-ui，再重跑每日流水线。',
    }),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({ runs: [] }),
  });

  assert.match(reply, /每日流水线/);
  assert.match(reply, /3\/4/);
  assert.match(reply, /scheduled-ui/);
  assert.match(reply, /先修复 scheduled-ui/);
});

test('buildClerkCommandCenterReply uses enhanced task-center sections when provided', () => {
  const reply = buildClerkCommandCenterReply({
    now: new Date('2026-05-06T04:00:00.000Z'),
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => ({
      ...sampleTaskSummary(),
      todaySummaryText: '增强版今日总结：总计 6，失败 1，运行中 1。',
      tomorrowPlanText: [
        '优先清理 ui-stale 并重试 ui-fail。',
        '补一轮 contracts 回归并记录产物链接。',
      ],
      blockers: [
        'ui-fail 仍缺少最新截图。',
        'ui-stale 超时未回收。',
      ],
      quickCommands: [
        '文员，查看失败任务',
        '文员，恢复任务 ui-stale',
      ],
    }),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({ runs: [] }),
  });

  assert.match(reply, /今日总结：[\s\S]*增强版今日总结：总计 6，失败 1，运行中 1。/);
  assert.match(reply, /明日计划：[\s\S]*优先清理 ui-stale 并重试 ui-fail。/);
  assert.match(reply, /当前卡点：[\s\S]*ui-fail 仍缺少最新截图。/);
  assert.match(reply, /可复制指令：[\s\S]*文员，恢复任务 ui-stale/);
});

test('buildClerkCommandCenterReply renders task-center brain sections when available', () => {
  const reply = buildClerkCommandCenterReply({
    now: new Date('2026-05-06T04:00:00.000Z'),
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    summarizeTaskCenterBrain: () => ({
      today: {
        summaryText: '主控脑今日任务：UI 1 个，日报 1 个。',
      },
      history: {
        summaryText: '近 7 天历史任务 8 个，失败 2 个。',
      },
      failureReview: {
        summaryText: '最近失败集中在 news-digest：rss timeout。',
        items: [
          { id: 'news-fail', type: 'news-digest', error: 'rss timeout' },
        ],
      },
      nextPlan: {
        items: [
          '先复盘 news-fail，再重跑新闻摘要。',
          '随后补跑 UI contracts。',
        ],
        quickCommands: [
          '文员，查看失败任务',
          '文员，启动今天的自动流水线',
        ],
      },
    }),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({ runs: [] }),
  });

  assert.match(reply, /今日任务：/);
  assert.match(reply, /历史任务：/);
  assert.match(reply, /失败复盘：/);
  assert.match(reply, /下一步计划：/);
  assert.match(reply, /主控脑今日任务/);
  assert.match(reply, /近 7 天历史任务/);
  assert.match(reply, /rss timeout/);
  assert.match(reply, /文员，启动今天的自动流水线/);
});

test('buildClerkCommandCenterState gathers trend radar report when available', () => {
  const state = buildClerkCommandCenterState({
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({ runs: [] }),
    readTrendIntelReport: () => ({
      generatedAt: '2026-05-07T00:00:00.000Z',
      total: 2,
      learningRadar: {
        items: [
          {
            projectName: 'microsoft/playwright',
            usefulFor: 'UI 自动化 / AI Agent',
            nextStep: '看 README / 跑 demo / 借鉴测试用例',
            link: 'https://github.com/microsoft/playwright',
          },
        ],
      },
    }),
  });

  assert.equal(state.trendIntel.total, 2);
  assert.equal(state.trendIntel.learningRadar.items[0].projectName, 'microsoft/playwright');
});

test('buildClerkCommandCenterReply includes explicit ui and trend radar signals', () => {
  const reply = buildClerkCommandCenterReply({
    now: new Date('2026-05-06T04:00:00.000Z'),
    summarizeDailyPlan: () => samplePlan(),
    summarizeTasks: () => sampleTaskSummary(),
    readUsageLedger: () => [],
    readMailLedger: () => [],
    readDailySummarySnapshot: () => ({
      runs: [
        {
          id: 77,
          conclusion: 'failure',
          runUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/77',
          targetRef: 'main',
          runMode: 'smoke',
        },
      ],
    }),
    readTrendIntelReport: () => ({
      generatedAt: '2026-05-07T00:00:00.000Z',
      total: 3,
      learningRadar: {
        items: [
          {
            projectName: 'microsoft/playwright',
            usefulFor: 'UI 自动化 / AI Agent',
            nextStep: '看 README / 跑 demo / 借鉴测试用例',
            link: 'https://github.com/microsoft/playwright',
          },
        ],
      },
    }),
  });

  assert.match(reply, /UI 自动化状态：最近 failure/);
  assert.match(reply, /开源学习雷达：3 条/);
  assert.match(reply, /microsoft\/playwright/);
  assert.match(reply, /借鉴测试用例/);
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
  assert.match(reply, /今日总结：/);
  assert.match(reply, /明日计划：/);
  assert.match(reply, /失败诊断：/);
  assert.match(reply, /token 消耗：/);
  assert.match(reply, /邮件归档：/);
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
