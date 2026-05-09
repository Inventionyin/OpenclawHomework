const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  collectTrendIntel,
  parseFeedConfig,
  parseListEnv,
  parseRssItems,
} = require('./trend-intel');
const {
  recordTaskEvent,
} = require('./task-center');
const {
  sendFeishuTextMessage,
} = require('./feishu-bridge');
const {
  saveHotMonitorCandidatesAsProtocolAssets,
} = require('./protocol-asset-store');

const DEFAULT_BENEFIT_QUERIES = [
  'free credits',
  'cloud credits',
  'AI credits',
  'GPU credits',
  'LLM API credits',
  'startup credits',
  'free tier',
  'free trial',
];

const DEFAULT_BENEFIT_FEEDS = [
  { source: 'Product Hunt', url: 'https://www.producthunt.com/feed/' },
  { source: 'GitHub Blog', url: 'https://github.blog/feed/' },
  { source: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml' },
  { source: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/' },
];

const DEFAULT_SEARCH_QUERIES = [
  'free LLM API credits',
  'AI credits free trial',
  'GPU credits for developers',
  'cloud server credits startup',
  'site:linux.do token 免费 额度',
  'site:v2ex.com 免费 token 服务器',
  'site:tieba.baidu.com AI 免费 token',
];

const BENEFIT_KEYWORDS = [
  'free',
  'credit',
  'credits',
  'coupon',
  'voucher',
  'grant',
  'trial',
  'beta',
  'invite',
  'startup',
  'student',
  'server',
  'cloud',
  'gpu',
  'token',
  'tokens',
  'membership',
  '免费',
  '额度',
  '代金券',
  '优惠',
  '试用',
  '会员',
  '内测',
  '邀请',
  '服务器',
  '云服务器',
  '算力',
  '赠送',
];

const TECH_KEYWORDS = [
  'agent',
  'ai',
  'llm',
  'mcp',
  'dify',
  'openhands',
  'langgraph',
  'browser',
  'automation',
  'playwright',
  'cypress',
  'selenium',
  'allure',
  'testing',
  'test',
  'qa',
  'ecommerce',
  'commerce',
  'email',
  'smtp',
  'imap',
  '客服',
  '测试',
  '自动化',
  '电商',
  '邮箱',
];

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  return {
    envFile: readOption(args, '--env-file', env.HOT_MONITOR_ENV_FILE || ''),
    stateFile: readOption(
      args,
      '--state-file',
      env.HOT_MONITOR_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'hot-monitor-state.json'),
    ),
    outputFile: readOption(
      args,
      '--output-file',
      env.HOT_MONITOR_OUTPUT_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'hot-monitor', 'latest.json'),
    ),
    once: hasFlag(args, '--once') || String(env.HOT_MONITOR_ONCE || '').toLowerCase() === 'true',
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
  };
}

