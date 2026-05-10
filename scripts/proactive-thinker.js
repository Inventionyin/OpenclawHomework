const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  readUsageLedgerEntries,
} = require('./usage-ledger');
const {
  runCreativeLab,
} = require('./creative-lab');
const {
  recordTaskEvent,
  summarizeTaskCenterBrain,
} = require('./task-center');

const DEFAULT_WORLD_NEWS_FILE = '/var/lib/openclaw-homework/world-news-latest.json';
const DEFAULT_HOT_MONITOR_FILE = '/var/lib/openclaw-homework/hot-monitor-latest.json';

function dateStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function compactStamp(now = new Date()) {
  return now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function normalizeItems(value = {}) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.candidates)) return value.candidates;
  if (Array.isArray(value.topItems)) return value.topItems;
  if (Array.isArray(value.learningRadar?.items)) return value.learningRadar.items;
  if (Array.isArray(value.radar?.items)) return value.radar.items;
  return [];
}

function readJsonFile(filePath, fallback = { items: [] }) {
  if (!filePath || !existsSync(filePath)) {
    return {
      ...fallback,
      items: normalizeItems(fallback),
      missing: Boolean(filePath),
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      items: normalizeItems(parsed),
    };
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      items: [],
      warning: `read_failed: ${error.message}`,
    };
  }
}

function loadThinkerInputs(env = process.env, options = {}) {
  const projectDir = env.LOCAL_PROJECT_DIR || process.cwd();
  const trendDefault = join(projectDir, 'data', 'trend-intel', 'latest.json');
  const worldNews = readJsonFile(options.worldNewsFile || env.WORLD_NEWS_OUTPUT_FILE || DEFAULT_WORLD_NEWS_FILE);
  const hotMonitor = readJsonFile(options.hotMonitorFile || env.HOT_MONITOR_OUTPUT_FILE || DEFAULT_HOT_MONITOR_FILE);
  const trendIntel = readJsonFile(options.trendIntelFile || env.TREND_INTEL_OUTPUT_FILE || trendDefault);
  let taskCenterBrain = {};
  try {
    taskCenterBrain = summarizeTaskCenterBrain({ env, now: options.now || new Date() });
  } catch (error) {
    taskCenterBrain = { warning: `task_center_unavailable: ${error.message}` };
  }
  return {
    worldNews,
    hotMonitor,
    trendIntel,
    taskCenterBrain,
    usageLedger: {
      entries: readUsageLedgerEntries(env, Number(options.usageLimit || 120)),
    },
  };
}

function redactSecrets(value = '') {
  return String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bak_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bck_live_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]{12,}\b/g, '[redacted]');
}

