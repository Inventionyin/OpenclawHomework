const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildWorldNewsDigest,
  defaultWorldNewsOnCalendar,
  formatWorldNewsMessage,
  normalizeWorldNewsItems,
  parseFeedItems,
  parseWorldFeedConfig,
  runWorldNewsMonitor,
} = require('../scripts/world-news-monitor');

test('defaultWorldNewsOnCalendar uses three daily precise news slots', () => {
  assert.equal(defaultWorldNewsOnCalendar(), '*-*-* 09:10:00,15:10:00,21:10:00');
});

test('parseWorldFeedConfig uses global news defaults and custom feeds', () => {
  const defaults = parseWorldFeedConfig('');
  assert(defaults.some((feed) => feed.source === 'BBC World'));
  assert(defaults.some((feed) => feed.source === 'NPR World'));
  assert.deepEqual(parseWorldFeedConfig('Reuters World|https://example.com/rss')[0], {
    source: 'Reuters World',
    url: 'https://example.com/rss',
  });
});

test('parseFeedItems extracts precise title link summary and published time', () => {
  const items = parseFeedItems(`
    <rss><channel>
      <item>
        <title><![CDATA[World leaders meet on security]]></title>
        <link>https://example.com/world</link>
        <description>Security talks continue in Europe.</description>
        <pubDate>Sun, 10 May 2026 08:30:00 GMT</pubDate>
      </item>
    </channel></rss>
  `, 'Example World');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'World leaders meet on security');
  assert.equal(items[0].link, 'https://example.com/world');
  assert.equal(items[0].summary, 'Security talks continue in Europe.');
  assert.equal(items[0].publishedAt, 'Sun, 10 May 2026 08:30:00 GMT');
  assert.equal(items[0].source, 'Example World');
});

test('normalizeWorldNewsItems deduplicates and classifies global news separately from benefits', () => {
  const items = normalizeWorldNewsItems([
    {
      title: 'Markets react to new central bank decision',
      link: 'https://example.com/markets?utm=1',
      summary: 'Global investors watch policy shifts.',
      source: 'Example',
      publishedAt: 'Sun, 10 May 2026 08:30:00 GMT',
    },
    {
      title: 'Markets react to new central bank decision',
      link: 'https://example.com/markets?utm=2',
      summary: 'Duplicate story.',
      source: 'Example Copy',
      publishedAt: 'Sun, 10 May 2026 08:31:00 GMT',
    },
    {
      title: 'Free cloud credits for developers',
      link: 'https://example.com/free',
      summary: 'Benefit item should not look like world news.',
      source: 'Benefit',
    },
  ], { now: new Date('2026-05-10T12:00:00.000Z') });

  assert.equal(items.length, 2);
  assert.equal(items[0].category, '财经与产业');
  assert.equal(items[0].publishedDate, '2026-05-10');
  assert.equal(items[1].category, '其他观察');
});

test('normalizeWorldNewsItems does not classify incidental ai letters inside ordinary words as AI news', () => {
  const items = normalizeWorldNewsItems([
    {
      title: 'Tenerife medics poised to receive virus-hit cruise ship passengers',
      link: 'https://example.com/virus-cruise',
      summary: "BBC's Sarah Rainsford reports from the port after a deadly hantavirus outbreak.",
      source: 'BBC World',
      publishedAt: 'Sun, 10 May 2026 05:09:52 GMT',
    },
  ], { now: new Date('2026-05-10T12:00:00.000Z') });

  assert.equal(items[0].category, '社会与文化');
});

test('buildWorldNewsDigest creates precise category counts and top picks', () => {
  const digest = buildWorldNewsDigest([
    {
      title: 'Election talks reshape regional security',
      link: 'https://example.com/politics',
      source: 'BBC World',
      summary: 'Diplomats discuss border security.',
      publishedAt: 'Sun, 10 May 2026 08:30:00 GMT',
    },
    {
      title: 'New AI chip export rule affects tech firms',
      link: 'https://example.com/ai-chip',
      source: 'NPR World',
      summary: 'Companies prepare compliance updates.',
      publishedAt: 'Sun, 10 May 2026 09:00:00 GMT',
    },
  ], { now: new Date('2026-05-10T12:00:00.000Z') });

  assert.equal(digest.total, 2);
  assert.equal(digest.categories['全球局势'], 1);
  assert.equal(digest.categories['科技与AI'], 1);
  assert.equal(digest.top.length, 2);
  assert.match(digest.text, /BBC World/);
  assert.match(digest.text, /为什么值得看/);
});

test('formatWorldNewsMessage keeps world news separate from benefits', () => {
  const message = formatWorldNewsMessage({
    total: 1,
    categories: { 全球局势: 1 },
    top: [{
      title: 'Regional security talks continue',
      titleZh: '地区安全谈判继续',
      source: 'BBC World',
      category: '全球局势',
      publishedDate: '2026-05-10',
      why: '影响国际关系和市场预期。',
      summary: 'Leaders meet for talks.',
      link: 'https://example.com/security',
    }],
  }, { assistantName: 'Hermes' });

  assert.match(message, /Hermes 全球新闻雷达/);
  assert.match(message, /全球局势/);
  assert.doesNotMatch(message, /福利\/免费活动|token|服务器福利/);
  assert.match(message, /来源：BBC World/);
  assert.match(message, /时间：2026-05-10/);
});

test('runWorldNewsMonitor writes output task record and sends Feishu message', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'world-news-monitor-'));
  const sent = [];
  try {
    const result = await runWorldNewsMonitor({
      outputFile: join(tempDir, 'world-news-latest.json'),
      dryRun: false,
    }, {
      now: new Date('2026-05-10T12:00:00.000Z'),
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
        WORLD_NEWS_FEISHU_RECEIVE_ID: 'chat-a',
        WORLD_NEWS_FEISHU_RECEIVE_ID_TYPE: 'chat_id',
      },
      collectItems: async () => [
        {
          title: 'World leaders meet on security',
          link: 'https://example.com/world',
          summary: 'Security talks continue.',
          source: 'BBC World',
          publishedAt: 'Sun, 10 May 2026 08:30:00 GMT',
        },
      ],
      sendFeishuTextMessage: async (env, message) => {
        sent.push({ env, message });
        return { ok: true };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.total, 1);
    assert.equal(sent.length, 1);
    assert.match(JSON.parse(sent[0].message.content).text, /全球新闻雷达/);
    const output = JSON.parse(readFileSync(result.outputFile, 'utf8'));
    assert.equal(output.total, 1);
    assert.equal(output.top[0].source, 'BBC World');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
