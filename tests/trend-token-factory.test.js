const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildTrendTokenPlan,
  buildTrendTokenPrompt,
  buildTrendTokenReport,
  parseArgs,
  runTrendTokenFactory,
} = require('../scripts/trend-token-factory');

function sampleTrendReport() {
  return {
    generatedAt: '2026-05-07T00:00:00.000Z',
    items: [
      {
        id: 'github-search:microsoft/playwright',
        kind: 'github-search',
        source: 'GitHub Search',
        title: 'microsoft/playwright',
        summary: 'Reliable end-to-end testing for modern web apps',
        link: 'https://github.com/microsoft/playwright',
        stars: 71000,
        language: 'TypeScript',
        topic: 'playwright',
      },
      {
        id: 'github-trending:browserbase/stagehand',
        kind: 'github-trending',
        source: 'GitHub Trending',
        title: 'browserbase/stagehand',
        summary: 'AI browser automation',
        link: 'https://github.com/browserbase/stagehand',
        stars: 9900,
        language: 'Python',
      },
      {
        id: 'hn:42',
        kind: 'hacker-news',
        source: 'Hacker News',
        title: 'Show HN: UI agent eval harness',
        summary: 'HN discussion about browser agents',
        link: 'https://news.ycombinator.com/item?id=42',
      },
      {
        id: 'rss:release',
        kind: 'rss',
        source: 'Release Feed',
        title: 'Playwright release notes',
        summary: 'New browser automation release',
        link: 'https://example.com/release',
      },
    ],
  };
}

test('buildTrendTokenPlan turns trend items into four analysis job types', () => {
  const plan = buildTrendTokenPlan(sampleTrendReport(), { batchSize: 4 });

  assert.equal(plan.jobs.length, 4);
  assert.deepEqual(plan.jobs.map((job) => job.kind), [
    'github-repo',
    'trending-repo',
    'hn-story',
    'rss-news',
  ]);
  assert.equal(plan.jobs[0].id, 'trend-github-repo-001');
  assert.equal(plan.jobs[0].assistant, 'Hermes');
  assert.equal(plan.jobs[0].source, 'GitHub Search');
  assert.equal(plan.batchSize, 4);
});

test('buildTrendTokenPrompt asks in Chinese for JSON trend learning analysis', () => {
  const plan = buildTrendTokenPlan(sampleTrendReport(), { batchSize: 1 });
  const prompt = buildTrendTokenPrompt(plan.jobs[0]);

  assert.match(prompt, /请只返回一个 JSON 对象/);
  assert.match(prompt, /软件测试学习价值/);
  assert.match(prompt, /UI 自动化可借鉴点/);
  assert.match(prompt, /电商\/客服训练数据/);
  assert.match(prompt, /是否值得跟进/);
  assert.match(prompt, /3 个行动建议/);
  assert.match(prompt, /microsoft\/playwright/);
});