function defaultHotMonitorOnCalendar() {
  return '*:0/30';
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

function toBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function readJsonFile(filePath, fallback = {}) {
  if (!filePath || !existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemKey(item = {}) {
  return String(item.id || item.link || `${item.source || ''}:${item.title || ''}`)
    .trim()
    .toLowerCase();
}

function normalizeUrlForKey(urlValue = '') {
  const text = String(urlValue || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
  } catch {
    return text.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
}

function normalizeTitleForKey(title = '') {
  return normalizeText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAlertKey(item = {}) {
  const linkKey = normalizeUrlForKey(item.link || item.url);
  if (linkKey) {
    return linkKey.toLowerCase();
  }
  const titleKey = normalizeTitleForKey(item.title || item.titleZh || '');
  const sourceKey = normalizeText(item.source || item.kind || '').toLowerCase();
  if (titleKey) {
    return `${sourceKey}:${titleKey}`;
  }
  return itemKey(item);
}

function buildDedupKey(item = {}) {
  const linkKey = normalizeUrlForKey(item.link || item.url);
  if (linkKey) {
    return `url:${linkKey.toLowerCase()}`;
  }
  const titleKey = normalizeTitleForKey(item.title || item.titleZh || '');
  if (titleKey) {
    return `title:${titleKey}`;
  }
  return `id:${itemKey(item)}`;
}

function includesAny(text, keywords) {
  const lowered = String(text || '').toLowerCase();
  return keywords.some((keyword) => lowered.includes(String(keyword).toLowerCase()));
}

function maskSensitiveUrl(url) {
  return String(url || '')
    .replace(/([?&](?:api_key|key|token|access_token)=)[^&]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._:-]+/gi, '$1***');
}

function buildChineseUnderstanding(item = {}, categories = classifyHotItem(item)) {
  const text = [
    item.title,
    item.summary,
    item.topic,
    item.source,
  ].join(' ');
  const lowered = text.toLowerCase();
  const focus = [];
  if (/gpu|算力/.test(lowered)) focus.push('GPU/算力');
  if (/server|cloud|服务器|云/.test(lowered)) focus.push('云服务器/云资源');
  if (/token|api|llm|model|模型|额度|credits?/.test(lowered)) focus.push('模型 API 额度');
  if (/trial|beta|invite|试用|内测|邀请/.test(lowered)) focus.push('试用/内测/邀请');
  if (/playwright|cypress|selenium|testing|测试|自动化/.test(lowered)) focus.push('UI 自动化/测试');
  if (/agent|mcp|dify|langgraph|openhands/.test(lowered)) focus.push('AI Agent 工作流');
  if (/email|smtp|imap|邮箱/.test(lowered)) focus.push('邮箱平台');
  const uniqueFocus = [...new Set(focus)].slice(0, 3);
  if (categories.includes('benefit')) {
    return {
      titleZh: `${uniqueFocus.length ? uniqueFocus.join('、') : '开发者资源'}相关福利线索`,
      summaryZh: '疑似包含免费额度、试用资格、邀请名额或云资源活动，建议先核验来源和领取条件。',
    };
  }
  if (categories.includes('github') || categories.includes('tech')) {
    return {
      titleZh: `${uniqueFocus.length ? uniqueFocus.join('、') : '技术项目'}相关热点`,
      summaryZh: '适合加入开源学习雷达，后续可让 token 工厂分析 README、架构和可借鉴点。',
    };
  }
  return {
    titleZh: '待核验热点线索',
    summaryZh: '需要结合原文和来源判断是否与你的测试、Agent、邮箱平台或福利领取目标相关。',
  };
}

function classifyHotItem(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.source,
    item.kind,
    item.topic,
    item.link,
  ].join(' ');
  const categories = [];
  if (includesAny(text, BENEFIT_KEYWORDS)) categories.push('benefit');
  if (includesAny(text, TECH_KEYWORDS)) categories.push('tech');
  if (/github/i.test(String(item.source || item.kind || item.link || ''))) categories.push('github');
  if (!categories.length) categories.push('general');
  return [...new Set(categories)];
}

function keywordScore(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.source,
    item.topic,
  ].join(' ');
  const reasons = [];
  let score = 0;
  if (includesAny(text, TECH_KEYWORDS)) {
    score += 25;
    reasons.push({ code: 'tech_keywords', score: 25, detail: '命中技术关键词' });
  }
  if (includesAny(text, BENEFIT_KEYWORDS)) {
    score += 45;
    reasons.push({ code: 'benefit_keywords', score: 45, detail: '命中福利关键词' });
  }
  if (/playwright|cypress|dify|agent|mcp|openhands|langgraph|allure/i.test(text)) {
    score += 25;
    reasons.push({ code: 'workflow_keywords', score: 25, detail: '命中测试/Agent 工作流关键词' });
  }
  if (/免费|额度|token|credits?|server|服务器|trial|coupon/i.test(text)) {
    score += 30;
    reasons.push({ code: 'resource_keywords', score: 30, detail: '命中资源/额度关键词' });
  }
  return { score, reasons };
}

function scoreHotItem(item = {}, previous = {}) {
  const stars = Number(item.stars || 0);
  const hasPreviousStars = previous.firstSeenAt && Number.isFinite(Number(previous.stars));
  const previousStars = hasPreviousStars ? Number(previous.stars) : stars;
  const deltaStars = hasPreviousStars ? Math.max(0, stars - previousStars) : 0;
  const starsToday = Number(item.starsToday || 0);
  const isNew = !previous.firstSeenAt;
  const keyword = keywordScore(item);
  const scoreReasons = [
    { code: 'stars_total', score: Math.min(stars / 100, 120), detail: `总 stars=${stars}` },
    { code: 'stars_delta', score: Math.min(deltaStars * 4, 220), detail: `相较上轮增量=${deltaStars}` },
    { code: 'stars_today', score: Math.min(starsToday * 2, 220), detail: `今日增量=${starsToday}` },
    ...keyword.reasons,
    ...(isNew ? [{ code: 'new_item_bonus', score: 20, detail: '首次进入雷达' }] : []),
  ].filter((row) => Number(row.score) > 0);
  const score = Math.round(
    Math.min(stars / 100, 120)
    + Math.min(deltaStars * 4, 220)
    + Math.min(starsToday * 2, 220)
    + keyword.score
    + (isNew ? 20 : 0),
  );
  return {
    score,
    deltaStars,
    starsToday,
    isNew,
    scoreReasons,
  };
}

function normalizeHotItem(item = {}, previous = {}, now = new Date()) {
  const metrics = scoreHotItem(item, previous);
  const categories = classifyHotItem(item);
  const chinese = buildChineseUnderstanding(item, categories);
  return {
    id: itemKey(item),
    alertKey: buildAlertKey(item),
    dedupKey: buildDedupKey(item),
    title: normalizeText(item.title).slice(0, 180),
    titleZh: normalizeText(item.titleZh || chinese.titleZh).slice(0, 180),
    source: normalizeText(item.source || item.kind || 'hot-monitor').slice(0, 120),
    kind: normalizeText(item.kind || 'hot').slice(0, 80),
    link: normalizeText(item.link).slice(0, 500),
    summary: normalizeText(item.summary).slice(0, 260),
    summaryZh: normalizeText(item.summaryZh || chinese.summaryZh).slice(0, 260),
    topic: normalizeText(item.topic).slice(0, 100),
    stars: Number.isFinite(Number(item.stars)) ? Number(item.stars) : undefined,
    starsToday: Number.isFinite(Number(item.starsToday)) ? Number(item.starsToday) : undefined,
    deltaStars: metrics.deltaStars,
    score: metrics.score,
    scoreReasons: metrics.scoreReasons,
    categories,
    firstSeenAt: previous.firstSeenAt || now.toISOString(),
    lastSeenAt: now.toISOString(),
    alertReason: buildAlertReason(item, metrics, categories),
  };
}

function buildAlertReason(item = {}, metrics = {}, categories = []) {
  const reasons = [];
  if (metrics.isNew) reasons.push('首次进入雷达');
  if (metrics.deltaStars > 0) reasons.push(`较上次 +${metrics.deltaStars} stars`);
  if (metrics.starsToday > 0) reasons.push(`今日 +${metrics.starsToday} stars`);
  if (categories.includes('benefit')) reasons.push('疑似免费/额度/试用活动');
  if (categories.includes('tech')) reasons.push('命中你的技术方向');
  if (!reasons.length) reasons.push('热度分数达标');
  return reasons.join('，');
}

function parseMonthName(value) {
  const month = String(value || '').toLowerCase().slice(0, 3);
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[month] || 0;
}

function buildLocalDate(year, month, day) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59));
}

