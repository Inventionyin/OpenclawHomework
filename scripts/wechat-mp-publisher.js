const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const WECHAT_API_BASE = 'https://api.weixin.qq.com';

function parseJson(text = '', context = 'wechat api') {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`${context} returned invalid json`);
  }
}

function assertWechatOk(data = {}, context = 'wechat api') {
  if (data.errcode && Number(data.errcode) !== 0) {
    throw new Error(`${context} failed: ${data.errcode} ${data.errmsg || ''}`.trim());
  }
  return data;
}

function getCacheFile(env = process.env) {
  return env.WECHAT_MP_TOKEN_CACHE_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'wechat-mp', 'access-token.json');
}

function getLatestDraftFile(env = process.env) {
  return env.WECHAT_MP_LATEST_DRAFT_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'wechat-mp', 'latest-draft.json');
}

function readTokenCache(env = process.env, now = new Date()) {
  const file = getCacheFile(env);
  if (!existsSync(file)) return null;
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.accessToken && Number(cache.expiresAt || 0) > now.getTime() + 60000) {
      return cache.accessToken;
    }
  } catch {
    return null;
  }
  return null;
}

function writeTokenCache(env = process.env, accessToken = '', expiresIn = 7200, now = new Date()) {
  const file = getCacheFile(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    accessToken,
    expiresAt: now.getTime() + Math.max(60, Number(expiresIn || 7200) - 300) * 1000,
    updatedAt: now.toISOString(),
  }, null, 2)}\n`, 'utf8');
}

function readLatestDraftMediaId(env = process.env) {
  if (env.WECHAT_MP_LATEST_DRAFT_MEDIA_ID) {
    return env.WECHAT_MP_LATEST_DRAFT_MEDIA_ID;
  }
  const file = getLatestDraftFile(env);
  if (!existsSync(file)) return '';
  try {
    return JSON.parse(readFileSync(file, 'utf8')).mediaId || '';
  } catch {
    return '';
  }
}

function writeLatestDraftMediaId(env = process.env, mediaId = '', title = '', now = new Date()) {
  const file = getLatestDraftFile(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    mediaId,
    title,
    updatedAt: now.toISOString(),
  }, null, 2)}\n`, 'utf8');
}