function safeText(value = '', fallback = '', limit = 260) {
  const text = redactSecrets(value || fallback || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function pickTitle(item = {}, fallback = '未命名线索') {
  return safeText(item.title || item.projectName || item.name || item.full_name || item.headline || item.summary, fallback);
}

function pickSource(item = {}, fallback = 'unknown') {
  return safeText(item.source || item.kind || item.platform, fallback, 80);
}

function pickReason(item = {}) {
  return safeText(item.summary || item.description || item.reason || item.usefulFor || item.text || item.excerpt || '', '暂无摘要');
}

function takeSignalItems(source = {}, limit = 4) {
  return normalizeItems(source)
    .slice(0, limit)
    .map((item, index) => ({
      title: pickTitle(item, `线索 ${index + 1}`),
      source: pickSource(item),
      reason: pickReason(item),
      link: safeText(item.link || item.url || item.html_url || '', '', 320),
    }));
}

function summarizeUsage(entries = []) {
  const totalCalls = entries.length;
  const tokenEntries = entries.filter((entry) => Number(entry.totalTokens || entry.estimatedTotalTokens || 0) > 0);
  const totalTokens = tokenEntries.reduce((sum, entry) => sum + Number(entry.totalTokens || entry.estimatedTotalTokens || 0), 0);
  const byModel = new Map();
  for (const entry of entries) {
    const key = safeText(`${entry.assistant || 'unknown'} / ${entry.model || 'unknown'}`, 'unknown', 120);
    const current = byModel.get(key) || { key, calls: 0, tokens: 0 };
    current.calls += 1;
    current.tokens += Number(entry.totalTokens || entry.estimatedTotalTokens || 0);
    byModel.set(key, current);
  }
  return {
    totalCalls,
    totalTokens,
    topModels: Array.from(byModel.values())
      .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
      .slice(0, 5),
  };
}

function normalizeCreativeResult(result = {}) {
  return {
    status: result.status || 'completed',
    selected: Array.isArray(result.selected) ? result.selected : [],
    autoRunnable: Array.isArray(result.autoRunnable) ? result.autoRunnable : [],
    pendingConfirmation: Array.isArray(result.pendingConfirmation) ? result.pendingConfirmation : [],
  };
}

function buildProactiveThinkerReport(inputs = {}, options = {}) {
  const now = options.now || new Date();
  const creative = normalizeCreativeResult(options.creativeLabResult);
  const pendingConfirmations = creative.pendingConfirmation.map((item, index) => ({
    id: item.id || `pending-${index + 1}`,
    title: safeText(item.title, `待确认项 ${index + 1}`),
    risk: safeText(item.risk || 'medium', 'medium', 40),
    source: safeText(item.source || 'creative-lab', 'creative-lab', 80),
    suggestedPrompt: safeText(item.suggestedPrompt || '确认后再执行。', '确认后再执行。'),
  }));
  const worldNews = takeSignalItems(inputs.worldNews, 4);
  const hotMonitor = takeSignalItems(inputs.hotMonitor, 4);
  const trendIntel = takeSignalItems(inputs.trendIntel, 4);
  const taskCenterBrain = inputs.taskCenterBrain || {};
  const nextPlan = Array.isArray(taskCenterBrain.nextPlan?.items) ? taskCenterBrain.nextPlan.items : [];
  const usage = summarizeUsage(inputs.usageLedger?.entries || []);
  const status = pendingConfirmations.length ? 'awaiting_confirmation' : 'completed';
  const clueCount = worldNews.length + hotMonitor.length + trendIntel.length + creative.selected.length;

  return {
    generatedAt: now.toISOString(),
    day: dateStamp(now),
    status,
    summary: `主动思考完成：整理 ${clueCount} 条信号，待确认 ${pendingConfirmations.length} 项。`,
    sections: {
      worldNews: { title: '全球局势/新闻', items: worldNews },
      hotMonitor: { title: '福利/活动线索', items: hotMonitor },
      trendIntel: { title: '开源学习雷达', items: trendIntel },
      taskCenter: {
        title: '任务中枢',
        todaySummary: safeText(taskCenterBrain.today?.summaryText || taskCenterBrain.todaySummary || '暂无今日任务摘要。', '', 500),
        failureSummary: safeText(taskCenterBrain.failureReview?.summaryText || '暂无失败复盘。', '', 500),
        nextPlan: nextPlan.slice(0, 6).map((item) => safeText(item, '', 260)),
      },
      usage,
    },
    creative: {
      status: creative.status,
      selected: creative.selected.slice(0, 5).map((item) => ({
        title: safeText(item.title, '创意任务'),
        source: safeText(item.source || 'creative-lab', 'creative-lab', 80),
        risk: safeText(item.risk || 'low', 'low', 40),
        suggestedPrompt: safeText(item.suggestedPrompt || ''),
      })),
      autoRunnable: creative.autoRunnable.slice(0, 5).map((item) => safeText(item.title || item.id || '低风险整理项')),
    },
    pendingConfirmations,
    email: {
      recommended: true,
      shouldSend: Boolean(options.email),
      reason: options.email ? 'explicit_request' : 'report_ready_no_auto_send',
    },
    files: options.files || {},
  };
}

function formatItems(items = [], emptyText = '暂无可用线索。') {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item, index) => {
    const suffix = item.link ? ` ${item.link}` : '';
    return `${index + 1}. ${safeText(item.title)}（${safeText(item.source, 'unknown', 80)}）- ${safeText(item.reason || '')}${suffix}`;
  });
}