function extractDeadlineDates(text = '', referenceDate = new Date()) {
  const source = String(text || '');
  const dates = [];
  const referenceYear = referenceDate.getUTCFullYear();
  const chinesePattern = /(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:开奖|截止|结束|过期|前|之前|报名截止|申请截止|领取截止)/g;
  for (const match of source.matchAll(chinesePattern)) {
    dates.push(buildLocalDate(match[1] || referenceYear, match[2], match[3]));
  }
  const englishPattern = /(?:before|until|ends?|deadline|expires?|apply before)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?/gi;
  for (const match of source.matchAll(englishPattern)) {
    const month = parseMonthName(match[1]);
    if (month) dates.push(buildLocalDate(match[3] || referenceYear, month, match[2]));
  }
  const isoPattern = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:开奖|截止|结束|过期|前|之前|deadline|expires?|end)?/gi;
  for (const match of source.matchAll(isoPattern)) {
    dates.push(buildLocalDate(match[1], match[2], match[3]));
  }
  return dates.filter((date) => Number.isFinite(date.getTime()));
}

function isExpiredBenefitItem(item = {}, referenceDate = new Date()) {
  const text = [
    item.title,
    item.summary,
    item.titleZh,
    item.summaryZh,
    item.topic,
  ].join(' ');
  const deadlines = extractDeadlineDates(text, referenceDate);
  if (!deadlines.length) return false;
  const referenceEnd = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
    0,
    0,
    0,
  ));
  return deadlines.some((deadline) => deadline.getTime() < referenceEnd.getTime());
}

async function fetchText(url, fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'OpenclawHomework-HotMonitor/1.0',
      Accept: options.accept || '*/*',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${maskSensitiveUrl(url)}`);
  }
  return response.text();
}

async function fetchJson(url, fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': 'OpenclawHomework-HotMonitor/1.0',
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${maskSensitiveUrl(url)}`);
  }
  return JSON.parse(await response.text());
}

function getSearchQueries(env = process.env) {
  return parseListEnv(env.HOT_MONITOR_SEARCH_QUERIES, DEFAULT_SEARCH_QUERIES)
    .slice(0, Number(env.HOT_MONITOR_SEARCH_MAX_QUERIES || 8));
}

