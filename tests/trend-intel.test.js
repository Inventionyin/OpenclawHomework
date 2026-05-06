const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildGitHubSearchUrl,
  buildTrendIntelReport,
  collectTrendIntel,
  normalizeTrendItems,
  parseGitHubTrendingHtml,
  parseListEnv,
  parseRssItems,
  writeTrendIntelReport,
} = require('../scripts/trend-intel');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

test('parseListEnv uses defaults and comma separated overrides', () => {
  assert.deepEqual(parseListEnv('a,b\nc', ['x']), ['a', 'b', 'c']);
  assert.deepEqual(parseListEnv('', ['ai-agent', 'playwright']), ['ai-agent', 'playwright']);
});

test('buildGitHubSearchUrl searches topic repositories pushed recently by stars', () => {
  const url = buildGitHubSearchUrl('playwright', {
    days: 7,
    perPage: 4,
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.match(url, /^https:\/\/api\.github\.com\/search\/repositories/);
  assert.match(url, /topic%3Aplaywright/);
  assert.match(url, /pushed%3A%3E%3D2026-04-30/);
  assert.match(url, /sort=stars/);
  assert.match(url, /order=desc/);
  assert.match(url, /per_page=4/);
});

test('parseGitHubTrendingHtml extracts repository fields from fixture html', () => {
  const html = `
    <article class="Box-row">
      <h2><a href="/microsoft/playwright"> microsoft / playwright </a></h2>
      <p>Reliable end-to-end testing for modern web apps</p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <a href="/microsoft/playwright/stargazers">71,234</a>
    </article>
    <article class="Box-row">
      <h2><a href="/browserbase/stagehand"> browserbase / stagehand </a></h2>
      <p>AI browser automation</p>
      <span itemprop="programmingLanguage">Python</span>
      <a href="/browserbase/stagehand/stargazers">9,876</a>
    </article>`;

  const items = parseGitHubTrendingHtml(html);

  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'github-trending:microsoft/playwright');
  assert.equal(items[0].title, 'microsoft/playwright');
  assert.equal(items[0].summary, 'Reliable end-to-end testing for modern web apps');
  assert.equal(items[0].language, 'TypeScript');
  assert.equal(items[0].stars, 71234);
  assert.equal(items[0].link, 'https://github.com/microsoft/playwright');
});

test('parseRssItems supports rss and atom entries', () => {
  const xml = `
    <rss><channel>
      <item><title><![CDATA[GitHub Copilot update]]></title><link>https://github.blog/copilot</link><description>AI coding news</description><pubDate>Thu, 07 May 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>
    <feed>
      <entry><title>Playwright v1.50</title><link href="https://github.com/microsoft/playwright/releases/tag/v1.50"/><summary>Release notes</summary><updated>2026-05-07T00:00:00Z</updated></entry>
    </feed>`;

  const items = parseRssItems(xml, 'Release Feed');

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'GitHub Copilot update');
  assert.equal(items[0].kind, 'rss');
  assert.equal(items[1].link, 'https://github.com/microsoft/playwright/releases/tag/v1.50');
  assert.equal(items[1].publishedAt, '2026-05-07T00:00:00Z');
});

