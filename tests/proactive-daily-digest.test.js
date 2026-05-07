const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildDigest,
  fallbackNewsItems,
  getDayKey,
  parseArgs,
  runDigest,
} = require('../scripts/proactive-daily-digest');

test('getDayKey uses China timezone by default', () => {
  assert.equal(getDayKey(new Date('2026-05-05T16:00:00.000Z'), 480), '2026-05-06');
});

test('buildDigest creates a polished proactive agent report', () => {
  const digest = buildDigest({
    assistant: 'Hermes',
    day: '2026-05-06',
    mailEntries: [
      { sent: true, action: 'daily', recipientCount: 2 },
      { sent: false, action: 'report', recipientCount: 1 },
    ],
    usageEntries: [
      { assistant: 'Hermes', totalTokens: 120, modelElapsedMs: 2000 },
      { assistant: 'OpenClaw', estimatedTotalTokens: 80, modelElapsedMs: 1000 },
    ],
    server: {
      disk: '/dev/vda1 40G 20G 20G 50% /',
      memory: 'Mem: 2.0Gi 800Mi 1.2Gi',
      load: '0.01 0.02 0.03',
    },
    newsItems: [
      { title: 'AI Agent 工作流继续进化。', source: 'AI' },
    ],
    externalTo: ['1693457391@qq.com'],
  });

  assert.equal(digest.action, 'daily');
  assert.match(digest.subject, /Hermes 每日主动报告 2026-05-06/);
  assert.match(digest.text, /收发信：1 封成功 \/ 1 封失败/);
  assert.match(digest.text, /模型：2 次调用 \/ 200 tokens/);
  assert.match(digest.text, /真实 120/);
  assert.match(digest.text, /字符估算 80/);
  assert.match(digest.text, /失败诊断/);
  assert.match(digest.text, /邮件归档/);
  assert.match(digest.text, /新闻日报/);
  assert.match(digest.html, /每日主动报告/);
  assert.match(digest.html, /失败诊断/);
  assert.match(digest.html, /邮件归档/);
  assert.match(digest.html, /服务器状态/);
});

