const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  recordTaskEvent,
} = require('./task-center');

const DEFAULT_WORLD_NEWS_FILE = '/var/lib/openclaw-homework/world-news-latest.json';
const DEFAULT_HOT_MONITOR_FILE = '/var/lib/openclaw-homework/hot-monitor-latest.json';

function dateStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function readJsonFile(filePath, fallback = { items: [] }) {
  if (!filePath || !existsSync(filePath)) {
    return { ...fallback, items: Array.isArray(fallback.items) ? fallback.items : [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) {
      return { generatedAt: new Date().toISOString(), items: parsed };
    }
    return {
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
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

function normalizeItems(value = {}) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.candidates)) return value.candidates;
  if (Array.isArray(value.topItems)) return value.topItems;
  return [];
}

function loadCreativeSignals(env = process.env) {
  const trendDefault = join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'trend-intel', 'latest.json');
  return {
    worldNews: readJsonFile(env.WORLD_NEWS_OUTPUT_FILE || DEFAULT_WORLD_NEWS_FILE),
    hotMonitor: readJsonFile(env.HOT_MONITOR_OUTPUT_FILE || DEFAULT_HOT_MONITOR_FILE),
    trendIntel: readJsonFile(env.TREND_INTEL_OUTPUT_FILE || trendDefault),
  };
}

function cleanText(value = '', fallback = '') {
  return String(value || fallback || '').replace(/\s+/g, ' ').trim();
}

function pickTitle(item = {}, fallback = '未命名线索') {
  return cleanText(item.title || item.name || item.full_name || item.headline || item.summary, fallback);
}

function pickSummary(item = {}) {
  return cleanText(item.summary || item.description || item.reason || item.text || item.excerpt || '');
}

function makeCard(input = {}) {
  const title = cleanText(input.title, '随机任务');
  return {
    id: input.id || `${input.kind || 'creative'}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    source: cleanText(input.source, 'unknown'),
    link: cleanText(input.link, ''),
    reason: cleanText(input.reason, '这条线索值得转成一个小任务。'),
    risk: input.risk || 'low',
    weight: Number(input.weight || 1),
    estimatedTokens: Number(input.estimatedTokens || 800),
    suggestedAction: input.suggestedAction || 'manual-note',
    suggestedPrompt: cleanText(input.suggestedPrompt, `文员，围绕「${title}」生成一份小计划。`),
    autoRun: input.autoRun !== false && input.risk === 'low',
  };
}

function buildCreativeCards(signals = {}, options = {}) {
  const maxCards = Math.max(1, Number(options.maxCards || 10));
  const cards = [];

  for (const [index, item] of normalizeItems(signals.worldNews).entries()) {
    const title = pickTitle(item, `全球新闻 ${index + 1}`);
    cards.push(makeCard({
      id: `world-news-${index + 1}`,
      kind: 'world-news',
      title: `把全球新闻转成测试观察：${title}`,
      source: item.source || item.kind || '全球新闻雷达',
      link: item.link || item.url || '',
      reason: pickSummary(item) || '适合沉淀成“全球局势对产品、测试、客服的影响观察”。',
      risk: 'low',
      weight: 3,
      estimatedTokens: 1200,
      suggestedAction: 'world-news-brief',
      suggestedPrompt: `文员，基于「${title}」写一段中文全球局势观察，并补 3 个对电商测试/客服的启发。`,
    }));
  }

  for (const [index, item] of normalizeItems(signals.hotMonitor).entries()) {
    const title = pickTitle(item, `福利热点 ${index + 1}`);
    cards.push(makeCard({
      id: `hot-monitor-${index + 1}`,
      kind: 'hot-monitor',
      title: `核验福利线索：${title}`,
      source: item.source || item.kind || '福利雷达',
      link: item.link || item.url || '',
      reason: pickSummary(item) || '福利、注册送额度、服务器活动需要人工核验条件和有效期。',
      risk: 'medium',
      weight: 5,
      estimatedTokens: 900,
      suggestedAction: 'manual-review',
      suggestedPrompt: `文员，先核验「${title}」是否仍有效，不要自动注册或提交个人信息，只输出领取条件和风险。`,
      autoRun: false,
    }));
  }

  for (const [index, item] of normalizeItems(signals.trendIntel).entries()) {
    const title = pickTitle(item, `开源趋势 ${index + 1}`);
    cards.push(makeCard({
      id: `trend-intel-${index + 1}`,
      kind: 'trend-intel',
      title: `拆一个开源学习样本：${title}`,
      source: item.source || item.kind || '开源学习雷达',
      link: item.link || item.url || '',
      reason: pickSummary(item) || '适合继续进入趋势 token 工厂，提炼测试、Agent、UI 自动化借鉴点。',
      risk: 'low',
      weight: 4,
      estimatedTokens: 1600,
      suggestedAction: 'trend-token-factory',
      suggestedPrompt: `文员，把「${title}」转成 UI 自动化/AI Agent/电商客服训练的学习卡片。`,
    }));
  }

  return cards.slice(0, maxCards);
}

function weightedPick(cards = [], random = Math.random) {
  const total = cards.reduce((sum, card) => sum + Math.max(0, Number(card.weight || 1)), 0);
  if (!cards.length || total <= 0) return null;
  let cursor = random() * total;
  for (const card of cards) {
    cursor -= Math.max(0, Number(card.weight || 1));
    if (cursor <= 0) return card;
  }
  return cards[cards.length - 1];
}

function selectCreativeCards(cards = [], options = {}) {
  const count = Math.max(1, Number(options.count || 1));
  const random = options.random || Math.random;
  const pool = (options.preferSafe === false ? cards : cards.filter((card) => card.risk === 'low'))
    .filter(Boolean)
    .slice();
  const fallbackPool = cards.filter(Boolean).slice();
  const selected = [];

  while (selected.length < count && (pool.length || fallbackPool.length)) {
    const sourcePool = pool.length ? pool : fallbackPool;
    const picked = weightedPick(sourcePool, random);
    if (!picked) break;
    selected.push(picked);
    for (const list of [pool, fallbackPool]) {
      const index = list.findIndex((card) => card.id === picked.id);
      if (index >= 0) list.splice(index, 1);
    }
  }

  return selected;
}

function defaultOutputFile(env = process.env, now = new Date()) {
  return env.CREATIVE_LAB_OUTPUT_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'creative-lab', `${dateStamp(now)}.json`);
}

function buildTaskId(now = new Date()) {
  return `creative-lab-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function recordCreativeTask(result = {}, options = {}) {
  if (String(options.recordTask ?? options.env?.CREATIVE_LAB_RECORD_TASK ?? 'true').toLowerCase() === 'false') {
    return null;
  }
  try {
    return recordTaskEvent({
      type: 'creative-lab',
      taskId: options.taskId || buildTaskId(options.now || new Date()),
      event: result.status === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'completed',
      status: result.status,
      now: result.generatedAt,
      summaryPatch: {
        selectedCount: result.selected.length,
        autoRunnableCount: result.autoRunnable.length,
        pendingConfirmationCount: result.pendingConfirmation.length,
        selectedTitles: result.selected.map((card) => card.title).slice(0, 5),
      },
      filesPatch: result.files,
    }, {
      env: options.env || process.env,
      now: result.generatedAt,
    });
  } catch (error) {
    return null;
  }
}

function runCreativeLab(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const signals = options.signals || loadCreativeSignals(env);
  const cards = options.cards || buildCreativeCards(signals, options);
  const selected = selectCreativeCards(cards, {
    count: options.count || env.CREATIVE_LAB_SELECT_COUNT || 1,
    random: options.random,
    preferSafe: options.preferSafe,
  });
  const autoRunnable = selected.filter((card) => card.risk === 'low' && card.autoRun !== false);
  const pendingConfirmation = selected.filter((card) => card.risk !== 'low' || card.autoRun === false);
  const status = pendingConfirmation.length ? 'awaiting_confirmation' : 'completed';
  const outputFile = options.outputFile || defaultOutputFile(env, now);
  const result = {
    generatedAt: now.toISOString(),
    status,
    cards,
    selected,
    autoRunnable,
    pendingConfirmation,
    files: {
      output: outputFile,
    },
  };

  writeJson(outputFile, result);
  result.task = recordCreativeTask(result, {
    env,
    now,
    taskId: options.taskId,
    recordTask: options.recordTask,
  });
  writeJson(outputFile, result);
  return result;
}

function redactSecrets(value = '') {
  return String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bak_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bck_live_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}/g, '[redacted]');
}

