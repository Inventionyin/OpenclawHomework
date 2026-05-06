const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const { resolveMailboxAction } = require('./mailbox-action-router');
const { streamModelText } = require('./streaming-client');
const {
  appendUsageLedgerEntry,
  buildUsageLedgerEntry,
} = require('./usage-ledger');

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function dateStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || '').trim());
  } catch {
    return null;
  }
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function normalizeTrendReport(input = {}) {
  if (Array.isArray(input)) {
    return {
      generatedAt: new Date().toISOString(),
      items: input,
    };
  }

  if (Array.isArray(input.items)) {
    return {
      ...input,
      items: input.items,
    };
  }

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    items: [],
  };
}

function classifyTrendJobKind(item = {}) {
  const kind = String(item.kind || '').toLowerCase();
  const source = String(item.source || '').toLowerCase();
  const link = String(item.link || '').toLowerCase();

  if (kind === 'github-trending' || source.includes('trending')) {
    return 'trending-repo';
  }
  if (
    kind === 'github-search'
    || kind === 'github-repo'
    || link.includes('github.com/')
  ) {
    return 'github-repo';
  }
  if (kind === 'hacker-news' || kind === 'hn' || source.includes('hacker news') || link.includes('news.ycombinator.com')) {
    return 'hn-story';
  }
  if (kind === 'rss' || kind === 'news' || source.includes('rss') || source.includes('feed')) {
    return 'rss-news';
  }
  return 'rss-news';
}

function defaultModelTierForKind(kind) {
  return kind === 'github-repo' || kind === 'trending-repo' ? 'thinking' : 'chat';
}

function buildTrendTokenPlan(trendReportOrItems = {}, options = {}) {
  const env = options.env || process.env;
  const report = normalizeTrendReport(trendReportOrItems);
  const batchSize = numberOrDefault(options.batchSize || env.TREND_TOKEN_FACTORY_BATCH_SIZE, 12);
  const assistant = options.assistant || env.TREND_TOKEN_FACTORY_ASSISTANT || 'Hermes';
  const jobs = report.items.slice(0, batchSize).map((item, index) => {
    const kind = classifyTrendJobKind(item);
    return {
      id: `trend-${kind}-${String(index + 1).padStart(3, '0')}`,
      kind,
      source: item.source || item.kind || 'unknown',
      modelTier: defaultModelTierForKind(kind),
      assistant,
      item,
    };
  });

  return {
    createdAt: new Date().toISOString(),
    inputGeneratedAt: report.generatedAt || null,
    batchSize,
    assistant,
    jobs,
    mailboxActions: {
      report: resolveMailboxAction('report', env),
    },
  };
}

function buildTrendTokenPrompt(job) {
  return [
    '你是 OpenClaw/Hermes 的趋势情报分析助手，面向软件测试学习、UI 自动化、电商和客服训练数据建设。',
    '请只返回一个 JSON 对象，不要 Markdown，不要解释。若信息不足，也要基于输入给出谨慎判断。',
    '',
    `任务 ID：${job.id}`,
    `任务类型：${job.kind}`,
    `来源：${job.source}`,
    '',
    '趋势条目：',
    JSON.stringify(job.item || {}, null, 2),
    '',
    'JSON 字段要求：',
    '- id：沿用任务 ID',
    '- title：项目或新闻标题',
    '- learning_value：软件测试学习价值，说明为什么值得学习或不值得',
    '- ui_automation_takeaways：UI 自动化可借鉴点，数组，2 到 5 条',
    '- commerce_support_training_data：电商/客服训练数据可沉淀的对话、场景或标签，数组，2 到 5 条',
    '- worth_following：是否值得跟进，布尔值',
    '- follow_up_reason：值得或不值得跟进的原因',
    '- action_suggestions：3 个行动建议，数组，必须刚好 3 条',
    '- risk：low / medium / high',
    '- tags：3 到 6 个标签',
    '',
    '评价重点：软件测试学习价值、UI 自动化可借鉴点、电商/客服训练数据、是否值得跟进、3 个行动建议。',
  ].join('\n');
}

async function defaultModelRunner(prompt, job, options = {}) {
  return streamModelText(prompt, {
    ...(options.modelOptions || {}),
    env: options.env || process.env,
    modelTier: job.modelTier,
  });
}

