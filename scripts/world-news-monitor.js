#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  recordTaskEvent,
} = require('./task-center');
const {
  sendFeishuTextMessage,
} = require('./feishu-bridge');

const DEFAULT_WORLD_FEEDS = [
  { source: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
  { source: 'Google News World', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=zh-CN&gl=HK&ceid=HK:zh-Hans' },
  { source: 'Google News Technology', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=zh-CN&gl=HK&ceid=HK:zh-Hans' },
];

const CATEGORY_RULES = [
  {
    category: '全球局势',
    pattern: /war|conflict|security|military|diplomat|election|border|sanction|summit|leader|president|minister|government|peace|attack|defense|defence|战争|冲突|安全|军事|外交|选举|边境|制裁|峰会|总统|政府|和平|袭击|防务/i,
    why: '影响国际关系、区域安全或政策走向。',
  },
  {
    category: '财经与产业',
    pattern: /market|stock|bank|central bank|rate|inflation|trade|tariff|economy|economic|oil|energy|currency|investor|财经|市场|央行|利率|通胀|贸易|关税|经济|石油|能源|汇率|投资/i,
    why: '可能影响市场预期、产业链或个人投资判断。',
  },
  {
    category: '科技与AI',
    pattern: /\bai\b|artificial intelligence|chip|semiconductor|technology|tech|software|cyber|data|robot|space|satellite|科技|人工智能|芯片|半导体|软件|网络安全|数据|机器人|航天|卫星/i,
    why: '适合观察技术趋势、AI 产业变化和可学习的新工具。',
  },
  {
    category: '社会与文化',
    pattern: /health|virus|outbreak|hospital|medic|disease|climate|education|culture|film|sports|travel|society|science|study|weather|健康|病毒|疫情|医院|医疗|疾病|气候|教育|文化|电影|体育|旅行|社会|科学|研究|天气/i,
    why: '信息有现实感，适合拓展视野和找聊天素材。',
  },
];

function splitList(value) {
  return String(value || '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTags(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function getTag(block, tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const name of names) {
    const match = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(stripTags(match[1]));
  }
  return '';
}

function getLink(block) {
  const href = String(block || '').match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (href) return decodeXml(href[1]);
  return getTag(block, 'link');
}

function parseFeedItems(xml, source = 'World News') {
  const text = String(xml || '');
  const blocks = [
    ...text.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);
  return blocks.map((block) => ({
    title: getTag(block, 'title'),
    link: getLink(block),
    summary: getTag(block, ['description', 'summary', 'content']),
    publishedAt: getTag(block, ['pubDate', 'published', 'updated']),
    source,
    kind: 'world-news',
  })).filter((item) => item.title);
}

function parseWorldFeedConfig(value) {
  const configured = splitList(value);
  if (!configured.length) return DEFAULT_WORLD_FEEDS;
  return configured.map((item) => {
    const parts = item.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { source: parts[0], url: parts.slice(1).join('|') };
    }
    return { source: 'World News', url: item };
  }).filter((item) => item.url);
}

function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  return {
    envFile: readOption(args, '--env-file', env.WORLD_NEWS_ENV_FILE || ''),
    outputFile: readOption(args, '--output-file', env.WORLD_NEWS_OUTPUT_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'world-news', 'latest.json')),
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
  };
}

function defaultWorldNewsOnCalendar() {
  return '*-*-* 09:10:00,15:10:00,21:10:00';
}

