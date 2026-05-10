const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildProactiveThinkerReport,
  buildProactiveThinkerEmailMessage,
  formatProactiveThinkerMarkdown,
  formatProactiveThinkerReply,
  loadThinkerInputs,
  runProactiveThinker,
} = require('../scripts/proactive-thinker');
const {
  buildClerkAgentReply,
} = require('../scripts/agents/agent-handlers');
const {
  routeAgentIntent,
} = require('../scripts/agents/router');
const {
  findRegisteredSkill,
} = require('../scripts/skills/skill-registry');
const {
  routeSkillIntent,
} = require('../scripts/skills/skill-router');
const {
  listTasks,
} = require('../scripts/background-task-store');

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

test('loadThinkerInputs reads news, hot monitor, trend intel and optional usage files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'proactive-thinker-inputs-'));
  const worldFile = join(tempDir, 'world.json');
  const hotFile = join(tempDir, 'hot.json');
  const trendFile = join(tempDir, 'trend.json');
  const usageFile = join(tempDir, 'usage.jsonl');

  try {
    writeJson(worldFile, { items: [{ title: 'Global AI policy', source: 'World RSS' }] });
    writeJson(hotFile, { items: [{ title: 'Free AI token trial', source: 'V2EX' }] });
    writeJson(trendFile, { learningRadar: { items: [{ projectName: 'microsoft/playwright', source: 'GitHub Trending daily' }] } });
    writeFileSync(usageFile, `${JSON.stringify({ assistant: 'Hermes', model: 'longcat', totalTokens: 1234 })}\n`, 'utf8');

    const inputs = loadThinkerInputs({
      WORLD_NEWS_OUTPUT_FILE: worldFile,
      HOT_MONITOR_OUTPUT_FILE: hotFile,
      TREND_INTEL_OUTPUT_FILE: trendFile,
      USAGE_LEDGER_PATH: usageFile,
    });

    assert.equal(inputs.worldNews.items.length, 1);
    assert.equal(inputs.hotMonitor.items.length, 1);
    assert.equal(inputs.trendIntel.items.length, 1);
    assert.equal(inputs.usageLedger.entries.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildProactiveThinkerReport merges signals and separates pending confirmations', () => {
  const report = buildProactiveThinkerReport({
    worldNews: { items: [{ title: 'AI policy shift', source: 'World RSS', summary: 'Policy update' }] },
    hotMonitor: { items: [{ title: 'Free server campaign', source: '福利论坛', summary: 'May expire soon' }] },
    trendIntel: { items: [{ title: 'browserbase/stagehand', source: 'GitHub Trending', summary: 'AI browser automation' }] },
    taskCenterBrain: {
      today: { summaryText: '今天任务 2 个，完成 1 个。' },
      failureReview: { summaryText: '最近没有失败任务。' },
      nextPlan: { items: ['补一轮 UI 自动化 smoke。'] },
    },
    usageLedger: { entries: [{ assistant: 'Hermes', model: 'longcat', totalTokens: 2048 }] },
  }, {
    now: new Date('2026-05-10T01:00:00.000Z'),
    creativeLabResult: {
      status: 'awaiting_confirmation',
      selected: [{
        title: '核验福利线索：Free server campaign',
        risk: 'medium',
        source: '福利论坛',
        suggestedPrompt: '先核验，不自动注册',
      }],
      autoRunnable: [],
      pendingConfirmation: [{ title: '核验福利线索：Free server campaign', risk: 'medium' }],
    },
  });

  assert.equal(report.status, 'awaiting_confirmation');
  assert.equal(report.pendingConfirmations.length, 1);
  assert.equal(report.sections.worldNews.items[0].title, 'AI policy shift');
  assert.equal(report.sections.trendIntel.items[0].title, 'browserbase/stagehand');
  assert.equal(report.email.recommended, true);
  assert.equal(report.email.shouldSend, false);
  assert.match(report.summary, /主动思考/);
});

test('formatProactiveThinkerMarkdown and reply redact secret-like content', () => {
  const report = buildProactiveThinkerReport({
    worldNews: { items: [{ title: 'token sk-abcdefghijklmnopqrstuvwxyz', source: 'World RSS' }] },
    hotMonitor: { items: [] },
    trendIntel: { items: [] },
    taskCenterBrain: { today: { summaryText: 'ak_abcdefghijklmnopqrstuvwxyz should hide' } },
  }, {
    now: new Date('2026-05-10T01:00:00.000Z'),
    creativeLabResult: { selected: [], autoRunnable: [], pendingConfirmation: [] },
  });

  const markdown = formatProactiveThinkerMarkdown(report);
  const reply = formatProactiveThinkerReply(report);

  assert.match(markdown, /Hermes 主动思考报告/);
  assert.match(reply, /Hermes 主动思考器/);
  assert.match(markdown, /\[redacted\]/);
  assert.doesNotMatch(markdown, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(reply, /ak_abcdefghijklmnopqrstuvwxyz/);
});

test('runProactiveThinker writes json markdown artifacts and records task-center event', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'proactive-thinker-run-'));
  const taskDir = join(tempDir, 'tasks');
  const outputDir = join(tempDir, 'thinker');

  try {
    const result = runProactiveThinker({
      env: { TOKEN_FACTORY_TASK_DIR: taskDir, PROACTIVE_THINKER_OUTPUT_DIR: outputDir },
      now: new Date('2026-05-10T02:00:00.000Z'),
      inputs: {
        worldNews: { items: [{ title: 'AI safety summit', source: 'World RSS' }] },
        hotMonitor: { items: [] },
        trendIntel: { items: [{ title: 'microsoft/playwright', source: 'GitHub Trending' }] },
        usageLedger: { entries: [] },
        taskCenterBrain: { today: { summaryText: '今天任务 1 个。' }, failureReview: {}, nextPlan: { items: [] } },
      },
      creativeLabRunner: () => ({
        status: 'completed',
        selected: [{ title: '拆一个开源学习样本：microsoft/playwright', risk: 'low', source: 'GitHub Trending' }],
        autoRunnable: [{ title: '拆一个开源学习样本：microsoft/playwright' }],
        pendingConfirmation: [],
      }),
    });

    assert.equal(result.report.status, 'completed');
    assert.equal(existsSync(result.files.json), true);
    assert.equal(existsSync(result.files.markdown), true);
    assert.match(readFileSync(result.files.markdown, 'utf8'), /microsoft\/playwright/);

    const [task] = listTasks({ TOKEN_FACTORY_TASK_DIR: taskDir });
    assert.equal(task.type, 'proactive-thinker');
    assert.equal(task.status, 'completed');
    assert.equal(task.summary.pendingConfirmationCount, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runProactiveThinker sends email only when explicitly requested', async () => {
  const sent = [];
  const result = await runProactiveThinker({
    email: true,
    env: {
      PROACTIVE_THINKER_EMAIL_TO: 'owner@example.com',
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    writeArtifacts: false,
    recordTask: false,
    now: new Date('2026-05-10T03:00:00.000Z'),
    inputs: {
      worldNews: { items: [{ title: 'Global market shift', source: 'World RSS' }] },
      hotMonitor: { items: [] },
      trendIntel: { items: [] },
      usageLedger: { entries: [] },
      taskCenterBrain: { today: { summaryText: '今天任务 0 个。' }, failureReview: {}, nextPlan: { items: [] } },
    },
    creativeLabRunner: () => ({ selected: [], autoRunnable: [], pendingConfirmation: [] }),
    emailSender: async (message) => {
      sent.push(message);
      return { sent: true, id: 'mail-1' };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'owner@example.com');
  assert.match(sent[0].subject, /主动思考报告/);
  assert.equal(result.emailResult.sent, true);

  const message = buildProactiveThinkerEmailMessage(result.report, {
    PROACTIVE_THINKER_EMAIL_TO: 'owner@example.com',
  });
  assert.deepEqual(message.to, ['owner@example.com']);
});

test('router skill registry and clerk handler expose proactive thinker commands', async () => {
  assert.deepEqual(routeAgentIntent('文员，今天你自己想了什么？'), {
    agent: 'clerk-agent',
    action: 'proactive-thinker',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把今天主动思考报告发到邮箱'), {
    agent: 'clerk-agent',
    action: 'proactive-thinker-email',
    requiresAuth: true,
  });
  assert.deepEqual(routeSkillIntent('文员，主动任务报告'), {
    agent: 'clerk-agent',
    action: 'proactive-thinker',
    skillId: 'proactive-thinker',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });
  assert.equal(findRegisteredSkill('proactive-thinker').category, '项目总控');

  const reply = await buildClerkAgentReply({ action: 'proactive-thinker' }, {
    runProactiveThinker: () => ({
      report: {
        status: 'completed',
        generatedAt: '2026-05-10T03:00:00.000Z',
        summary: '主动思考完成，整理了 1 条线索。',
        sections: {
          worldNews: { items: [{ title: 'Global market shift', source: 'World RSS' }] },
          trendIntel: { items: [] },
          hotMonitor: { items: [] },
          taskCenter: { todaySummary: '今天任务 0 个。', failureSummary: '暂无失败。', nextPlan: [] },
        },
        creative: { selected: [], autoRunnable: [] },
        pendingConfirmations: [],
        files: { markdown: '/tmp/proactive-thinker.md' },
        email: { recommended: true, shouldSend: false },
      },
      files: { markdown: '/tmp/proactive-thinker.md' },
    }),
  });

  assert.match(reply, /Hermes 主动思考器/);
  assert.match(reply, /Global market shift/);
  assert.match(reply, /发到邮箱/);
});
