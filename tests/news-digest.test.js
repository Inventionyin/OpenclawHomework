const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildGitHubSearchUrl,
  buildNewsReport,
  collectNewsDigest,
  fetchGitHubTrending,
  fetchRssItems,
  normalizeNewsItems,
  parseFeedConfig,
  parseFeedItems,
  parseGitHubTopics,
  runNewsDigest,
} = require('../scripts/news-digest');
const {
  listTasks,
} = require('../scripts/background-task-store');

test('parseFeedItems supports rss and atom entries', () => {
  const rss = `
    <rss><channel>
      <item><title><![CDATA[Playwright 1.2 released]]></title><link>https://example.com/a</link><description>New browser testing</description></item>
    </channel></rss>
    <feed>
      <entry><title>GitHub Actions update</title><link href="https://example.com/b"/><summary>CI news</summary></entry>
    </feed>
  `;

  const items = parseFeedItems(rss, 'Test Feed');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Playwright 1.2 released');
  assert.equal(items[0].link, 'https://example.com/a');
  assert.equal(items[1].link, 'https://example.com/b');
});

test('parseFeedConfig and parseGitHubTopics use defaults and custom values', () => {
  assert(parseFeedConfig('').some((item) => item.source === 'GitHub Blog'));
  assert.deepEqual(parseFeedConfig('QA|https://example.com/rss')[0], {
    source: 'QA',
    url: 'https://example.com/rss',
  });
  assert(parseGitHubTopics('').includes('playwright'));
  assert.deepEqual(parseGitHubTopics('ai-agent,testing'), ['ai-agent', 'testing']);
});

test('buildGitHubSearchUrl searches recent pushed topic repositories', () => {
  const url = buildGitHubSearchUrl('playwright', {
    days: 7,
    now: new Date('2026-05-06T00:00:00.000Z'),
  });
  assert.match(url, /topic%3Aplaywright/);
  assert.match(url, /pushed%3A%3E%3D2026-04-29/);
  assert.match(url, /sort=stars/);
});

test('fetchRssItems and fetchGitHubTrending collect normalized items', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('api.github.com')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          items: [
            {
              full_name: 'microsoft/playwright',
              description: 'Browser automation',
              html_url: 'https://github.com/microsoft/playwright',
              stargazers_count: 70000,
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      text: async () => '<rss><channel><item><title>Testing news</title><link>https://example.com/news</link></item></channel></rss>',
    };
  };

  const rss = await fetchRssItems({ PROACTIVE_DIGEST_RSS_FEEDS: 'QA|https://example.com/rss' }, fetchImpl);
  const github = await fetchGitHubTrending({ PROACTIVE_DIGEST_GITHUB_TOPICS: 'playwright' }, fetchImpl);
  assert.equal(rss[0].title, 'Testing news');
  assert.equal(github[0].title, 'microsoft/playwright：Browser automation');
  assert.equal(github[0].stars, 70000);
  assert(calls.length >= 2);
});

test('collectNewsDigest deduplicates and builds report text', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    text: async () => (url.includes('api.github.com')
      ? JSON.stringify({ items: [] })
      : '<rss><channel><item><title>Same</title><link>https://example.com/same</link></item><item><title>Same</title><link>https://example.com/same</link></item></channel></rss>'),
  });
  const report = await collectNewsDigest({
    PROACTIVE_DIGEST_RSS_FEEDS: 'QA|https://example.com/rss',
    PROACTIVE_DIGEST_GITHUB_TRENDING_ENABLED: 'false',
  }, fetchImpl);

  assert.equal(report.total, 1);
  assert.match(report.text, /Same/);
  assert.equal(normalizeNewsItems([{ title: '<b>A</b>' }])[0].title, 'A');
  assert.equal(buildNewsReport([]).text, '暂无新闻条目。');
});

test('runNewsDigest records lifecycle into task center with safe summary', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'news-digest-task-'));
  try {
    const result = await runNewsDigest({
      day: '2026-05-06',
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
      },
      fetchImpl: async (url) => ({
        ok: true,
        text: async () => (url.includes('api.github.com')
          ? JSON.stringify({ items: [] })
          : '<rss><channel><item><title>Daily News</title><link>https://example.com/daily</link></item></channel></rss>'),
      }),
    });

    assert.equal(result.report.total, 1);
    const tasks = listTasks(result.env);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'news-digest');
    assert.equal(tasks[0].status, 'completed');
    assert.equal(tasks[0].summary.totalItems, 1);
    assert(tasks[0].events.some((event) => event.event === 'scheduled'));
    assert(tasks[0].events.some((event) => event.event === 'completed'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