function normalizeSearchResult(provider, query, result = {}) {
  const link = result.url || result.link || result.href || '';
  const title = result.title || result.name || link;
  const providerLabel = {
    tavily: 'Tavily',
    brave: 'Brave',
    serpapi: `SerpApi ${result.engine || 'google'}`,
    searxng: 'SearXNG',
  }[provider] || `${provider[0].toUpperCase()}${provider.slice(1)}`;
  return {
    id: `search:${provider}:${link || `${query}:${title}`}`,
    title,
    source: `${providerLabel} 搜索: ${query}`,
    kind: 'benefit-search',
    link,
    summary: result.content || result.description || result.snippet || result.text || '',
    topic: query,
    publishedAt: result.published_date || result.date || '',
    externalScore: result.score,
  };
}

async function fetchTavilySearchItems(env = process.env, fetchImpl = fetch) {
  const apiKey = env.HOT_MONITOR_TAVILY_API_KEY || env.TAVILY_API_KEY;
  if (!apiKey || String(env.HOT_MONITOR_TAVILY_ENABLED || 'true').toLowerCase() === 'false') return [];
  const perQuery = Number(env.HOT_MONITOR_SEARCH_PER_QUERY || env.HOT_MONITOR_TAVILY_MAX_RESULTS || 5);
  const items = [];
  for (const query of getSearchQueries(env)) {
    try {
      const json = await fetchJson(env.HOT_MONITOR_TAVILY_URL || 'https://api.tavily.com/search', fetchImpl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          search_depth: env.HOT_MONITOR_TAVILY_SEARCH_DEPTH || 'basic',
          max_results: perQuery,
          include_answer: false,
          include_raw_content: false,
        }),
      });
      const results = Array.isArray(json.results) ? json.results : [];
      items.push(...results.slice(0, perQuery).map((result) => normalizeSearchResult('tavily', query, result)));
    } catch (error) {
      items.push({
        id: `search-error:tavily:${query}`,
        title: `Tavily 搜索失败：${query}`,
        source: 'Tavily 搜索',
        kind: 'benefit-error',
        summary: maskSensitiveUrl(error.message),
        topic: query,
      });
    }
  }
  return items;
}