async function getWechatAccessToken(env = process.env, options = {}) {
  const now = options.now || new Date();
  const cached = readTokenCache(env, now);
  if (cached) return cached;
  const appId = env.WECHAT_MP_APP_ID;
  const appSecret = env.WECHAT_MP_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('missing WECHAT_MP_APP_ID or WECHAT_MP_APP_SECRET');
  }
  const fetchImpl = options.fetch || fetch;
  const url = `${WECHAT_API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetchImpl(url);
  const data = assertWechatOk(parseJson(await response.text(), 'wechat token'), 'wechat token');
  if (!data.access_token) {
    throw new Error('wechat token failed: missing access_token');
  }
  writeTokenCache(env, data.access_token, data.expires_in, now);
  return data.access_token;
}

function htmlEscape(value = '') {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function normalizeIdea(idea = '') {
  return String(idea || '').replace(/^公众号(?:草稿|直接发布|发布)?[:：\s]*/i, '').trim();
}

function buildWechatArticleTitle(idea = '') {
  const text = normalizeIdea(idea);
  if (/(api|中转站|白嫖|福利|额度|token)/i.test(text)) {
    return '今日 API 中转站和白嫖福利观察';
  }
  if (/(github|开源|热榜|项目)/i.test(text)) {
    return '今日开源学习雷达';
  }
  if (/(测试|自动化|agent|智能体)/i.test(text)) {
    return '测试工程师的 AI Agent 实验日报';
  }
  return text ? text.slice(0, 64) : 'Hermes 自动化观察';
}

function buildWechatArticleDraft(idea = '', options = {}) {
  const now = options.now || new Date();
  const day = now.toISOString().slice(0, 10);
  const normalizedIdea = normalizeIdea(idea) || 'AI 工具、API 中转站、免费额度和测试工程实践';
  const title = options.title || buildWechatArticleTitle(normalizedIdea);
  const author = options.author || 'Hermes';
  const thumbMediaId = options.thumbMediaId || options.env?.WECHAT_MP_DEFAULT_THUMB_MEDIA_ID || '';
  const digest = `围绕${normalizedIdea}整理的一份自动化观察，适合学生、测试工程师和 Agent 玩家快速筛选。`.slice(0, 120);
  const safeIdea = htmlEscape(normalizedIdea);
  const content = [
    `<h2>${htmlEscape(title)}</h2>`,
    `<p><strong>日期：</strong>${day}</p>`,
    `<p><strong>主题：</strong>${safeIdea}</p>`,
    '<h3>一、今天值得先看的方向</h3>',
    '<ul>',
    '<li>API 中转站：优先记录模型覆盖、调用稳定性、价格和是否适合临时实验。</li>',
    '<li>白嫖福利：优先看免费 token、云服务器、GPU/算力、学生额度和限时体验。</li>',
    '<li>测试工程：把可复用的 UI 自动化、客服训练数据、报告归档玩法沉淀下来。</li>',
    '</ul>',
    '<h3>二、推荐判断标准</h3>',
    '<ol>',
    '<li>来源清楚，有官网、文档、帖子或可验证入口。</li>',
    '<li>活动未过期，领取条件明确。</li>',
    '<li>不要把重要密钥、生产数据、真实隐私放到不可信中转站。</li>',
    '</ol>',
    '<h3>三、Hermes 后续动作</h3>',
    '<p>可以继续让 Hermes 抓热点、核验链接、生成测试工程师学习清单，并把有价值的内容写入日报或公众号草稿。</p>',
    '<h3>风险提示</h3>',
    '<p>API 中转站和免费活动可能随时失效。本文只做信息整理，不保证长期可用；涉及账号、密钥和支付前请自行核验。</p>',
  ].join('\n');
  return {
    title,
    author,
    digest,
    content,
    thumb_media_id: thumbMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

async function addWechatDraft(article, env = process.env, options = {}) {
  if (!article.thumb_media_id) {
    throw new Error('missing WECHAT_MP_DEFAULT_THUMB_MEDIA_ID; create or upload a permanent thumb media first');
  }
  const fetchImpl = options.fetch || fetch;
  const token = await getWechatAccessToken(env, options);
  const response = await fetchImpl(`${WECHAT_API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: [article] }),
  });
  const data = assertWechatOk(parseJson(await response.text(), 'wechat draft'), 'wechat draft');
  if (!data.media_id) {
    throw new Error('wechat draft failed: missing media_id');
  }
  return data.media_id;
}

async function submitWechatPublish(mediaId, env = process.env, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const token = await getWechatAccessToken(env, options);
  const response = await fetchImpl(`${WECHAT_API_BASE}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const data = assertWechatOk(parseJson(await response.text(), 'wechat publish'), 'wechat publish');
  return data.publish_id || '';
}

async function publishWechatMpArticle(request = {}, options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const mode = request.mode || 'draft';
  if (mode === 'publish-latest') {
    const latestMediaId = readLatestDraftMediaId(env);
    if (!latestMediaId) {
      throw new Error('missing latest draft media_id; create a draft first');
    }
    const publishId = await submitWechatPublish(latestMediaId, env, options);
    return {
      ok: true,
      mode,
      title: '最近公众号草稿',
      mediaId: latestMediaId,
      publishId,
    };
  }
  const article = buildWechatArticleDraft(request.idea || '', {
    env,
    now,
    author: env.WECHAT_MP_ARTICLE_AUTHOR || 'Hermes',
    thumbMediaId: request.thumbMediaId || env.WECHAT_MP_DEFAULT_THUMB_MEDIA_ID || '',
  });
  const mediaId = await addWechatDraft(article, env, options);
  writeLatestDraftMediaId(env, mediaId, article.title, now);
  let publishId = '';
  if (mode === 'direct' || mode === 'publish') {
    publishId = await submitWechatPublish(mediaId, env, options);
  }
  return {
    ok: true,
    mode,
    title: article.title,
    mediaId,
    publishId,
  };
}

module.exports = {
  addWechatDraft,
  buildWechatArticleDraft,
  buildWechatArticleTitle,
  getWechatAccessToken,
  readLatestDraftMediaId,
  publishWechatMpArticle,
  submitWechatPublish,
  writeLatestDraftMediaId,
};