function withTimeout(promise, timeoutMs, label) {
  const ms = Number(timeoutMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function countBy(items, picker) {
  const map = new Map();
  for (const item of items) {
    const key = picker(item) || 'unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries(map.entries());
}

function isWorthFollowing(parsed = {}) {
  if (typeof parsed.worth_following === 'boolean') {
    return parsed.worth_following;
  }
  if (typeof parsed.worthFollowing === 'boolean') {
    return parsed.worthFollowing;
  }
  const value = String(parsed.worth_following || parsed.worthFollowing || '').toLowerCase();
  return ['true', 'yes', '值得', '是'].includes(value);
}

function buildTrendTokenReport(items = []) {
  const rows = Array.isArray(items) ? items : [];
  let totalTokens = 0;
  let estimatedTotalTokens = 0;
  let failedJobs = 0;
  const followUpProjects = [];

  for (const item of rows) {
    if (item.error || item.parsed?.error) {
      failedJobs += 1;
    }

    const ledger = buildUsageLedgerEntry({
      modelResult: item.modelResult,
      promptChars: item.promptChars,
      replyChars: item.replyChars,
    });
    totalTokens += Number(ledger.totalTokens || 0);
    estimatedTotalTokens += Number(ledger.estimatedTotalTokens || 0);

    if (isWorthFollowing(item.parsed)) {
      followUpProjects.push(item.parsed?.title || item.job?.item?.title || item.job?.item?.full_name || item.job?.id);
    }
  }

  const byKind = countBy(rows, (item) => item.job?.kind);
  const bySource = countBy(rows, (item) => item.job?.source || item.job?.item?.source);
  const kindText = Object.entries(byKind).map(([kind, count]) => `${kind}:${count}`).join('，') || '无';
  const sourceText = Object.entries(bySource).map(([source, count]) => `${source}:${count}`).join('，') || '无';
  const recommendedText = followUpProjects.length ? followUpProjects.join('，') : '暂无';
  const text = [
    '趋势 Token 工厂报告',
    `总任务：${rows.length}`,
    `失败任务：${failedJobs}`,
    `真实 token：${totalTokens}`,
    `估算 token：字符估算约 ${estimatedTotalTokens}`,
    `按 kind 分布：${kindText}`,
    `按 source 分布：${sourceText}`,
    `推荐关注项目：${recommendedText}`,
  ].join('\n');

  return {
    totalJobs: rows.length,
    failedJobs,
    totalTokens,
    estimatedTotalTokens,
    byKind,
    bySource,
    followUpProjects,
    text,
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function buildTrendTokenEmailMessages(report, files, plan, env = process.env) {
  const action = plan.mailboxActions?.report || resolveMailboxAction('report', env);
  if (!action?.enabled || !action.mailbox) {
    return [];
  }

  return [{
    action: 'report',
    mailbox: action.mailbox,
    to: [action.mailbox],
    subject: `${action.subjectPrefix || '[OpenClaw Report]'} 趋势 Token 工厂 ${dateStamp()}`,
    text: [
      report.text,
      '',
      `产物：${files.items}`,
      `报告：${files.report}`,
      `摘要：${files.summary}`,
    ].join('\n'),
    html: [
      '<h2>趋势 Token 工厂报告</h2>',
      `<pre>${escapeHtml(report.text)}</pre>`,
      `<p>产物：${escapeHtml(files.items)}</p>`,
      `<p>报告：${escapeHtml(files.report)}</p>`,
      `<p>摘要：${escapeHtml(files.summary)}</p>`,
    ].join('\n'),
  }];
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readTrendIntelInput(env = process.env) {
  const preferred = String(env.TREND_INTEL_INPUT_FILE || '').trim();
  const candidates = [
    preferred,
    join(process.cwd(), 'data', 'trend-intel', 'latest.json'),
  ].filter(Boolean);

  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        throw new Error(`Failed to read trend intel input ${file}: ${error.message}`);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    items: [
      {
        id: 'sample:github-playwright',
        kind: 'github-search',
        source: 'Sample GitHub',
        title: 'microsoft/playwright',
        summary: 'Reliable end-to-end testing for modern web apps',
        link: 'https://github.com/microsoft/playwright',
        language: 'TypeScript',
        stars: 71000,
      },
      {
        id: 'sample:hn-ui-agent',
        kind: 'hacker-news',
        source: 'Sample HN',
        title: 'Browser agents for UI testing',
        summary: 'Discussion about using agents to inspect and operate web UI.',
        link: 'https://news.ycombinator.com/',
      },
      {
        id: 'sample:rss-release',
        kind: 'rss',
        source: 'Sample Feed',
        title: 'Automation release notes',
        summary: 'A release announcement with testing and workflow ideas.',
        link: 'https://example.com/release',
      },
    ],
  };
}

async function runTrendTokenFactory(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const trendReport = options.trendReport || options.items || readTrendIntelInput(env);
  const outputDir = options.outputDir
    || env.TREND_TOKEN_FACTORY_OUTPUT_DIR
    || join(process.cwd(), 'data', 'trend-token-factory', dateStamp(now));
  const plan = options.plan || buildTrendTokenPlan(trendReport, { ...options, env });
  const modelRunner = options.modelRunner || defaultModelRunner;
  const jobTimeoutMs = numberOrDefault(options.jobTimeoutMs || env.TREND_TOKEN_FACTORY_JOB_TIMEOUT_MS, 120000);
  const assistant = options.assistant || plan.assistant || 'Hermes';
  const items = [];
  const warnings = [];

  mkdirSync(outputDir, { recursive: true });
  for (const job of plan.jobs) {
    const prompt = buildTrendTokenPrompt(job);
    const startedAt = Date.now();
    let modelResult;
    let error = null;
    try {
      modelResult = await withTimeout(
        modelRunner(prompt, job, { env, modelOptions: options.modelOptions }),
        jobTimeoutMs,
        `Trend token factory job ${job.id}`,
      );
    } catch (caughtError) {
      error = caughtError;
      modelResult = {
        text: '',
        model: 'unavailable',
        tier: job.modelTier,
        endpoint: 'error',
      };
    }

    const elapsedMs = Date.now() - startedAt;
    const text = String(modelResult?.text || '');
    const parsed = error ? {
      id: job.id,
      error: String(error.message || error),
      raw: text,
      worth_following: false,
      action_suggestions: [],
    } : safeJsonParse(text) || {
      id: job.id,
      raw: text,
      worth_following: false,
      action_suggestions: [],
    };
    const item = {
      job,
      promptChars: prompt.length,
      replyChars: text.length,
      elapsedMs,
      modelResult,
      parsed,
      error: error ? String(error.message || error) : undefined,
    };
    items.push(item);
    try {
      appendUsageLedgerEntry(env, {
        assistant,
        route: { agent: 'trend-token-factory', action: job.kind },
        modelResult,
        elapsedMs,
        modelElapsedMs: elapsedMs,
        promptChars: prompt.length,
        replyChars: text.length,
      });
    } catch (ledgerError) {
      warnings.push({
        type: 'usage-ledger',
        jobId: job.id,
        message: String(ledgerError?.message || ledgerError),
      });
    }
  }

  const report = buildTrendTokenReport(items);
  const files = {
    plan: join(outputDir, 'plan.json'),
    items: join(outputDir, 'items.json'),
    report: join(outputDir, 'report.md'),
    summary: join(outputDir, 'summary.json'),
  };

  writeJson(files.plan, plan);
  writeJson(files.items, items.map((item) => ({
    job: item.job,
    parsed: item.parsed,
    raw: item.parsed?.raw,
    model: item.modelResult?.model,
    tier: item.modelResult?.tier || item.job.modelTier,
    usage: item.modelResult?.usage || null,
    error: item.error,
  })));
  writeFileSync(files.report, `# 趋势 Token 工厂\n\n${report.text}\n`, 'utf8');
  writeJson(files.summary, report);

  const emailMessages = buildTrendTokenEmailMessages(report, files, plan, env);
  if (options.emailSender) {
    for (const message of emailMessages) {
      await options.emailSender(message, env);
    }
  }

  return {
    plan,
    items,
    report,
    files,
    emailMessages,
    warnings,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--batch-size') {
      args.batchSize = argv[index + 1];
      index += 1;
    } else if (arg === '--input') {
      args.input = argv[index + 1];
      index += 1;
    } else if (arg === '--output-dir') {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === '--env-file') {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === '--email') {
      args.email = true;
    } else if (arg === '--no-email') {
      args.email = false;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

function buildHelpText() {
  return [
    'Usage: node scripts/trend-token-factory.js [options]',
    '',
    'Options:',
    '  --batch-size <n>    Number of trend items to analyze',
    '  --input <file>      Trend intel JSON input file',
    '  --output-dir <dir>  Artifact output directory',
    '  --env-file <file>   Load dotenv-style env file before running',
    '  --email             Send report through mailbox action routing',
    '  --no-email          Do not send email report',
    '  --help              Show this help',
  ].join('\n');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText());
    process.exit(0);
  }
  const env = {
    ...process.env,
    ...loadEnvFile(args.envFile),
  };
  if (args.input) {
    env.TREND_INTEL_INPUT_FILE = args.input;
  }
  const runOptions = {
    env,
    batchSize: args.batchSize,
    outputDir: args.outputDir,
  };
  if (args.email) {
    const { sendMailboxActionEmail } = require('./feishu-bridge');
    runOptions.emailSender = (message, senderEnv) => sendMailboxActionEmail(message, senderEnv);
  }

  runTrendTokenFactory(runOptions).then((result) => {
    console.log(JSON.stringify({
      totalJobs: result.report.totalJobs,
      failedJobs: result.report.failedJobs,
      totalTokens: result.report.totalTokens,
      estimatedTotalTokens: result.report.estimatedTotalTokens,
      warnings: result.warnings,
      files: result.files,
    }, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildHelpText,
  buildTrendTokenEmailMessages,
  buildTrendTokenPlan,
  buildTrendTokenPrompt,
  buildTrendTokenReport,
  classifyTrendJobKind,
  loadEnvFile,
  parseArgs,
  readTrendIntelInput,
  runTrendTokenFactory,
  withTimeout,
};
