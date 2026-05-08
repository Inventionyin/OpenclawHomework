function toBool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildDifyChatMessagesUrl(value) {
  const url = normalizeUrl(value);
  if (!url) {
    return '';
  }
  if (/\/v1\/chat-messages$/i.test(url)) {
    return url;
  }
  return `${url}/v1/chat-messages`;
}

function toTimeoutMs(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function redactApiKey(text, apiKey) {
  const source = String(text || '');
  const key = String(apiKey || '').trim();
  if (!key) {
    return source;
  }
  return source.split(key).join('[REDACTED]');
}

function buildDifyTestingAssistantConfig(env = process.env) {
  return {
    enabled: toBool(env.DIFY_TESTING_ASSISTANT_ENABLED),
    url: normalizeUrl(env.DIFY_TESTING_ASSISTANT_URL),
    apiKey: String(env.DIFY_TESTING_ASSISTANT_API_KEY || '').trim(),
    timeoutMs: toTimeoutMs(env.DIFY_TESTING_ASSISTANT_TIMEOUT_MS, 15000),
    responseMode: String(env.DIFY_TESTING_ASSISTANT_RESPONSE_MODE || 'blocking').trim() || 'blocking',
  };
}

function sanitizedConfig(config) {
  return {
    enabled: config.enabled,
    url: config.url,
    apiKey: config.apiKey ? '[REDACTED]' : '',
    timeoutMs: config.timeoutMs,
    responseMode: config.responseMode,
  };
}

function buildFallback(reason, config, message = '') {
  return {
    ok: false,
    mode: 'fallback',
    reason,
    message,
    config: sanitizedConfig(config),
  };
}

function pickAnswer(body) {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const candidates = [body.answer, body.text, body.data?.answer];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return '';
}

async function askDifyTestingAssistant(query, options = {}) {
  const config = {
    ...buildDifyTestingAssistantConfig(options.env || process.env),
    ...Object.fromEntries(Object.entries(options).filter(([key]) => [
      'enabled',
      'url',
      'apiKey',
      'timeoutMs',
      'responseMode',
    ].includes(key))),
  };
  config.url = normalizeUrl(config.url);
  config.timeoutMs = toTimeoutMs(config.timeoutMs, 15000);

  if (!config.enabled) {
    return buildFallback('disabled', config, 'Dify testing assistant is disabled.');
  }
  if (!config.url || !config.apiKey) {
    return buildFallback('unconfigured', config, 'Dify testing assistant is not configured.');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(buildDifyChatMessagesUrl(config.url), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {},
        query: String(query || ''),
        response_mode: config.responseMode,
        user: 'hermes-agent',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const raw = `Dify testing assistant request failed: ${response.status} ${response.statusText} ${bodyText}`.trim();
      return buildFallback('error', config, redactApiKey(raw, config.apiKey));
    }

    const body = await response.json();
    const answer = pickAnswer(body);
    if (!answer) {
      return buildFallback('error', config, 'Dify testing assistant returned no answer field.');
    }

    return {
      ok: true,
      mode: 'remote',
      answer: redactApiKey(answer, config.apiKey),
      config: sanitizedConfig(config),
    };
  } catch (error) {
    const raw = `Dify testing assistant error: ${error?.message || String(error)}`;
    return buildFallback('error', config, redactApiKey(raw, config.apiKey));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  askDifyTestingAssistant,
  buildDifyChatMessagesUrl,
  buildDifyTestingAssistantConfig,
  redactApiKey,
};