test('collectTrendIntel fetches GitHub search, trending html, HN and RSS with token headers', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('api.github.com/search/repositories')) {
      return response(JSON.stringify({
        items: [{
          full_name: 'microsoft/playwright',
          description: 'Browser automation',
          html_url: 'https://github.com/microsoft/playwright',
          stargazers_count: 71000,
          language: 'TypeScript',
          pushed_at: '2026-05-06T00:00:00Z',
        }],
      }));
    }
    if (String(url).includes('github.com/trending')) {
      return response('<article class="Box-row"><h2><a href="/owner/repo">owner / repo</a></h2><p>Trending repo</p><span itemprop="programmingLanguage">Go</span><a href="/owner/repo/stargazers">1,234</a></article>');
    }
    if (String(url).includes('hn.algolia.com')) {
      return response(JSON.stringify({
        hits: [{
          objectID: '42',
          title: 'AI agent testing story',
          url: 'https://news.ycombinator.com/item?id=42',
          story_text: 'HN summary',
          created_at: '2026-05-07T00:00:00Z',
        }],
      }));
    }
    return response('<rss><channel><item><title>Release item</title><link>https://example.com/release</link><description>RSS summary</description></item></channel></rss>');
  };

  const items = await collectTrendIntel({
    TREND_INTEL_GITHUB_TOPICS: 'playwright',
    TREND_INTEL_GITHUB_PER_TOPIC: '1',
    TREND_INTEL_HN_QUERIES: 'AI agent',
    TREND_INTEL_HN_PER_QUERY: '1',
    TREND_INTEL_RSS_FEEDS: 'Releases|https://example.com/releases.atom',
    GITHUB_TOKEN: 'secret-token',
  }, fetchImpl, { now: new Date('2026-05-07T00:00:00.000Z') });

  assert(items.some((item) => item.kind === 'github-search' && item.topic === 'playwright'));
  assert(items.some((item) => item.kind === 'github-trending' && item.title === 'owner/repo'));
  assert(items.some((item) => item.kind === 'hacker-news' && item.title === 'AI agent testing story'));
  assert(items.some((item) => item.kind === 'rss' && item.source === 'Releases'));
  assert.equal(items.find((item) => item.link === 'https://github.com/microsoft/playwright').stars, 71000);
  assert.equal(calls.find((call) => call.url.includes('api.github.com')).init.headers.Authorization, 'Bearer secret-token');
});

test('collectTrendIntel keeps available sources when one source fails', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('github.com/trending')) {
      return response('rate limited', 429);
    }
    if (String(url).includes('api.github.com/search/repositories')) {
      return response(JSON.stringify({
        items: [{
          full_name: 'microsoft/playwright',
          description: 'Browser automation',
          html_url: 'https://github.com/microsoft/playwright',
          stargazers_count: 71000,
          language: 'TypeScript',
          pushed_at: '2026-05-06T00:00:00Z',
        }],
      }));
    }
    if (String(url).includes('hn.algolia.com')) {
      return response(JSON.stringify({ hits: [] }));
    }
    return response('<rss><channel><item><title>Release item</title><link>https://example.com/release</link></item></channel></rss>');
  };

  const items = await collectTrendIntel({
    TREND_INTEL_GITHUB_TOPICS: 'playwright',
    TREND_INTEL_GITHUB_PER_TOPIC: '1',
    TREND_INTEL_HN_QUERIES: 'AI agent',
    TREND_INTEL_HN_PER_QUERY: '1',
    TREND_INTEL_RSS_FEEDS: 'Releases|https://example.com/releases.atom',
  }, fetchImpl, { now: new Date('2026-05-07T00:00:00.000Z') });
  const report = buildTrendIntelReport(items, { generatedAt: '2026-05-07T00:00:00Z' });

  assert(items.some((item) => item.kind === 'github-search'));
  assert(items.some((item) => item.kind === 'rss'));
  assert.equal(items.errors.length, 1);
  assert.equal(items.errors[0].source, 'github-trending');
  assert.equal(report.errors.length, 1);
  assert.match(report.summary, /microsoft\/playwright/);
});

test('normalizeTrendItems deduplicates by link and buildTrendIntelReport summarizes items', () => {
  const items = normalizeTrendItems([
    { title: 'Same', link: 'https://example.com/same', source: 'A', kind: 'rss' },
    { title: 'Same again', link: 'https://example.com/same', source: 'B', kind: 'rss' },
    { title: '<b>Repo</b>', link: 'https://github.com/a/b', source: 'GitHub', kind: 'github-search', stars: 10 },
  ]);
  const report = buildTrendIntelReport(items, { generatedAt: '2026-05-07T00:00:00Z' });

  assert.equal(items.length, 2);
  assert.equal(items[1].title, 'Repo');
  assert.equal(report.total, 2);
  assert.equal(report.generatedAt, '2026-05-07T00:00:00Z');
  assert.match(report.summary, /Same/);
  assert.match(report.summary, /10 stars/);
});

test('writeTrendIntelReport writes formatted json and creates parent directory', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'trend-intel-'));
  try {
    const file = join(tempDir, 'nested', 'latest.json');
    writeTrendIntelReport(file, { total: 1, items: [{ title: 'A' }] });

    assert.equal(existsSync(file), true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { total: 1, items: [{ title: 'A' }] });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