function formatProactiveThinkerMarkdown(report = {}) {
  const taskCenter = report.sections?.taskCenter || {};
  const usage = report.sections?.usage || {};
  const lines = [
    `# Hermes 主动思考报告 ${safeText(report.day || '')}`,
    '',
    `- 生成时间：${safeText(report.generatedAt || '')}`,
    `- 状态：${report.status === 'awaiting_confirmation' ? '待确认' : '已完成'}`,
    `- 摘要：${safeText(report.summary || '')}`,
    '',
    '## 全球局势/新闻',
    ...formatItems(report.sections?.worldNews?.items || []),
    '',
    '## 福利/活动线索',
    ...formatItems(report.sections?.hotMonitor?.items || []),
    '',
    '## 开源学习雷达',
    ...formatItems(report.sections?.trendIntel?.items || []),
    '',
    '## 创意实验室',
    ...((report.creative?.selected || []).length
      ? report.creative.selected.map((item, index) => `${index + 1}. ${safeText(item.title)}（风险：${safeText(item.risk)}）`)
      : ['- 暂无创意实验室选中项。']),
    '',
    '## 任务中枢',
    `- 今日：${safeText(taskCenter.todaySummary || '')}`,
    `- 失败：${safeText(taskCenter.failureSummary || '')}`,
    '- 下一步：',
    ...((taskCenter.nextPlan || []).length ? taskCenter.nextPlan.map((item) => `  - ${safeText(item)}`) : ['  - 暂无明确下一步。']),
    '',
    '## Token/耗时',
    `- 调用记录：${Number(usage.totalCalls || 0)} 条`,
    `- token 合计：${Number(usage.totalTokens || 0)}`,
    ...((usage.topModels || []).length ? usage.topModels.map((row) => `- ${safeText(row.key)}：${row.calls} 次，${row.tokens} tokens`) : ['- 暂无 token 账本记录。']),
    '',
    '## 待确认',
    ...((report.pendingConfirmations || []).length
      ? report.pendingConfirmations.map((item, index) => `${index + 1}. ${safeText(item.title)}（风险：${safeText(item.risk)}）建议：${safeText(item.suggestedPrompt)}`)
      : ['- 暂无。']),
  ];
  return `${lines.join('\n')}\n`;
}

function formatProactiveThinkerReply(report = {}) {
  const worldItems = report.sections?.worldNews?.items || [];
  const trendItems = report.sections?.trendIntel?.items || [];
  const hotItems = report.sections?.hotMonitor?.items || [];
  const pending = report.pendingConfirmations || [];
  const lines = [
    'Hermes 主动思考器：',
    `- 状态：${report.status === 'awaiting_confirmation' ? '有待确认项' : '已完成'}`,
    `- 摘要：${safeText(report.summary || '')}`,
    `- 新闻：${worldItems[0]?.title || '暂无'}`,
    `- 开源：${trendItems[0]?.title || '暂无'}`,
    `- 福利：${hotItems[0]?.title || '暂无'}`,
  ];
  if (pending.length) {
    lines.push(`- 待你确认：${pending.length} 项；中高风险不会自动执行。`);
    lines.push(`- 第一项：${safeText(pending[0].title)}`);
  } else {
    lines.push('- 待你确认：暂无。');
  }
  if (report.files?.markdown) {
    lines.push(`- 报告：${safeText(report.files.markdown, '', 320)}`);
  }
  lines.push('- 想归档：文员，把今天主动思考报告发到邮箱');
  return lines.join('\n');
}

function defaultOutputFiles(env = process.env, now = new Date()) {
  const outputDir = env.PROACTIVE_THINKER_OUTPUT_DIR
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'proactive-thinker');
  const base = dateStamp(now);
  return {
    json: join(outputDir, `${base}.json`),
    markdown: join(outputDir, `${base}.md`),
  };
}

