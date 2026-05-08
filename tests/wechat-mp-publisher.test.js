const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildWechatArticleDraft,
  publishWechatMpArticle,
} = require('../scripts/wechat-mp-publisher');

test('buildWechatArticleDraft creates safe article html from an idea', () => {
  const draft = buildWechatArticleDraft('推荐今天能用的 API 中转站和白嫖福利', {
    now: new Date('2026-05-09T08:00:00.000Z'),
    author: 'Hermes',
    thumbMediaId: 'media-1',
  });

  assert.equal(draft.title, '今日 API 中转站和白嫖福利观察');
  assert.equal(draft.author, 'Hermes');
  assert.equal(draft.thumb_media_id, 'media-1');
  assert.match(draft.digest, /API 中转站/);
  assert.match(draft.content, /风险提示/);
  assert.match(draft.content, /2026-05-09/);
});

test('publishWechatMpArticle can add draft without publishing', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-mp-publisher-'));
  const calls = [];
  try {
    const result = await publishWechatMpArticle({
      mode: 'draft',
      idea: '推荐今天能用的 API 中转站',
    }, {
      env: {
        WECHAT_MP_APP_ID: 'wx-app',
        WECHAT_MP_APP_SECRET: 'secret',
        WECHAT_MP_DEFAULT_THUMB_MEDIA_ID: 'thumb-1',
        WECHAT_MP_TOKEN_CACHE_FILE: join(tempDir, 'token.json'),
      },
      fetch: async (url, options = {}) => {
        calls.push({ url, options });
        if (String(url).includes('/cgi-bin/token')) {
          return { ok: true, text: async () => JSON.stringify({ access_token: 'access-1', expires_in: 7200 }) };
        }
        if (String(url).includes('/cgi-bin/draft/add')) {
          const body = JSON.parse(options.body);
          assert.equal(body.articles[0].thumb_media_id, 'thumb-1');
          assert.match(body.articles[0].content, /API 中转站/);
          return { ok: true, text: async () => JSON.stringify({ media_id: 'draft-media-1' }) };
        }
        throw new Error(`unexpected url ${url}`);
      },
      now: new Date('2026-05-09T08:00:00.000Z'),
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'draft');
    assert.equal(result.mediaId, 'draft-media-1');
    assert.equal(calls.length, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('publishWechatMpArticle submits draft when direct publish is requested', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-mp-publisher-'));
  const calls = [];
  try {
    const result = await publishWechatMpArticle({
      mode: 'direct',
      idea: '直接发布今天白嫖福利',
    }, {
      env: {
        WECHAT_MP_APP_ID: 'wx-app',
        WECHAT_MP_APP_SECRET: 'secret',
        WECHAT_MP_DEFAULT_THUMB_MEDIA_ID: 'thumb-1',
        WECHAT_MP_TOKEN_CACHE_FILE: join(tempDir, 'token.json'),
      },
      fetch: async (url, options = {}) => {
        calls.push({ url, options });
        if (String(url).includes('/cgi-bin/token')) {
          return { ok: true, text: async () => JSON.stringify({ access_token: 'access-1', expires_in: 7200 }) };
        }
        if (String(url).includes('/cgi-bin/draft/add')) {
          return { ok: true, text: async () => JSON.stringify({ media_id: 'draft-media-2' }) };
        }
        if (String(url).includes('/cgi-bin/freepublish/submit')) {
          assert.deepEqual(JSON.parse(options.body), { media_id: 'draft-media-2' });
          return { ok: true, text: async () => JSON.stringify({ publish_id: 'publish-1' }) };
        }
        throw new Error(`unexpected url ${url}`);
      },
      now: new Date('2026-05-09T08:00:00.000Z'),
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'direct');
    assert.equal(result.mediaId, 'draft-media-2');
    assert.equal(result.publishId, 'publish-1');
    assert.equal(calls.length, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('publishWechatMpArticle can publish latest draft media id', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-mp-publisher-'));
  const calls = [];
  try {
    const result = await publishWechatMpArticle({
      mode: 'publish-latest',
    }, {
      env: {
        WECHAT_MP_APP_ID: 'wx-app',
        WECHAT_MP_APP_SECRET: 'secret',
        WECHAT_MP_LATEST_DRAFT_MEDIA_ID: 'draft-media-latest',
        WECHAT_MP_TOKEN_CACHE_FILE: join(tempDir, 'token.json'),
      },
      fetch: async (url, options = {}) => {
        calls.push({ url, options });
        if (String(url).includes('/cgi-bin/token')) {
          return { ok: true, text: async () => JSON.stringify({ access_token: 'access-1', expires_in: 7200 }) };
        }
        if (String(url).includes('/cgi-bin/freepublish/submit')) {
          assert.deepEqual(JSON.parse(options.body), { media_id: 'draft-media-latest' });
          return { ok: true, text: async () => JSON.stringify({ publish_id: 'publish-latest' }) };
        }
        throw new Error(`unexpected url ${url}`);
      },
      now: new Date('2026-05-09T08:00:00.000Z'),
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'publish-latest');
    assert.equal(result.mediaId, 'draft-media-latest');
    assert.equal(result.publishId, 'publish-latest');
    assert.equal(calls.length, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
