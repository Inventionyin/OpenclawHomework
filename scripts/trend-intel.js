const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const DEFAULT_GITHUB_TOPICS = [
  'ai-agent',
  'playwright',
  'software-testing',
  'ecommerce',
  'llm',
  'browser-automation',
];
const DEFAULT_HN_QUERIES = ['AI agent', 'Playwright', 'testing', 'LLM', 'ecommerce'];
const DEFAULT_RSS_FEEDS = [
  { source: 'GitHub Blog', url: 'https://github.blog/feed/' },
  { source: 'Playwright Releases', url: 'https://github.com/microsoft/playwright/releases.atom' },
  { source: 'Cypress Releases', url: 'https://github.com/cypress-io/cypress/releases.atom' },
];
const REDACTED_SECRET_OUTPUT = '[redacted secret-like output]';
const SECRET_LIKE_PATTERNS = [
  /\bauthorization\s*:\s*\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\b(?:token|secret|password|api[_-]?key|apikey|key)\s*[:=]\s*[A-Za-z0-9._~+/=-]{4,}/i,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/i,
  /\b(?:ghp|gho|ghu|ghs|ghr|sk|ak|ck_live)_[A-Za-z0-9_-]{8,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i,
];

function parseListEnv(value, defaults = []) {
  const items = String(value || '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : [...defaults];
}

function parseFeedConfig(value) {
  const configured = parseListEnv(value, []);
  if (!configured.length) return [...DEFAULT_RSS_FEEDS];
  return configured.map((item) => {
    const parts = item.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { source: parts[0], url: parts.slice(1).join('|') };
    }
    return { source: 'RSS', url: item };
  }).filter((item) => item.url);
}

function stripTags(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanText(value) {
  return decodeEntities(stripTags(value));
}

function looksSecretLike(value) {
  const text = String(value ?? '');
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeTrendField(value, limit = 300) {
  const text = cleanText(value || '');
  if (!text) return '';
  if (looksSecretLike(text)) return REDACTED_SECRET_OUTPUT;
  return text.slice(0, limit);
}

function getTag(block, tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const name of names) {
    const match = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return cleanText(match[1]);
  }
  return '';
}

function getXmlLink(block) {
  const href = String(block || '').match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (href) return decodeEntities(href[1]);
  return getTag(block, 'link');
}

function parseInteger(value) {
  const text = String(value || '').replace(/[^\d]/g, '');
  return text ? Number(text) : undefined;
}

function formatStars(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : '未提供';
}

function buildHeatMetric(item = {}) {
  const source = sanitizeTrendField(item.source || item.kind || 'Trend Intel', 120) || 'Trend Intel';
  const isTrending = item.kind === 'github-trending' || /trending/i.test(source);
  const sourceMetric = isTrending ? 'GitHub Trending daily' : source;
  return `${sourceMetric} / 今日新增 stars ${formatStars(item.starsToday)} / 总 stars ${formatStars(item.stars)}`;
}

function daysAgoIso(days, now = new Date()) {
  const date = new Date(now.getTime() - Number(days || 14) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildGitHubSearchUrl(topic, options = {}) {
  const pushed = daysAgoIso(options.days || 14, options.now || new Date());
  const query = `topic:${topic} pushed:>=${pushed}`;
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Number(options.perPage || options.limit || 5)}`;
}

async function fetchText(url, fetchImpl, options = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': options.userAgent || 'OpenclawHomework-TrendIntel/1.0',
      Accept: options.accept || '*/*',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

async function fetchJson(url, fetchImpl, options = {}) {
  const text = await fetchText(url, fetchImpl, options);
  return JSON.parse(text);
}

function parseGitHubTrendingHtml(html) {
  const articles = [...String(html || '').matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  return articles.map((article) => {
    const repoMatch = article.match(/<h2[\s\S]*?<a[^>]+href=["']\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i)
      || article.match(/<a[^>]+href=["']\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!repoMatch) return null;
    const repo = cleanText(repoMatch[2]).replace(/\s*\/\s*/g, '/').replace(/\s+/g, '');
    const slug = repoMatch[1].replace(/^\/+/, '').replace(/\/+$/, '');
    const fullName = repo.includes('/') ? repo : slug.split('/').slice(0, 2).join('/');
    const languageMatch = article.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i);
    const starsMatch = article.match(/href=["']\/[^"']+\/stargazers["'][^>]*>([\s\S]*?)<\/a>/i);
    const starsTodayMatch = article.match(/([\d,]+)\s+stars?\s+today/i);
    const stars = starsMatch ? parseInteger(cleanText(starsMatch[1])) : undefined;
    const starsToday = starsTodayMatch ? parseInteger(starsTodayMatch[1]) : undefined;
    const item = {
      id: `github-trending:${fullName}`,
      title: fullName,
      source: 'GitHub Trending',
      kind: 'github-trending',
      link: `https://github.com/${fullName}`,
      summary: getTag(article, 'p'),
      language: languageMatch ? cleanText(languageMatch[1]) : '',
      stars,
      starsToday,
      publishedAt: '',
    };
    item.heatMetric = buildHeatMetric(item);
    return {
      ...item,
    };
  }).filter(Boolean);
}