async function fetchBraveSearchItems(env = process.env, fetchImpl = fetch) {
  const apiKey = env.HOT_MONITOR_BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY;
  if (!apiKey || String(env.HOT_MONITOR_BRAVE_ENABLED || 'true').toLowerCase() === 'false') return [];
  const perQuery = Number(env.HOT_MONITOR_SEARCH_PER_QUERY || env.HOT_MONITOR_BRAVE_COUNT || 5);
  const items = [];
  for (const query of getSearchQueries(env)) {
    try {
      const url = new URL(env.HOT_MONITOR_BRAVE_URL || 'https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(perQuery));
      url.searchParams.set('freshness', env.HOT_MONITOR_BRAVE_FRESHNESS || 'pw');
      url.searchParams.set('search_lang', env.HOT_MONITOR_SEARCH_LANG || 'zh-hans');
      url.searchParams.set('country', env.HOT_MONITOR_SEARCH_COUNTRY || 'HK');
      const json = await fetchJson(url.toString(), fetchImpl, {
        headers: { 'X-Subscription-Token': apiKey },
      });
      const results = Array.isArray(json.web?.results) ? json.web.results : [];
      items.push(...results.slice(0, perQuery).map((result) => normalizeSearchResult('brave', query, result)));
    } catch (error) {
      items.push({
        id: `search-error:brave:${query}`,
        title: `Brave 搜索失败：${query}`,
        source: 'Brave 搜索',
        kind: 'benefit-error',
        summary: maskSensitiveUrl(error.message),
        topic: query,
      });
    }
  }
  return items;
}

async function fetchSerpApiSearchItems(env = process.env, fetchImpl = fetch) {
  const apiKey = env.HOT_MONITOR_SERPAPI_API_KEY || env.SERPAPI_API_KEY;
  if (!apiKey || String(env.HOT_MONITOR_SERPAPI_ENABLED || 'true').toLowerCase() === 'false') return [];
  const perQuery = Number(env.HOT_MONITOR_SEARCH_PER_QUERY || env.HOT_MONITOR_SERPAPI_NUM || 5);
  const engine = env.HOT_MONITOR_SERPAPI_ENGINE || 'google';
  const items = [];
  for (const query of getSearchQueries(env)) {
    try {
      const url = new URL(env.HOT_MONITOR_SERPAPI_URL || 'https://serpapi.com/search.json');
      url.searchParams.set('engine', engine);
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('num', String(perQuery));
      if (env.HOT_MONITOR_SEARCH_LOCATION) url.searchParams.set('location', env.HOT_MONITOR_SEARCH_LOCATION);
      if (engine === 'baidu') url.searchParams.set('rn', String(perQuery));
      const json = await fetchJson(url.toString(), fetchImpl);
      const rawResults = Array.isArray(json.organic_results)
        ? json.organic_results
        : Array.isArray(json.news_results)
          ? json.news_results
          : [];
      items.push(...rawResults.slice(0, perQuery).map((result) => normalizeSearchResult('serpapi', query, {
        ...result,
        engine,
      })));
    } catch (error) {
      items.push({
        id: `search-error:serpapi:${query}`,
        title: `SerpApi 搜索失败：${query}`,
        source: `SerpApi ${engine}`,
        kind: 'benefit-error',
        summary: maskSensitiveUrl(error.message),
        topic: query,
      });
    }
  }
  return items;
}

async function fetchSearxngSearchItems(env = process.env, fetchImpl = fetch) {
  const baseUrl = env.HOT_MONITOR_SEARXNG_URL || env.SEARXNG_URL;
  if (!baseUrl || String(env.HOT_MONITOR_SEARXNG_ENABLED || 'true').toLowerCase() === 'false') return [];
  const perQuery = Number(env.HOT_MONITOR_SEARCH_PER_QUERY || env.HOT_MONITOR_SEARXNG_COUNT || 5);
  const items = [];
  for (const query of getSearchQueries(env)) {
    try {
      const url = new URL('/search', String(baseUrl).replace(/\/+$/, ''));
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('language', env.HOT_MONITOR_SEARCH_LANG || 'zh-CN');
      url.searchParams.set('safesearch', env.HOT_MONITOR_SEARXNG_SAFESEARCH || '1');
      const json = await fetchJson(url.toString(), fetchImpl);
      const results = Array.isArray(json.results) ? json.results : [];
      items.push(...results.slice(0, perQuery).map((result) => normalizeSearchResult('searxng', query, result)));
    } catch (error) {
      items.push({
        id: `search-error:searxng:${query}`,
        title: `SearXNG 搜索失败：${query}`,
        source: 'SearXNG 搜索',
        kind: 'benefit-error',
        summary: maskSensitiveUrl(error.message),
        topic: query,
      });
    }
  }
  return items;
}

async function fetchExternalSearchItems(env = process.env, fetchImpl = fetch) {
  if (String(env.HOT_MONITOR_SEARCH_ENABLED || 'true').toLowerCase() === 'false') return [];
  const [tavilyItems, braveItems, serpApiItems, searxngItems] = await Promise.all([
    fetchTavilySearchItems(env, fetchImpl),
    fetchBraveSearchItems(env, fetchImpl),
    fetchSerpApiSearchItems(env, fetchImpl),
    fetchSearxngSearchItems(env, fetchImpl),
  ]);
  return [...tavilyItems, ...braveItems, ...serpApiItems, ...searxngItems];
}

async function fetchHackerNewsBenefitItems(env = process.env, fetchImpl = fetch) {
  const queries = parseListEnv(env.HOT_MONITOR_BENEFIT_QUERIES, DEFAULT_BENEFIT_QUERIES)
    .slice(0, Number(env.HOT_MONITOR_BENEFIT_HN_MAX_QUERIES || 8));
  const perQuery = Number(env.HOT_MONITOR_BENEFIT_HN_PER_QUERY || 3);
  const items = [];
  for (const query of queries) {
    const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
    url.searchParams.set('tags', 'story');
    url.searchParams.set('query', query);
    url.searchParams.set('hitsPerPage', String(perQuery));
    try {
      const json = JSON.parse(await fetchText(url.toString(), fetchImpl, { accept: 'application/json' }));
      const hits = Array.isArray(json.hits) ? json.hits : [];
      items.push(...hits.map((hit) => ({
        id: `hn-benefit:${hit.objectID || hit.url || hit.title}`,
        title: hit.title || hit.story_title || '',
        source: `Hacker News 福利: ${query}`,
        kind: 'benefit-hacker-news',
        link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        summary: hit.story_text || '',
        topic: query,
        publishedAt: hit.created_at || '',
      })));
    } catch (error) {
      items.push({
        id: `hn-benefit-error:${query}`,
        title: `Hacker News 福利查询失败：${query}`,
        source: 'Hacker News 福利',
        kind: 'benefit-error',
        summary: error.message,
      });
    }
  }
  return items;
}

async function fetchBenefitRssItems(env = process.env, fetchImpl = fetch) {
  const feeds = parseFeedConfig(env.HOT_MONITOR_BENEFIT_RSS_FEEDS)
    .slice(0, Number(env.HOT_MONITOR_BENEFIT_RSS_MAX_FEEDS || 8));
  const perFeed = Number(env.HOT_MONITOR_BENEFIT_RSS_PER_FEED || 5);
  const items = [];
  for (const feed of feeds.length ? feeds : DEFAULT_BENEFIT_FEEDS) {
    try {
      const xml = await fetchText(feed.url, fetchImpl, {
        accept: 'application/rss+xml, application/atom+xml, text/xml, */*',
      });
      items.push(...parseRssItems(xml, feed.source).slice(0, perFeed).map((item) => ({
        ...item,
        id: `benefit-rss:${item.link || item.title}`,
        kind: 'benefit-rss',
      })));
    } catch (error) {
      items.push({
        id: `benefit-rss-error:${feed.source}`,
        title: `${feed.source} 福利源抓取失败`,
        source: feed.source,
        kind: 'benefit-error',
        summary: error.message,
      });
    }
  }
  return items;
}

async function collectHotMonitorItems(env = process.env, fetchImpl = fetch, options = {}) {
  const [trendItems, hnBenefits, rssBenefits, externalSearchItems] = await Promise.all([
    collectTrendIntel(env, fetchImpl, {
      limit: env.HOT_MONITOR_TREND_LIMIT || 60,
      now: options.now,
    }),
    fetchHackerNewsBenefitItems(env, fetchImpl),
    fetchBenefitRssItems(env, fetchImpl),
    fetchExternalSearchItems(env, fetchImpl),
  ]);
  return [...trendItems, ...hnBenefits, ...rssBenefits, ...externalSearchItems]
    .filter((item) => item && item.title && !/抓取失败|Fetch failed/i.test(item.title));
}

function shouldAlertItem(item = {}, env = process.env, options = {}) {
  const minDeltaStars = Number(options.minDeltaStars ?? env.HOT_MONITOR_MIN_DELTA_STARS ?? 30);
  const minStarsToday = Number(options.minStarsToday ?? env.HOT_MONITOR_MIN_STARS_TODAY ?? 50);
  const notifyNewBenefits = toBool(options.notifyNewBenefits ?? env.HOT_MONITOR_NOTIFY_NEW_BENEFITS, true);
  if (item.categories?.includes('benefit') && item.isNew !== false && notifyNewBenefits) return true;
  if (Number(item.deltaStars || 0) >= minDeltaStars) return true;
  if (Number(item.starsToday || 0) >= minStarsToday) return true;
  return false;
}

function buildHotMonitorSnapshot(rawItems = [], previousState = {}, env = process.env, options = {}) {
  const now = options.now || new Date();
  const previousItems = previousState.items || {};
  const previousSeen = previousState.seen || Object.fromEntries(Object.entries(previousItems).map(([id, item]) => [
    id,
    {
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      stars: item.stars,
    },
  ]));
  const normalizedRaw = rawItems
    .map((item) => normalizeHotItem(item, previousItems[itemKey(item)] || previousSeen[itemKey(item)], now))
    .filter((item) => item.title)
    .sort((a, b) => b.score - a.score || b.deltaStars - a.deltaStars || String(a.title).localeCompare(String(b.title)));
  const dedupMap = new Map();
  for (const item of normalizedRaw) {
    const key = item.dedupKey || item.id;
    if (!dedupMap.has(key)) {
      dedupMap.set(key, item);
      continue;
    }
    const previous = dedupMap.get(key);
    if ((item.score || 0) > (previous.score || 0)) {
      dedupMap.set(key, item);
    }
  }
  const normalized = [...dedupMap.values()]
    .sort((a, b) => b.score - a.score || b.deltaStars - a.deltaStars || String(a.title).localeCompare(String(b.title)));
  const maxTracked = Number(env.HOT_MONITOR_MAX_TRACKED_ITEMS || 300);
  const items = {};
  for (const item of normalized.slice(0, maxTracked)) {
    items[item.id] = item;
  }
  const seen = { ...previousSeen };
  for (const item of normalized) {
    seen[item.id] = {
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      stars: item.stars,
      source: item.source,
      title: item.title,
    };
  }
  return {
    generatedAt: now.toISOString(),
    total: normalized.length,
    items,
    seen,
    ordered: normalized,
  };
}

function selectAlertItems(snapshot = {}, previousState = {}, env = process.env, options = {}) {
  const maxAlerts = Number(options.maxAlerts ?? env.HOT_MONITOR_MAX_ALERTS ?? 8);
  const cooldownMinutes = Number(options.cooldownMinutes ?? env.HOT_MONITOR_ALERT_COOLDOWN_MINUTES ?? 360);
  const nowMs = Date.parse(snapshot.generatedAt || new Date().toISOString());
  const referenceDate = options.now || new Date(snapshot.generatedAt || Date.now());
  const alerts = previousState.alerts || {};
  return (snapshot.ordered || [])
    .map((item) => {
      const previous = previousState.items?.[item.id] || {};
      return {
        ...item,
        isNew: !previous.firstSeenAt,
      };
    })
    .filter((item) => {
      const alertKey = item.alertKey || item.id;
      const lastAlert = Date.parse(alerts[alertKey] || alerts[item.id] || '');
      if (Number.isFinite(lastAlert) && nowMs - lastAlert < cooldownMinutes * 60 * 1000) {
        return false;
      }
      if (item.categories?.includes('benefit') && isExpiredBenefitItem(item, referenceDate)) {
        return false;
      }
      return shouldAlertItem(item, env, options);
    })
    .slice(0, maxAlerts);
}

function formatHotMonitorMessage(alertItems = [], snapshot = {}, options = {}) {
  const assistant = options.assistantName || 'Hermes';
  const lines = [
    `${assistant} 30 分钟热点/福利雷达`,
    `本轮扫描：${snapshot.total || 0} 条，命中：${alertItems.length} 条。`,
  ];
  if (!alertItems.length) {
    lines.push('没有发现新的高价值热点或福利活动。');
    return lines.join('\n');
  }
  const tech = alertItems.filter((item) => !item.categories?.includes('benefit'));
  const benefits = alertItems.filter((item) => item.categories?.includes('benefit'));
  if (benefits.length) {
    lines.push('', '福利/免费活动：');
    benefits.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.titleZh || item.title}`);
      if (item.titleZh && item.titleZh !== item.title) lines.push(`   原标题：${item.title}`);
      lines.push(`   原因：${item.alertReason}；分数 ${item.score}`);
      if (item.titleZh) lines.push(`   中文理解：${item.titleZh}`);
      if (item.summaryZh) lines.push(`   中文摘要：${item.summaryZh}`);
      if (item.summary) lines.push(`   摘要：${item.summary}`);
      if (item.link) lines.push(`   链接：${item.link}`);
    });
  }
  if (tech.length) {
    lines.push('', '技术热点：');
    tech.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.titleZh || item.title}`);
      if (item.titleZh && item.titleZh !== item.title) lines.push(`   原标题：${item.title}`);
      lines.push(`   原因：${item.alertReason}；分数 ${item.score}`);
      if (item.titleZh) lines.push(`   中文理解：${item.titleZh}`);
      if (item.summaryZh) lines.push(`   中文摘要：${item.summaryZh}`);
      if (item.stars || item.deltaStars || item.starsToday) {
        lines.push(`   热度：总 stars ${item.stars || '未知'}，本轮增量 ${item.deltaStars || 0}，今日新增 ${item.starsToday || 0}`);
      }
      if (item.summary) lines.push(`   摘要：${item.summary}`);
      if (item.link) lines.push(`   链接：${item.link}`);
    });
  }
  lines.push('', '处理建议：高价值技术热点进 trend-token-factory；福利活动优先手动核验领取条件，避免误点钓鱼链接。');
  return lines.join('\n');
}