test('parseArgs supports scheduled CLI input output and email toggles', () => {
  assert.deepEqual(parseArgs([
    '--batch-size', '8',
    '--input', '/tmp/trend/latest.json',
    '--output-dir', '/tmp/trend/out',
    '--env-file', '/etc/hermes.env',
    '--no-email',
  ]), {
    batchSize: '8',
    input: '/tmp/trend/latest.json',
    outputDir: '/tmp/trend/out',
    envFile: '/etc/hermes.env',
    email: false,
  });
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('runTrendTokenFactory writes artifacts, usage ledger and report mailbox digest', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'trend-token-factory-'));
  const ledgerPath = join(tempDir, 'usage.jsonl');
  const sentMessages = [];
  const seenPrompts = [];

  try {
    const result = await runTrendTokenFactory({
      trendReport: sampleTrendReport(),
      batchSize: 4,
      outputDir: tempDir,
      env: {
        FEISHU_USAGE_LEDGER_ENABLED: 'true',
        FEISHU_USAGE_LEDGER_PATH: ledgerPath,
      },
      modelRunner: async (prompt, job) => {
        seenPrompts.push(prompt);
        if (job.kind === 'hn-story') {
          throw new Error('model timeout');
        }
        if (job.kind === 'trending-repo') {
          return {
            text: '这不是 JSON，但值得保留原文',
            model: 'LongCat-Flash-Chat',
            tier: job.modelTier,
            endpoint: 'chat_completions',
          };
        }
        return {
          text: JSON.stringify({
            id: job.id,
            learning_value: '高',
            ui_automation_takeaways: ['等待策略'],
            commerce_support_training_data: ['售后咨询'],
            worth_following: true,
            action_suggestions: ['复现 demo', '写测试清单', '归档案例'],
          }),
          model: 'LongCat-Flash-Thinking',
          tier: job.modelTier,
          endpoint: 'responses',
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        };
      },
      emailSender: async (message) => {
        sentMessages.push(message);
        return { sent: true };
      },
    });

    assert.equal(seenPrompts.length, 4);
    assert.equal(result.items.length, 4);
    assert.equal(result.report.totalJobs, 4);
    assert.equal(result.report.failedJobs, 1);
    assert.equal(result.report.totalTokens, 260);
    assert.equal(result.items[1].parsed.raw, '这不是 JSON，但值得保留原文');
    assert.match(result.items[2].parsed.error, /model timeout/);
    assert.equal(existsSync(result.files.plan), true);
    assert.equal(existsSync(result.files.items), true);
    assert.equal(existsSync(result.files.report), true);
    assert.equal(existsSync(result.files.summary), true);
    assert.match(readFileSync(result.files.report, 'utf8'), /推荐关注项目/);
    assert.match(readFileSync(result.files.report, 'utf8'), /按 kind 分布/);
    assert.equal(JSON.parse(readFileSync(result.files.summary, 'utf8')).failedJobs, 1);

    const ledgerLines = readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(ledgerLines.length, 4);
    assert(ledgerLines.every((line) => line.assistant === 'Hermes'));
    assert(ledgerLines.every((line) => line.agent === 'trend-token-factory'));
    assert(ledgerLines.every((line) => Number.isFinite(line.promptChars)));
    assert(sentMessages.some((message) => message.action === 'report'));
    assert.match(sentMessages[0].subject, /趋势 Token 工厂/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runTrendTokenFactory keeps running when usage ledger write fails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'trend-token-factory-ledger-fail-'));

  try {
    const result = await runTrendTokenFactory({
      trendReport: sampleTrendReport(),
      batchSize: 1,
      outputDir: tempDir,
      env: {
        FEISHU_USAGE_LEDGER_ENABLED: 'true',
        FEISHU_USAGE_LEDGER_PATH: tempDir,
      },
      modelRunner: async (prompt, job) => ({
        text: JSON.stringify({
          id: job.id,
          title: job.item.title,
          worth_following: true,
          action_suggestions: ['A', 'B', 'C'],
        }),
        model: 'LongCat-Flash-Chat',
        tier: job.modelTier,
        endpoint: 'chat_completions',
      }),
    });

    assert.equal(result.report.totalJobs, 1);
    assert.equal(result.report.failedJobs, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /EISDIR|permission|illegal operation/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('trend token factory CLI email mode does not emit circular dependency warnings', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'trend-token-factory-cli-'));
  const inputFile = join(tempDir, 'latest.json');
  const outputDir = join(tempDir, 'out');

  try {
    writeFileSync(inputFile, JSON.stringify({
      generatedAt: '2026-05-07T00:00:00.000Z',
      items: [],
    }), 'utf8');

    const result = spawnSync(process.execPath, [
      join(__dirname, '..', 'scripts', 'trend-token-factory.js'),
      '--input', inputFile,
      '--output-dir', outputDir,
      '--email',
    ], {
      cwd: join(__dirname, '..'),
      env: {
        ...process.env,
        EMAIL_NOTIFY_ENABLED: 'false',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /circular dependency|non-existent property/i);
    assert.match(result.stdout, /"totalJobs": 0/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildTrendTokenReport summarizes estimated tokens and follow-up candidates', () => {
  const report = buildTrendTokenReport([
    {
      job: { kind: 'github-repo', source: 'GitHub Search', item: { title: 'Repo A' } },
      promptChars: 100,
      replyChars: 60,
      modelResult: { model: 'LongCat-Flash-Chat' },
      parsed: { worth_following: true, action_suggestions: ['A', 'B', 'C'] },
    },
    {
      job: { kind: 'rss-news', source: 'Release Feed', item: { title: 'News B' } },
      promptChars: 80,
      replyChars: 40,
      modelResult: { model: 'LongCat-Flash-Chat', usage: { total_tokens: 20 } },
      parsed: { worth_following: false },
    },
  ]);

  assert.equal(report.totalJobs, 2);
  assert.equal(report.totalTokens, 20);
  assert.equal(report.estimatedTotalTokens, 80);
  assert.deepEqual(report.byKind, { 'github-repo': 1, 'rss-news': 1 });
  assert.deepEqual(report.followUpProjects, ['Repo A']);
  assert.match(report.text, /真实 token：20/);
  assert.match(report.text, /字符估算约 80/);
});
