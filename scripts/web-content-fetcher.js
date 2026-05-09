const DEFAULT_ALLOWED_DOMAINS = [
  'github.com',
  'raw.githubusercontent.com',
  'github.blog',
  'news.ycombinator.com',
  'producthunt.com',
  'huggingface.co',
  'cloudflare.com',
  'evanshine.me',
  'openclaw.evanshine.me',
  'hermes.evanshine.me',
];

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html = '') {
  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return stripHtml(titleMatch[1]).slice(0, 180);
  }
  const h1Match = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1Match ? stripHtml(h1Match[1]).slice(0, 180) : '';
}

function extractMainHtml(html = '') {
  const text = String(html || '');
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : text;
}

function resolveHref(href = '', baseUrl = '') {
  try {
    return new URL(String(href || '').trim(), baseUrl || undefined).toString();
  } catch {
    return String(href || '').trim();
  }
}

function extractLinks(html = '', baseUrl = '', limit = 20) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) && links.length < limit) {
    const text = stripHtml(match[2]).slice(0, 120);
    const href = resolveHref(match[1], baseUrl);
    if (href && !href.startsWith('javascript:')) {
      links.push({ text, href });
    }
  }
  return links;
}

function extractHtmlContent(html = '', url = '') {
  const mainHtml = extractMainHtml(html);
  return {
    title: extractTitle(html),
    text: stripHtml(mainHtml),
    links: extractLinks(mainHtml, url),
  };
}

function isPrivateHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1'
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function normalizeAllowedDomains(options = {}) {
  const extra = Array.isArray(options.allowDomains)
    ? options.allowDomains
    : String(options.allowDomains || '')
      .split(/[,;\s]+/)
      .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_DOMAINS, ...extra].map((item) => String(item).toLowerCase()));
}

function isAllowedFetchUrl(urlValue = '', options = {}) {
  let parsed;
  try {
    parsed = new URL(String(urlValue || '').trim());
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }
  if (isPrivateHost(parsed.hostname) && !options.allowPrivate) {
    return false;
  }
  const allowed = normalizeAllowedDomains(options);
  const host = parsed.hostname.toLowerCase();
  return [...allowed].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function normalizeFetchRequest(input = {}) {
  const raw = typeof input === 'string' ? { text: input } : { ...input };
  const text = String(raw.text || raw.url || '').trim();
  const urlMatch = text.match(/https?:\/\/[^\s，。！？)）]+/i);
  return {
    ...raw,
    url: raw.url || (urlMatch ? urlMatch[0] : ''),
    text,
  };
}

function buildWebContentSummary(content = {}, options = {}) {
  const maxChars = Math.max(40, Number(options.maxChars || 600));
  const prefix = content.title ? `${content.title}\n` : '';
  const text = `${prefix}${String(content.text || '').replace(/\s+/g, ' ').trim()}`.trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function headersToObject(headers = {}) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

async function defaultFetcher(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'user-agent': options.userAgent || 'OpenclawHomework-WebContentFetcher/1.0',
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
    signal: options.signal,
  });
  return {
    status: response.status,
    headers: headersToObject(response.headers),
    text: await response.text(),
  };
}

async function runWebContentFetch(input = {}) {
  const request = normalizeFetchRequest(input);
  const allowOptions = {
    allowDomains: input.allowDomains || input.env?.WEB_FETCH_ALLOW_DOMAINS,
    allowPrivate: input.allowPrivate || String(input.env?.WEB_FETCH_ALLOW_PRIVATE || '').toLowerCase() === 'true',
  };
  if (!isAllowedFetchUrl(request.url, allowOptions)) {
    return {
      source: 'web-content-fetcher',
      allowed: false,
      url: request.url,
      reason: 'URL is not allowed or points to a private host.',
    };
  }
  const fetcher = input.fetcher || defaultFetcher;
  const raw = await fetcher(request.url, input);
  const content = extractHtmlContent(raw.text || '', request.url);
  return {
    source: 'web-content-fetcher',
    allowed: true,
    url: request.url,
    status: raw.status || 0,
    contentType: headersToObject(raw.headers)['content-type'] || headersToObject(raw.headers)['Content-Type'] || '',
    title: content.title,
    text: content.text,
    links: content.links,
    summary: buildWebContentSummary(content, { maxChars: input.maxSummaryChars || 600 }),
  };
}

module.exports = {
  DEFAULT_ALLOWED_DOMAINS,
  buildWebContentSummary,
  extractHtmlContent,
  isAllowedFetchUrl,
  normalizeFetchRequest,
  runWebContentFetch,
};