function buildNotificationTarget(env = process.env) {
  const receiveId = env.HOT_MONITOR_FEISHU_RECEIVE_ID
    || env.FEISHU_NOTIFY_RECEIVE_ID
    || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID
    || String(env.HERMES_FEISHU_ALLOWED_USER_IDS || env.FEISHU_ALLOWED_USER_IDS || '').split(',')[0].trim();
  if (!receiveId) return null;
  return {
    receiveId,
    receiveIdType: env.HOT_MONITOR_FEISHU_RECEIVE_ID_TYPE
      || env.FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || 'open_id',
  };
}

async function sendHotMonitorNotification(env, text, options = {}) {
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

async function runHotMonitor(config = {}, options = {}) {
  const env = { ...process.env, ...parseEnvFile(config.envFile), ...(options.env || {}) };
  const now = options.now || new Date();
  const stateFile = config.stateFile || env.HOT_MONITOR_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'hot-monitor-state.json');
  const outputFile = config.outputFile || env.HOT_MONITOR_OUTPUT_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'hot-monitor', 'latest.json');
  const previousState = readJsonFile(stateFile, { items: {}, alerts: {} });
  const taskId = `hot-monitor-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
  const recordTask = options.recordTask !== false;
  if (recordTask) {
    recordTaskEvent({
      taskId,
      type: 'hot-monitor',
      event: 'scheduled',
      status: 'running',
      now: now.toISOString(),
    }, { env, now: now.toISOString() });
  }
  try {
    const rawItems = await (options.collectItems || collectHotMonitorItems)(env, options.fetchImpl || fetch, { now });
    const snapshot = buildHotMonitorSnapshot(rawItems, previousState, env, { now });
    const alertItems = config.force
      ? snapshot.ordered.slice(0, Number(env.HOT_MONITOR_MAX_ALERTS || 8))
      : selectAlertItems(snapshot, previousState, env);
    const shouldNotify = alertItems.length > 0 || toBool(env.HOT_MONITOR_NOTIFY_EMPTY, false) || config.force;
    const message = formatHotMonitorMessage(alertItems, snapshot, {
      assistantName: env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || 'Hermes',
    });
    const nextState = {
      ...previousState,
      lastRunAt: now.toISOString(),
      lastTotal: snapshot.total,
      items: snapshot.items,
      seen: snapshot.seen,
      alerts: { ...(previousState.alerts || {}) },
    };
    if (alertItems.length && !config.dryRun) {
      for (const item of alertItems) {
        nextState.alerts[item.alertKey || item.id] = now.toISOString();
      }
    }
    writeJsonFile(stateFile, nextState);
    writeJsonFile(outputFile, {
      generatedAt: snapshot.generatedAt,
      total: snapshot.total,
      alertCount: alertItems.length,
      alerts: alertItems,
      top: snapshot.ordered.slice(0, 20),
      message,
    });
    let protocolAssets = { saved: [], skipped: [], reason: 'disabled' };
    if (
      alertItems.length
      && !config.dryRun
      && toBool(env.HOT_MONITOR_PROTOCOL_ASSETS_ENABLED, true)
    ) {
      protocolAssets = await Promise.resolve(
        (options.saveProtocolAssets || saveHotMonitorCandidatesAsProtocolAssets)(alertItems, {
          dir: env.PROTOCOL_ASSET_DIR,
          now: now.toISOString(),
        }),
      ).catch((error) => ({
        saved: [],
        skipped: [],
        reason: error.message,
      }));
    }
    let notification = { sent: false, reason: shouldNotify ? 'dry_run' : 'no_alerts' };
    if (shouldNotify && !config.dryRun && toBool(env.HOT_MONITOR_FEISHU_NOTIFY_ENABLED, true)) {
      notification = await sendHotMonitorNotification(env, message, options).catch((error) => ({
        sent: false,
        reason: error.message,
      }));
    }
    if (recordTask) {
      recordTaskEvent({
        taskId,
        type: 'hot-monitor',
        event: 'completed',
        status: 'completed',
        now: new Date(now.getTime() + 1000).toISOString(),
        summaryPatch: {
          total: snapshot.total,
          alertCount: alertItems.length,
          sent: Boolean(notification.sent),
          protocolAssetsSaved: protocolAssets.saved.length,
        },
        filesPatch: { outputFile, protocolAssetDir: env.PROTOCOL_ASSET_DIR || null },
      }, { env });
    }
    return {
      ok: true,
      total: snapshot.total,
      alertCount: alertItems.length,
      alerts: alertItems,
      notification,
      stateFile,
      outputFile,
      protocolAssets,
      message,
    };
  } catch (error) {
    if (recordTask) {
      recordTaskEvent({
        taskId,
        type: 'hot-monitor',
        event: 'failed',
        status: 'failed',
        now: new Date().toISOString(),
        error: String(error.message || error).slice(0, 1000),
      }, { env });
    }
    throw error;
  }
}

async function main() {
  const config = parseCliArgs();
  const result = await runHotMonitor(config);
  console.log(JSON.stringify({
    ok: result.ok,
    total: result.total,
    alertCount: result.alertCount,
    notification: result.notification,
    stateFile: result.stateFile,
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
  BENEFIT_KEYWORDS,
  DEFAULT_BENEFIT_FEEDS,
  DEFAULT_BENEFIT_QUERIES,
  DEFAULT_SEARCH_QUERIES,
  buildChineseUnderstanding,
  buildHotMonitorSnapshot,
  buildNotificationTarget,
  classifyHotItem,
  collectHotMonitorItems,
  defaultHotMonitorOnCalendar,
  fetchBenefitRssItems,
  fetchBraveSearchItems,
  fetchExternalSearchItems,
  fetchHackerNewsBenefitItems,
  fetchSerpApiSearchItems,
  fetchSearxngSearchItems,
  fetchTavilySearchItems,
  formatHotMonitorMessage,
  isExpiredBenefitItem,
  parseCliArgs,
  runHotMonitor,
  scoreHotItem,
  selectAlertItems,
  shouldAlertItem,
};