function parseRssItems(xml, source = 'RSS') {
  const text = String(xml || '');
  const blocks = [
    ...text.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);
  return blocks.map((block) => {
    const link = getXmlLink(block);
    return {
      id: `rss:${link || getTag(block, 'title')}`,
      title: getTag(block, 'title'),
      source,
      kind: 'rss',
      link,
      summary: getTag(block, ['description', 'summary', 'content']),
      publishedAt: getTag(block, ['pubDate', 'published', 'updated']),
    };
  }).filter((item) => item.title);
}

async function fetchGitHubSearchItems(env = process.env, fetchImpl = fetch, options = {}) {
  const topics = parseListEnv(env.TREND_INTEL_GITHUB_TOPICS, DEFAULT_GITHUB_TOPICS)
    .slice(0, Number(env.TREND_INTEL_GITHUB_MAX_TOPICS || options.maxTopics || 6));
  const perTopic = Number(env.TREND_INTEL_GITHUB_PER_TOPIC || options.perTopic || 3);
  const headers = {};
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN || env.GH_TOKEN}`;
  }
  const items = [];
  for (const topic of topics) {
    const url = buildGitHubSearchUrl(topic, {
      days: env.TREND_INTEL_GITHUB_DAYS || options.days || 14,
      perPage: perTopic,
      now: options.now,
    });
    const json = await fetchJson(url, fetchImpl, {
      accept: 'application/vnd.github+json',
      headers,
    });
    const repos = Array.isArray(json.items) ? json.items : [];
    items.push(...repos.slice(0, perTopic).map((repo) => ({
      id: `github-search:${repo.full_name}`,
      title: repo.full_name,
      source: `GitHub Search: ${topic}`,
      kind: 'github-search',
      link: repo.html_url,
      summary: repo.description || '',
      stars: repo.stargazers_count,
      language: repo.language || '',
      topic,
      publishedAt: repo.pushed_at || repo.updated_at || '',
    })));
  }
  return items;
}

async function fetchGitHubTrendingItems(env = process.env, fetchImpl = fetch) {
  const html = await fetchText('https://github.com/trending?since=daily', fetchImpl, {
    accept: 'text/html,*/*',
  });
  return parseGitHubTrendingHtml(html);
}

function buildHackerNewsUrl(query, perQuery) {
  const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
  url.searchParams.set('tags', 'story');
  url.searchParams.set('query', query);
  url.searchParams.set('hitsPerPage', String(perQuery));
  return url.toString();
}

async function fetchHackerNewsItems(env = process.env, fetchImpl = fetch, options = {}) {
  const queries = parseListEnv(env.TREND_INTEL_HN_QUERIES, DEFAULT_HN_QUERIES)
    .slice(0, Number(env.TREND_INTEL_HN_MAX_QUERIES || options.maxQueries || 5));
  const perQuery = Number(env.TREND_INTEL_HN_PER_QUERY || options.perQuery || 3);
  const items = [];
  for (const query of queries) {
    const json = await fetchJson(buildHackerNewsUrl(query, perQuery), fetchImpl, {
      accept: 'application/json',
    });
    const hits = Array.isArray(json.hits) ? json.hits : [];
    items.push(...hits.slice(0, perQuery).map((hit) => {
      const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      return {
        id: `hn:${hit.objectID || link}`,
        title: hit.title || hit.story_title || link,
        source: `Hacker News: ${query}`,
        kind: 'hacker-news',
        link,
        summary: cleanText(hit.story_text || hit.comment_text || ''),
        topic: query,
        publishedAt: hit.created_at || '',
      };
    }));
  }
  return items;
}

async function fetchRssFeedItems(env = process.env, fetchImpl = fetch, options = {}) {
  const feeds = parseFeedConfig(env.TREND_INTEL_RSS_FEEDS)
    .slice(0, Number(env.TREND_INTEL_RSS_MAX_FEEDS || options.maxFeeds || 8));
  const perFeed = Number(env.TREND_INTEL_RSS_PER_FEED || options.perFeed || 3);
  const items = [];
  for (const feed of feeds) {
    const xml = await fetchText(feed.url, fetchImpl, {
      accept: 'application/rss+xml, application/atom+xml, text/xml, */*',
    });
    items.push(...parseRssItems(xml, feed.source).slice(0, perFeed));
  }
  return items;
}

function normalizeTrendItems(items = [], limit = 50) {
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(items) ? items : []) {
    const title = sanitizeTrendField(item.title || '', 180);
    if (!title) continue;
    const link = sanitizeTrendField(item.link || '', 500);
    const key = (link || `${item.source || ''}|${title}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const source = sanitizeTrendField(item.source || 'Trend Intel', 120) || 'Trend Intel';
    const kind = sanitizeTrendField(item.kind || 'trend', 80) || 'trend';
    const summary = sanitizeTrendField(item.summary || '', 300);
    const language = sanitizeTrendField(item.language || '', 80);
    const topic = sanitizeTrendField(item.topic || '', 120);
    const publishedAt = sanitizeTrendField(item.publishedAt || '', 80);
    normalized.push({
      id: sanitizeTrendField(item.id || `${kind}:${key}`, 260),
      title,
      source,
      kind,
      link,
      summary,
      stars: item.stars,
      starsToday: item.starsToday,
      heatMetric: sanitizeTrendField(item.heatMetric || buildHeatMetric({ ...item, source, kind }), 220),
      language,
      topic,
      publishedAt,
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

async function collectTrendIntel(env = process.env, fetchImpl = fetch, options = {}) {
  const sources = [
    ['github-search', () => fetchGitHubSearchItems(env, fetchImpl, options)],
    ['github-trending', () => fetchGitHubTrendingItems(env, fetchImpl, options)],
    ['hacker-news', () => fetchHackerNewsItems(env, fetchImpl, options)],
    ['rss', () => fetchRssFeedItems(env, fetchImpl, options)],
  ];
  const settled = await Promise.allSettled(sources.map(([, runner]) => runner()));
  const groups = [];
  const errors = [];

  settled.forEach((result, index) => {
    const source = sources[index][0];
    if (result.status === 'fulfilled') {
      groups.push(result.value);
      return;
    }
    errors.push({
      source,
      message: String(result.reason?.message || result.reason || 'unknown error'),
    });
  });

  const normalized = normalizeTrendItems(groups.flat(), Number(options.limit || env.TREND_INTEL_LIMIT || 50));
  normalized.errors = errors;
  return normalized;
}

function inferUsefulFor(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.topic,
    item.language,
  ].join(' ').toLowerCase();
  const useful = [];
  if (/playwright|cypress|selenium|test|testing|qa|browser|automation|e2e/.test(text)) {
    useful.push('UI 自动化');
  }
  if (/agent|llm|ai|browserbase|stagehand|mcp|workflow|automation/.test(text)) {
    useful.push('AI Agent');
  }
  if (/shop|commerce|ecommerce|order|payment|cart|retail/.test(text)) {
    useful.push('电商测试');
  }
  if (/mail|email|smtp|imap|inbox|notification/.test(text)) {
    useful.push('邮箱平台');
  }
  if (/support|customer|客服|chat|conversation|dataset|training/.test(text)) {
    useful.push('客服数据');
  }
  if (!useful.length) {
    useful.push('AI Agent', 'UI 自动化');
  }
  return [...new Set(useful)].join(' / ');
}

function buildLearningReason(item = {}) {
  const summary = cleanText(item.summary || '');
  if (summary) {
    return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  }
  if (item.kind === 'github-trending') {
    return '进入 GitHub 今日趋势，适合快速观察近期开发者关注的实现方向。';
  }
  if (item.kind === 'github-search') {
    return '近期仍有更新且总 stars 较高，适合作为工程实现和测试设计参考。';
  }
  return '可作为测试、Agent 或业务自动化方向的补充观察材料。';
}

function inferNextStep(item = {}) {
  if (item.kind === 'github-trending' || item.kind === 'github-search' || String(item.link || '').includes('github.com/')) {
    const useful = inferUsefulFor(item);
    if (useful.includes('UI 自动化')) return '看 README / 跑 demo / 借鉴测试用例 / 加到 token 工厂分析';
    if (useful.includes('AI Agent')) return '看 README / 跑 demo / 分析 Agent 工作流 / 加到 token 工厂分析';
    return '看 README / 跑 demo / 提炼可复用模块 / 加到 token 工厂分析';
  }
  return '阅读原文 / 提炼测试观点 / 加到 token 工厂分析';
}

function buildRadarOpening(items = []) {
  if (!items.length) return '今天暂时没有抓到稳定的热点数据，我建议晚点再拉一轮。';
  const picks = items.slice(0, 3).map((item) => item.projectName).join('、');
  return `我先给你挑了 ${items.length} 个今天最值得看的开源项目：${picks}。优先都和 UI 自动化、AI Agent 或测试流程有关。`;
}

function toNaturalRadarItemText(item, index) {
  const lines = [];
  lines.push(`${index + 1}. ${item.projectName}`);
  lines.push(`   热度看法：${item.heatMetric}。`);
  lines.push(`   值得学的原因：${item.whyLearn}`);
  lines.push(`   对你现在项目最有用：${item.usefulFor}。`);
  lines.push(`   我建议你下一步：${item.nextStep}。`);
  if (item.link) {
    lines.push(`   项目地址：${item.link}`);
  }
  return lines.join('\n');
}

function buildRadarClosing(items = []) {
  if (!items.length) return '';
  return '要我继续的话，我可以下一条直接给你“先看哪个、先抄哪段测试思路、今天怎么烧 token 最值”的执行顺序。';
}

function buildOpenSourceLearningRadar(items = [], options = {}) {
  const normalized = normalizeTrendItems(items, Number(options.limit || 10));
  const radarItems = normalized.map((item) => ({
    projectName: item.title,
    link: item.link,
    heatMetric: item.heatMetric || buildHeatMetric(item),
    whyLearn: buildLearningReason(item),
    usefulFor: inferUsefulFor(item),
    nextStep: inferNextStep(item),
    source: item.source,
    kind: item.kind,
  }));

  const text = radarItems.length
    ? [
      '今日开源学习雷达',
      buildRadarOpening(radarItems),
      ...radarItems.map((item, index) => toNaturalRadarItemText(item, index)),
      buildRadarClosing(radarItems),
    ].filter(Boolean).join('\n\n')
    : '今日开源学习雷达\n暂无值得展示的开源项目。';

  return {
    total: radarItems.length,
    items: radarItems,
    text,
  };
}

function buildTrendIntelReport(items = [], options = {}) {
  const normalized = normalizeTrendItems(items, Number(options.limit || 50));
  const errors = Array.isArray(items?.errors) ? items.errors : (Array.isArray(options.errors) ? options.errors : []);
  const learningRadar = buildOpenSourceLearningRadar(normalized, {
    limit: options.radarLimit || options.limit || 10,
  });
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    total: normalized.length,
    items: normalized,
    learningRadar,
    errors,
    summary: normalized.length
      ? learningRadar.text
      : '暂无热点条目。',
  };
}

function writeTrendIntelReport(file, report) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const items = await collectTrendIntel(process.env, fetch);
  const report = buildTrendIntelReport(items);
  const output = process.env.TREND_INTEL_OUTPUT_FILE || join(process.cwd(), 'data', 'trend-intel', 'latest.json');
  writeTrendIntelReport(output, report);
  console.log(JSON.stringify({ total: report.total, output }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_GITHUB_TOPICS,
  DEFAULT_HN_QUERIES,
  DEFAULT_RSS_FEEDS,
  buildGitHubSearchUrl,
  buildHackerNewsUrl,
  buildHeatMetric,
  buildOpenSourceLearningRadar,
  buildTrendIntelReport,
  collectTrendIntel,
  daysAgoIso,
  fetchGitHubSearchItems,
  fetchGitHubTrendingItems,
  fetchHackerNewsItems,
  fetchRssFeedItems,
  normalizeTrendItems,
  parseFeedConfig,
  parseGitHubTrendingHtml,
  parseListEnv,
  parseRssItems,
  writeTrendIntelReport,
};