async function fetchText(url, fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'OpenclawHomework-WorldNewsMonitor/1.0',
      Accept: options.accept || 'application/rss+xml, application/atom+xml, text/xml, */*',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

async function collectWorldNewsItems(env = process.env, fetchImpl = fetch, options = {}) {
  const feeds = parseWorldFeedConfig(env.WORLD_NEWS_RSS_FEEDS);
  const perFeed = Number(env.WORLD_NEWS_RSS_PER_FEED || options.perFeed || 6);
  const maxFeeds = Number(env.WORLD_NEWS_RSS_MAX_FEEDS || 8);
  const results = [];
  for (const feed of feeds.slice(0, maxFeeds)) {
    try {
      const xml = await fetchText(feed.url, fetchImpl);
      results.push(...parseFeedItems(xml, feed.source).slice(0, perFeed));
    } catch (error) {
      results.push({
        title: `${feed.source} 抓取失败`,
        source: feed.source,
        summary: String(error.message || error).slice(0, 300),
        kind: 'world-news-error',
      });
    }
  }
  return results;
}

function normalizeUrlForKey(urlValue = '') {
  const text = String(urlValue || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return text.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
}

function normalizeTitleForKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePublishedDate(value, now = new Date()) {
  const timestamp = Date.parse(value || '');
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : now;
  return date.toISOString().slice(0, 10);
}

function classifyWorldNews(item = {}) {
  const text = [item.title, item.summary, item.source].join(' ');
  const matched = CATEGORY_RULES.find((rule) => rule.pattern.test(text));
  if (matched) return { category: matched.category, why: matched.why };
  return {
    category: '其他观察',
    why: '不属于福利活动，适合当作全球信息面补充观察。',
  };
}

function normalizeWorldNewsItems(items = [], options = {}) {
  const limit = Number(options.limit || 20);
  const now = options.now || new Date();
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(items) ? items : []) {
    const title = stripTags(item.title || '');
    if (!title || /抓取失败/i.test(title)) continue;
    const linkKey = normalizeUrlForKey(item.link || item.url);
    const titleKey = normalizeTitleForKey(title);
    const dedupKey = linkKey || `${item.source || ''}:${titleKey}`;
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const classified = classifyWorldNews(item);
    normalized.push({
      id: dedupKey,
      title,
      titleZh: title,
      source: item.source || 'World News',
      category: classified.category,
      why: classified.why,
      link: item.link || item.url || '',
      summary: stripTags(item.summary || '').slice(0, 260),
      publishedAt: item.publishedAt || '',
      publishedDate: parsePublishedDate(item.publishedAt, now),
      kind: item.kind || 'world-news',
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function buildWorldNewsDigest(items = [], options = {}) {
  const normalized = normalizeWorldNewsItems(items, {
    now: options.now,
    limit: options.limit || 20,
  });
  const categories = {};
  for (const item of normalized) {
    categories[item.category] = (categories[item.category] || 0) + 1;
  }
  const top = normalized.slice(0, Number(options.topLimit || 8));
  const text = top.length
    ? top.map((item, index) => [
      `${index + 1}. [${item.category}] ${item.title}`,
      `   来源：${item.source}；时间：${item.publishedDate}`,
      `   为什么值得看：${item.why}`,
      item.summary ? `   摘要：${item.summary}` : null,
      item.link ? `   链接：${item.link}` : null,
    ].filter(Boolean).join('\n')).join('\n')
    : '暂无全球新闻条目。';
  return {
    generatedAt: (options.now || new Date()).toISOString(),
    total: normalized.length,
    categories,
    top,
    items: normalized,
    text,
  };
}

function formatWorldNewsMessage(digest = {}, options = {}) {
  const assistant = options.assistantName || 'Hermes';
  const lines = [
    `${assistant} 全球新闻雷达`,
    `本轮整理：${digest.total || 0} 条。`,
  ];
  const categories = Object.entries(digest.categories || {});
  if (categories.length) {
    lines.push(`分类：${categories.map(([name, count]) => `${name} ${count}`).join('，')}`);
  }
  if (!Array.isArray(digest.top) || !digest.top.length) {
    lines.push('没有抓到新的全球新闻。');
    return lines.join('\n');
  }
  lines.push('', '今天值得看：');
  digest.top.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.category}] ${item.titleZh || item.title}`);
    if (item.titleZh && item.titleZh !== item.title) lines.push(`   原标题：${item.title}`);
    lines.push(`   来源：${item.source}`);
    lines.push(`   时间：${item.publishedDate || '未知'}`);
    lines.push(`   为什么值得看：${item.why}`);
    if (item.summary) lines.push(`   摘要：${item.summary}`);
    if (item.link) lines.push(`   链接：${item.link}`);
  });
  lines.push('', '说明：这里只放全球局势、社会、财经、科技新闻；资源活动走独立的“福利雷达”。');
  return lines.join('\n');
}

function buildNotificationTarget(env = process.env) {
  const receiveId = env.WORLD_NEWS_FEISHU_RECEIVE_ID
    || env.FEISHU_NOTIFY_RECEIVE_ID
    || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID
    || String(env.HERMES_FEISHU_ALLOWED_USER_IDS || env.FEISHU_ALLOWED_USER_IDS || '').split(',')[0].trim();
  if (!receiveId) return null;
  return {
    receiveId,
    receiveIdType: env.WORLD_NEWS_FEISHU_RECEIVE_ID_TYPE
      || env.FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || 'open_id',
  };
}

async function sendWorldNewsNotification(env, text, options = {}) {
  const target = buildNotificationTarget(env);
  if (!target) return { sent: false, reason: 'missing_target' };
  await (options.sendFeishuTextMessage || sendFeishuTextMessage)(env, {
    receiveIdType: target.receiveIdType,
    receiveId: target.receiveId,
    msgType: 'text',
    content: JSON.stringify({ text }),
  });
  return { sent: true };
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runWorldNewsMonitor(config = {}, options = {}) {
  const env = { ...process.env, ...parseEnvFile(config.envFile), ...(options.env || {}) };
  const now = options.now || new Date();
  const outputFile = config.outputFile || env.WORLD_NEWS_OUTPUT_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'world-news', 'latest.json');
  const taskId = `world-news-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
  recordTaskEvent({
    taskId,
    type: 'world-news',
    event: 'scheduled',
    status: 'running',
    now: now.toISOString(),
  }, { env, now: now.toISOString() });

  try {
    const rawItems = await (options.collectItems || collectWorldNewsItems)(env, options.fetchImpl || fetch, { now });
    const digest = buildWorldNewsDigest(rawItems, { now, limit: env.WORLD_NEWS_MAX_ITEMS || 20 });
    const message = formatWorldNewsMessage(digest, {
      assistantName: env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || 'Hermes',
    });
    writeJsonFile(outputFile, {
      ...digest,
      message,
    });
    let notification = { sent: false, reason: config.dryRun ? 'dry_run' : 'disabled_or_empty' };
    const notifyEmpty = String(env.WORLD_NEWS_NOTIFY_EMPTY || 'false').toLowerCase() === 'true';
    const shouldNotify = digest.total > 0 || notifyEmpty || config.force;
    if (shouldNotify && !config.dryRun && String(env.WORLD_NEWS_FEISHU_NOTIFY_ENABLED || 'true').toLowerCase() !== 'false') {
      notification = await sendWorldNewsNotification(env, message, options).catch((error) => ({
        sent: false,
        reason: error.message,
      }));
    }
    recordTaskEvent({
      taskId,
      type: 'world-news',
      event: 'completed',
      status: 'completed',
      now: new Date(now.getTime() + 1000).toISOString(),
      summaryPatch: {
        total: digest.total,
        sent: Boolean(notification.sent),
        categories: digest.categories,
      },
      filesPatch: { outputFile },
    }, { env });
    return {
      ok: true,
      total: digest.total,
      digest,
      notification,
      outputFile,
      message,
    };
  } catch (error) {
    recordTaskEvent({
      taskId,
      type: 'world-news',
      event: 'failed',
      status: 'failed',
      now: new Date().toISOString(),
      error: String(error.message || error).slice(0, 1000),
    }, { env });
    throw error;
  }
}

async function main() {
  const config = parseCliArgs();
  const result = await runWorldNewsMonitor(config);
  console.log(JSON.stringify({
    ok: result.ok,
    total: result.total,
    notification: result.notification,
    outputFile: result.outputFile,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildWorldNewsDigest,
  collectWorldNewsItems,
  defaultWorldNewsOnCalendar,
  formatWorldNewsMessage,
  normalizeWorldNewsItems,
  parseCliArgs,
  parseFeedItems,
  parseWorldFeedConfig,
  runWorldNewsMonitor,
};
