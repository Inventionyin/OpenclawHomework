const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWebContentSummary,
  extractHtmlContent,
  isAllowedFetchUrl,
  normalizeFetchRequest,
  runWebContentFetch,
} = require('../scripts/web-content-fetcher');

test('extractHtmlContent returns title text and links from modern pages', () => {
  const result = extractHtmlContent(`
    <html>
      <head><title>AI 测试平台</title><script>ignore()</script></head>
      <body>
        <nav>菜单</nav>
        <main>
          <h1>免费 API token 活动</h1>
          <p>今天开放申请，适合软件测试和 AI Agent 学习。</p>
          <a href="/apply">立即申请</a>
        </main>
      </body>
    </html>
  `, 'https://example.com/news');

  assert.equal(result.title, 'AI 测试平台');
  assert.match(result.text, /免费 API token 活动/);
  assert.doesNotMatch(result.text, /ignore/);
  assert.deepEqual(result.links, [{ text: '立即申请', href: 'https://example.com/apply' }]);
});

test('isAllowedFetchUrl blocks private hosts unless explicitly allowed', () => {
  assert.equal(isAllowedFetchUrl('http://127.0.0.1/admin'), false);
  assert.equal(isAllowedFetchUrl('http://10.0.0.1/admin'), false);
  assert.equal(isAllowedFetchUrl('https://github.com/microsoft/rd-agent'), true);
  assert.equal(isAllowedFetchUrl('https://evanshine.me'), true);
  assert.equal(isAllowedFetchUrl('https://unknown.example'), false);
  assert.equal(isAllowedFetchUrl('https://unknown.example', { allowDomains: ['unknown.example'] }), true);
});

test('runWebContentFetch uses injected fetcher and returns structured summary', async () => {
  const result = await runWebContentFetch({
    url: 'https://github.com/skill-flow/skflow',
    fetcher: async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      text: '<title>skflow</title><main><p>Markdown skill workflow runner for agents.</p></main>',
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.status, 200);
  assert.equal(result.title, 'skflow');
  assert.match(result.summary, /Markdown skill workflow/);
  assert.equal(result.source, 'web-content-fetcher');
});

test('runWebContentFetch returns blocked result for unsafe urls', async () => {
  const result = await runWebContentFetch({ url: 'http://127.0.0.1:8788/health' });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /not allowed|private/i);
});

test('buildWebContentSummary keeps output compact', () => {
  const summary = buildWebContentSummary({
    title: 'Long title',
    text: 'A'.repeat(2000),
    links: [],
  }, { maxChars: 120 });

  assert.equal(summary.length <= 123, true);
  assert.match(summary, /^Long title/);
});

test('normalizeFetchRequest accepts raw text url', () => {
  const request = normalizeFetchRequest('抓一下 https://github.com/D4Vinci/Scrapling 的正文');

  assert.equal(request.url, 'https://github.com/D4Vinci/Scrapling');
});
