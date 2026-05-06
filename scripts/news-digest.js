const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

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
    if (match) {
      return decodeXml(stripTags(match[1]));
    }
  }
  return '';
}

function getLink(block) {
  const href = String(block || '').match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (href) {
    return decodeXml(href[1]);
  }
  return getTag(block, 'link');
}

function parseFeedItems(xml, source = 'RSS') {
  const text = String(xml || '');
  const itemBlocks = [
    ...text.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);

  return itemBlocks.map((block) => ({
    title: getTag(block, 'title'),
    link: getLink(block),
    summary: getTag(block, ['description', 'summary', 'content']),
    publishedAt: getTag(block, ['pubDate', 'published', 'updated']),
    source,
    kind: 'rss',
  })).filter((item) => item.title);
}

function parseFeedConfig(value) {
  const configured = splitList(value);
  if (!configured.length) {
    return [
      { source: 'GitHub Blog', url: 'https://github.blog/feed/' },
      { source: 'Playwright Releases', url: 'https://github.com/microsoft/playwright/releases.atom' },
      { source: 'Cypress Releases', url: 'https://github.com/cypress-io/cypress/releases.atom' },
    ];
  }

  return configured.map((item) => {
    const parts = item.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { source: parts[0], url: parts.slice(1).join('|') };
    }
    return { source: 'RSS', url: item };
  }).filter((item) => item.url);
}

function parseGitHubTopics(value) {
  const configured = splitList(value);
  return configured.length ? configured : ['ai-agent', 'playwright', 'software-testing', 'e2e-testing'];
}

function daysAgoIso(days, now = new Date()) {
  const date = new Date(now.getTime() - Number(days || 7) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildGitHubSearchUrl(topic, options = {}) {
  const days = Number(options.days || 14);
  const pushed = daysAgoIso(days, options.now || new Date());
  const query = `topic:${topic} pushed:>=${pushed}`;
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Number(options.limit || 5)}`;
}

async function fetchText(url, fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': options.userAgent || 'OpenclawHomework-ProactiveDigest/1.0',
      Accept: options.accept || '*/*',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

async function fetchRssItems(env = process.env, fetchImpl = fetch, options = {}) {
  if (String(env.PROACTIVE_DIGEST_RSS_ENABLED ?? 'true').toLowerCase() === 'false') {
    return [];
  }

  const feeds = parseFeedConfig(env.PROACTIVE_DIGEST_RSS_FEEDS);
  const perFeed = Number(env.PROACTIVE_DIGEST_RSS_PER_FEED || options.perFeed || 3);
  const results = [];
  for (const feed of feeds.slice(0, Number(env.PROACTIVE_DIGEST_RSS_MAX_FEEDS || 8))) {
    try {
      const xml = await fetchText(feed.url, fetchImpl, { accept: 'application/rss+xml, application/atom+xml, text/xml, */*' });
      results.push(...parseFeedItems(xml, feed.source).slice(0, perFeed));
    } catch (error) {
      results.push({
        title: `${feed.source} 抓取失败：${error.message}`,
        source: feed.source,
        kind: 'rss-error',
      });
    }
  }
  return results;
}

async function fetchGitHubTrending(env = process.env, fetchImpl = fetch, options = {}) {
  if (String(env.PROACTIVE_DIGEST_GITHUB_TRENDING_ENABLED ?? 'true').toLowerCase() === 'false') {
    return [];
  }

  const topics = parseGitHubTopics(env.PROACTIVE_DIGEST_GITHUB_TOPICS);
  const headers = {};
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN || env.GH_TOKEN}`;
  }
  const results = [];
  for (const topic of topics.slice(0, Number(env.PROACTIVE_DIGEST_GITHUB_MAX_TOPICS || 4))) {
    try {
      const url = buildGitHubSearchUrl(topic, {
        days: env.PROACTIVE_DIGEST_GITHUB_DAYS || options.days || 14,
        limit: env.PROACTIVE_DIGEST_GITHUB_PER_TOPIC || options.limit || 3,
        now: options.now,
      });
      const body = await fetchText(url, fetchImpl, {
        accept: 'application/vnd.github+json',
        headers,
      });
      const json = JSON.parse(body);
      const repos = Array.isArray(json.items) ? json.items : [];
      results.push(...repos.slice(0, Number(env.PROACTIVE_DIGEST_GITHUB_PER_TOPIC || options.limit || 3)).map((repo) => ({
        title: `${repo.full_name}：${repo.description || '暂无描述'}`,
        link: repo.html_url,
        source: `GitHub ${topic}`,
        stars: repo.stargazers_count,
        kind: 'github',
      })));
    } catch (error) {
      results.push({
        title: `GitHub ${topic} 抓取失败：${error.message}`,
        source: `GitHub ${topic}`,
        kind: 'github-error',
      });
    }
  }
  return results;
}

function normalizeNewsItems(items = [], limit = 12) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const title = stripTags(item.title || '');
    if (!title) continue;
    const key = `${title.toLowerCase()}|${String(item.link || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      title,
      source: item.source || 'news',
      link: item.link || '',
      summary: item.summary ? stripTags(item.summary).slice(0, 180) : '',
      stars: item.stars,
      kind: item.kind || 'news',
    });
    if (result.length >= limit) break;
  }
  return result;
}

function buildNewsReport(items = []) {
  const normalized = normalizeNewsItems(items, 20);
  return {
    total: normalized.length,
    items: normalized,
    text: normalized.length
      ? normalized.map((item, index) => `${index + 1}. ${item.title}${item.stars ? `（${item.stars} stars）` : ''} - ${item.source}${item.link ? `\n   ${item.link}` : ''}`).join('\n')
      : '暂无新闻条目。',
  };
}

async function collectNewsDigest(env = process.env, fetchImpl = fetch, options = {}) {
  const [rssItems, githubItems] = await Promise.all([
    fetchRssItems(env, fetchImpl, options),
    fetchGitHubTrending(env, fetchImpl, options),
  ]);
  return buildNewsReport([...rssItems, ...githubItems]);
}

function writeNewsReport(file, report) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const report = await collectNewsDigest(process.env, fetch);
  const output = process.env.PROACTIVE_DIGEST_NEWS_OUTPUT || join(process.cwd(), 'data', 'news-digest', 'latest.json');
  writeNewsReport(output, report);
  console.log(JSON.stringify({ total: report.total, output }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildGitHubSearchUrl,
  buildNewsReport,
  collectNewsDigest,
  daysAgoIso,
  fetchGitHubTrending,
  fetchRssItems,
  normalizeNewsItems,
  parseFeedConfig,
  parseFeedItems,
  parseGitHubTopics,
};