test('fallbackNewsItems supports configured custom items', () => {
  const items = fallbackNewsItems({
    PROACTIVE_DIGEST_NEWS_ITEMS: 'AI测试工具更新|GitHub热门项目跟踪',
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'AI测试工具更新');
});

test('parseArgs reads digest command options', () => {
  assert.deepEqual(parseArgs(['--once', '--dry-run', '--force', '--to', 'a@example.com', '--day', '2026-05-06']), {
    once: true,
    dryRun: true,
    force: true,
    to: 'a@example.com',
    day: '2026-05-06',
  });
});

test('runDigest dry-run builds message and respects already-sent state', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'proactive-digest-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const mailLedgerPath = join(tempDir, 'mail.jsonl');
    const usageLedgerPath = join(tempDir, 'usage.jsonl');
    writeFileSync(mailLedgerPath, `${JSON.stringify({
      timestamp: '2026-05-05T16:10:00.000Z',
      assistant: 'Hermes',
      action: 'daily',
      sent: true,
      recipientCount: 2,
    })}\n`);
    writeFileSync(usageLedgerPath, `${JSON.stringify({
      timestamp: '2026-05-05T16:12:00.000Z',
      assistant: 'Hermes',
      totalTokens: 50,
    })}\n`);

    const result = await runDigest({
      dryRun: true,
      force: true,
      skipNews: true,
      day: '2026-05-06',
      stateFile,
      to: '1693457391@qq.com',
      env: {
        FEISHU_ASSISTANT_NAME: 'Hermes',
        MAIL_LEDGER_PATH: mailLedgerPath,
        FEISHU_USAGE_LEDGER_PATH: usageLedgerPath,
      },
    });

    assert.equal(result.reason, 'dry_run');
    assert.match(result.message.subject, /Hermes 每日主动报告/);
    assert.match(result.message.text, /50 tokens/);

    writeFileSync(stateFile, `${JSON.stringify({ lastSentDay: '2026-05-06' })}\n`);
    const skipped = await runDigest({
      day: '2026-05-06',
      stateFile,
      skipNews: true,
      to: '1693457391@qq.com',
      env: {
        MAIL_LEDGER_PATH: mailLedgerPath,
        FEISHU_USAGE_LEDGER_PATH: usageLedgerPath,
      },
    });
    assert.equal(skipped.reason, 'already_sent');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runDigest reads trend token summary for the requested report day', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'proactive-digest-trend-day-'));
  const currentDay = getDayKey(new Date(), 480);
  const targetDay = currentDay === '2099-01-01' ? '2099-01-02' : '2099-01-01';
  try {
    const stateFile = join(tempDir, 'state.json');
    const targetDir = join(tempDir, 'data', 'trend-token-factory', targetDay);
    const currentDir = join(tempDir, 'data', 'trend-token-factory', currentDay);
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(join(targetDir, 'summary.json'), `${JSON.stringify({
      totalJobs: 1,
      failedJobs: 0,
      totalTokens: 111,
      estimatedTotalTokens: 222,
      followUpProjects: ['target-day-project'],
    })}\n`);
    writeFileSync(join(currentDir, 'summary.json'), `${JSON.stringify({
      totalJobs: 1,
      failedJobs: 0,
      totalTokens: 999,
      estimatedTotalTokens: 888,
      followUpProjects: ['current-day-project'],
    })}\n`);

    const result = await runDigest({
      dryRun: true,
      force: true,
      skipNews: true,
      day: targetDay,
      stateFile,
      to: '1693457391@qq.com',
      env: {
        LOCAL_PROJECT_DIR: tempDir,
        FEISHU_ASSISTANT_NAME: 'Hermes',
      },
    });

    assert.match(result.message.text, /target-day-project/);
    assert.match(result.message.text, /111/);
    assert.doesNotMatch(result.message.text, /current-day-project/);
    assert.doesNotMatch(result.message.text, /999/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildDigest uses task-center summary for today and tomorrow plan when provided', () => {
  const digest = buildDigest({
    assistant: 'OpenClaw',
    day: '2026-05-06',
    mailEntries: [],
    usageEntries: [],
    server: {
      disk: '/dev/vda1 40G 20G 20G 50% /',
      memory: 'Mem: 2.0Gi 800Mi 1.2Gi',
      load: '0.01 0.02 0.03',
    },
    newsItems: [
      { title: 'Playwright released new contracts helpers.', source: 'QA' },
    ],
    taskCenterPlan: {
      todaySummaryText: '今天任务 4 个，完成 2 个，失败 1 个，运行中 1 个。',
      tomorrowPlan: [
        '优先复盘失败任务：新闻摘要 news-1。',
        '恢复中断或超时任务：token 工厂 tf-1。',
      ],
      failureDiagnosisText: '失败诊断：新闻摘要 news-1 是 RSS 超时。',
    },
  });

  assert.match(digest.text, /今天任务 4 个/);
  assert.match(digest.text, /RSS 超时/);
  assert.match(digest.text, /优先复盘失败任务/);
  assert.match(digest.html, /今天任务 4 个/);
  assert.match(digest.html, /RSS 超时/);
  assert.match(digest.html, /恢复中断或超时任务/);
});

test('buildDigest includes trend intelligence and trend token factory highlights', () => {
  const digest = buildDigest({
    assistant: 'Hermes',
    day: '2026-05-07',
    mailEntries: [],
    usageEntries: [],
    server: {
      disk: '/dev/vda1 40G 15G 25G 38% /',
      memory: 'Mem: 2.0Gi 700Mi 1.3Gi',
      load: '0.01 0.02 0.03',
    },
    newsItems: [],
    trendIntelSummary: {
      total: 2,
      items: [
        { title: 'microsoft/playwright', source: 'GitHub Trending', link: 'https://github.com/microsoft/playwright', stars: 71000 },
        { title: 'Browser agent evals', source: 'Hacker News', link: 'https://news.ycombinator.com/item?id=42' },
      ],
    },
    trendTokenSummary: {
      totalJobs: 2,
      failedJobs: 0,
      totalTokens: 1200,
      estimatedTotalTokens: 1800,
      followUpProjects: ['microsoft/playwright'],
    },
  });

  assert.match(digest.text, /趋势情报/);
  assert.match(digest.text, /microsoft\/playwright/);
  assert.match(digest.text, /GitHub Trending/);
  assert.match(digest.text, /趋势 Token 工厂/);
  assert.match(digest.text, /1200/);
  assert.match(digest.text, /1800/);
  assert.match(digest.text, /推荐关注：microsoft\/playwright/);
  assert.match(digest.html, /趋势情报/);
  assert.match(digest.html, /趋势 Token 工厂/);
  assert.match(digest.html, /microsoft\/playwright/);
});