function writeText(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function writeJson(file, data) {
  writeText(file, `${JSON.stringify(data, null, 2)}\n`);
}

function recordProactiveThinkerTask(report = {}, options = {}) {
  if (String(options.recordTask ?? options.env?.PROACTIVE_THINKER_RECORD_TASK ?? 'true').toLowerCase() === 'false') {
    return null;
  }
  try {
    return recordTaskEvent({
      type: 'proactive-thinker',
      taskId: options.taskId || `proactive-thinker-${compactStamp(options.now || new Date(report.generatedAt || Date.now()))}`,
      event: report.status === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'completed',
      status: report.status,
      now: report.generatedAt,
      summaryPatch: {
        pendingConfirmationCount: report.pendingConfirmations?.length || 0,
        worldNewsCount: report.sections?.worldNews?.items?.length || 0,
        hotMonitorCount: report.sections?.hotMonitor?.items?.length || 0,
        trendIntelCount: report.sections?.trendIntel?.items?.length || 0,
        summary: report.summary,
      },
      filesPatch: report.files,
    }, {
      env: options.env || process.env,
      now: report.generatedAt,
    });
  } catch {
    return null;
  }
}

function parseRecipients(value = '') {
  return String(value || '')
    .split(/[,\s;；，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildProactiveThinkerEmailMessage(report = {}, env = process.env) {
  const recipients = parseRecipients(env.PROACTIVE_THINKER_EMAIL_TO || env.EMAIL_TO || '');
  return {
    action: 'report',
    mailbox: env.PROACTIVE_THINKER_MAILBOX || '',
    to: recipients,
    subject: `[Hermes] 主动思考报告 ${report.day || dateStamp()}`,
    text: formatProactiveThinkerMarkdown(report),
    html: `<pre>${escapeHtml(formatProactiveThinkerMarkdown(report))}</pre>`,
  };
}

function escapeHtml(value = '') {
  return String(value || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function finalizeRun(result, options = {}) {
  if (!options.email) {
    return result;
  }
  const sender = options.emailSender;
  if (!sender) {
    result.emailResult = { sent: false, reason: 'missing_email_sender' };
    return result;
  }
  return Promise.resolve(sender(result.emailMessage, options.env || process.env))
    .then((emailResult) => ({
      ...result,
      emailResult: emailResult || { sent: true },
    }));
}

function runProactiveThinker(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const inputs = options.inputs || loadThinkerInputs(env, { now });
  const creativeLabResult = options.creativeLabResult || (options.creativeLabRunner || runCreativeLab)({
    env,
    now,
    recordTask: false,
    count: options.creativeCount || env.PROACTIVE_THINKER_CREATIVE_COUNT || 1,
  });
  const files = options.files || defaultOutputFiles(env, now);
  const report = buildProactiveThinkerReport(inputs, {
    now,
    email: options.email,
    creativeLabResult,
    files,
  });
  const markdown = formatProactiveThinkerMarkdown(report);

  if (options.writeArtifacts !== false) {
    writeJson(files.json, report);
    writeText(files.markdown, markdown);
  }
  const task = recordProactiveThinkerTask(report, {
    env,
    now,
    recordTask: options.recordTask,
    taskId: options.taskId,
  });
  const emailMessage = buildProactiveThinkerEmailMessage(report, env);
  const result = {
    report,
    files,
    task,
    markdown,
    emailMessage,
    emailResult: { sent: false, reason: options.email ? 'not_attempted' : 'not_requested' },
  };
  return finalizeRun(result, options);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--email') {
      args.email = true;
    } else if (arg === '--no-email') {
      args.email = false;
    } else if (arg === '--output-dir') {
      args.outputDir = argv[index + 1];
      index += 1;
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
    'Usage: node scripts/proactive-thinker.js [options]',
    '',
    'Options:',
    '  --email             Send report using configured mailbox sender',
    '  --no-email          Generate artifacts only',
    '  --output-dir <dir>  Override PROACTIVE_THINKER_OUTPUT_DIR',
    '  --help              Show this help',
  ].join('\n');
}

module.exports = {
  buildHelpText,
  buildProactiveThinkerEmailMessage,
  buildProactiveThinkerReport,
  formatProactiveThinkerMarkdown,
  formatProactiveThinkerReply,
  loadThinkerInputs,
  parseArgs,
  runProactiveThinker,
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText());
    process.exit(0);
  }
  const env = { ...process.env };
  if (args.outputDir) {
    env.PROACTIVE_THINKER_OUTPUT_DIR = args.outputDir;
  }
  const runOptions = { env, email: Boolean(args.email) };
  if (args.email) {
    const { sendMailboxActionEmail } = require('./feishu-bridge');
    runOptions.emailSender = (message, senderEnv) => sendMailboxActionEmail(message, senderEnv);
  }
  Promise.resolve(runProactiveThinker(runOptions))
    .then((result) => {
      console.log(formatProactiveThinkerReply(result.report));
      if (result.emailResult?.sent) {
        console.log('Email sent.');
      }
    })
    .catch((error) => {
      console.error(error.stack || error.message || error);
      process.exit(1);
    });
}