function safeLine(value = '', maxLength = 220) {
  const text = redactSecrets(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatCreativeLabReply(result = {}) {
  const selected = Array.isArray(result.selected) ? result.selected : [];
  const pending = Array.isArray(result.pendingConfirmation) ? result.pendingConfirmation : [];
  const auto = Array.isArray(result.autoRunnable) ? result.autoRunnable : [];
  const lines = [
    'Hermes 创意实验室：',
    `- 状态：${result.status === 'awaiting_confirmation' ? '待确认' : '已生成'}`,
    `- 本轮选中：${selected.length} 个；可自动整理：${auto.length} 个；待确认：${pending.length} 个`,
  ];

  if (selected.length) {
    lines.push('', '选中的玩法：');
    selected.forEach((card, index) => {
      lines.push(`${index + 1}. ${safeLine(card.title)}（风险：${safeLine(card.risk || 'low', 40)}，来源：${safeLine(card.source || 'unknown', 80)}）`);
      lines.push(`   理由：${safeLine(card.reason || '暂无理由')}`);
      lines.push(`   建议说法：${safeLine(card.suggestedPrompt || '')}`);
    });
  } else {
    lines.push('', '暂时没有可用线索。先跑全球新闻、福利雷达或开源学习雷达后再试。');
  }

  if (pending.length) {
    lines.push('', '中风险动作没有自动执行。要继续，请明确回复：确认执行创意实验室第 1 个。');
  } else if (auto.length) {
    lines.push('', '低风险项已写入任务中枢；当前只做整理和归档，不会自动发信、注册、清理服务器或触发 GitHub Actions。');
  }

  if (result.files?.output) {
    lines.push(`产物：${safeLine(result.files.output, 260)}`);
  }
  return lines.join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      args.outputFile = argv[index + 1];
      index += 1;
    } else if (arg === '--count') {
      args.count = argv[index + 1];
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
    'Usage: node scripts/creative-lab.js [options]',
    '',
    'Options:',
    '  --output <file>  Write creative lab JSON artifact',
    '  --count <n>      Number of ideas to select',
    '  --help           Show this help',
  ].join('\n');
}

module.exports = {
  buildCreativeCards,
  buildHelpText,
  formatCreativeLabReply,
  loadCreativeSignals,
  parseArgs,
  readJsonFile,
  runCreativeLab,
  selectCreativeCards,
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText());
    process.exit(0);
  }
  const result = runCreativeLab(args);
  console.log(formatCreativeLabReply(result));
}
