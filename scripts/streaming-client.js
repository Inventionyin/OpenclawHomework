function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function splitList(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildStreamingChatConfig(env = process.env) {
  const apiKey = String(env.STREAMING_MODEL_API_KEY || env.OPENAI_API_KEY || env.XFYUN_API_KEY || '').trim();
  const apiKeys = splitList(env.STREAMING_MODEL_API_KEYS || env.LONGCAT_API_KEYS || '')
    .concat(apiKey ? [apiKey] : [])
    .filter((key, index, keys) => keys.indexOf(key) === index);

  return {
    baseUrl: normalizeBaseUrl(env.STREAMING_MODEL_BASE_URL || env.OPENAI_BASE_URL || env.XFYUN_BASE_URL || ''),
    apiKey,
    apiKeys,
    model: String(env.STREAMING_MODEL_ID || env.OPENAI_MODEL || env.XFYUN_MODEL || '').trim(),
    simpleModel: String(env.STREAMING_MODEL_SIMPLE_ID || env.LONGCAT_SIMPLE_MODEL || '').trim(),
    thinkingModel: String(env.STREAMING_MODEL_THINKING_ID || env.LONGCAT_THINKING_MODEL || '').trim(),
    endpointMode: String(env.STREAMING_MODEL_ENDPOINT_MODE || 'auto').trim().toLowerCase(),
  };
}

function classifyStreamingPrompt(prompt, forcedTier = '') {
  const tier = String(forcedTier || '').trim().toLowerCase();
  if (['simple', 'chat', 'thinking'].includes(tier)) {
    return tier;
  }

  const text = String(prompt || '').toLowerCase();
  if (/(复杂|深入|分析|排查|修复|方案|规划|为什么|原因|架构|设计|debug|debugging|root cause|troubleshoot|plan)/i.test(text)) {
    return 'thinking';
  }

  if (/(内存|硬盘|磁盘|状态|帮助|你会做什么|能做什么|你好|hello|hi|在吗|ping|status|memory|disk|help)/i.test(text)
    || text.length <= 80) {
    return 'simple';
  }

  return 'chat';
}

function resolveStreamingModelProfile(prompt, config = {}, options = {}) {
  const tier = classifyStreamingPrompt(prompt, options.modelTier || options.tier);
  const model = tier === 'simple'
    ? config.simpleModel || config.model
    : tier === 'thinking'
      ? config.thinkingModel || config.model
      : config.model;
  const apiKeys = Array.isArray(config.apiKeys) && config.apiKeys.length
    ? config.apiKeys
    : [config.apiKey].filter(Boolean);
  const index = Math.max(0, Number(options.apiKeyIndex || 0)) % Math.max(1, apiKeys.length);

  return {
    ...config,
    apiKey: apiKeys[index] || config.apiKey || '',
    apiKeyIndex: index,
    model,
    tier,
  };
}

function parseResponsesSseEvent(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  if (event.type === 'response.output_text.delta') {
    return String(event.delta || '');
  }
  if (event.type === 'response.text.delta') {
    return String(event.delta || '');
  }
  return '';
}

function parseChatCompletionSseEvent(event) {
  return String(event?.choices?.[0]?.delta?.content || '');
}

function parseStreamingUsageEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  if (event.usage && typeof event.usage === 'object') {
    return event.usage;
  }
  if (event.type === 'response.completed' && event.response?.usage && typeof event.response.usage === 'object') {
    return event.response.usage;
  }
  return null;
}

function isEventStreamResponse(response) {
  return /text\/event-stream/i.test(String(response?.headers?.get?.('content-type') || ''));
}

async function* readSseEvents(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (data) {
        yield data;
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const data = trailing
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (data) {
      yield data;
    }
  }
}

function buildStreamingRequestBody(endpoint, prompt, config) {
  if (endpoint === 'responses') {
    return {
      model: config.model,
      input: prompt,
      stream: true,
    };
  }

  return {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };
}

async function postStreamingEndpoint(endpoint, prompt, config, fetchImpl) {
  const path = endpoint === 'responses' ? '/responses' : '/chat/completions';
  const timeoutMs = Number(config.requestTimeoutMs || config.timeoutMs || 120000);
  const controller = typeof AbortController !== 'undefined' && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal: controller?.signal,
    body: JSON.stringify(buildStreamingRequestBody(endpoint, prompt, config)),
  }).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Streaming model request failed: ${response.status} ${response.statusText} ${body}`.trim());
  }

  if (!isEventStreamResponse(response)) {
    throw new Error(`Streaming model endpoint did not return SSE: ${response.headers?.get?.('content-type') || 'unknown'}`);
  }

  return response;
}

async function streamEndpoint(endpoint, prompt, config, options) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await postStreamingEndpoint(endpoint, prompt, config, fetchImpl);
  const parseEvent = endpoint === 'responses' ? parseResponsesSseEvent : parseChatCompletionSseEvent;
  let text = '';
  let usage = null;

  for await (const data of readSseEvents(response)) {
    if (data === '[DONE]') {
      break;
    }

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    usage = parseStreamingUsageEvent(parsed) || usage;
    const delta = parseEvent(parsed);
    if (!delta) {
      continue;
    }
    text += delta;
    if (options.onDelta) {
      await options.onDelta(delta, text);
    }
  }

  return {
    text,
    endpoint,
    model: config.model,
    tier: config.tier || 'chat',
    apiKeyIndex: config.apiKeyIndex || 0,
    usage,
  };
}

function getProfileKeyCount(profile) {
  return Array.isArray(profile.apiKeys) && profile.apiKeys.length ? profile.apiKeys.length : 1;
}

async function streamWithKeyFallback(endpoint, prompt, profile, options) {
  const keyCount = getProfileKeyCount(profile);
  let lastError;

  for (let index = profile.apiKeyIndex || 0; index < keyCount; index += 1) {
    const currentProfile = resolveStreamingModelProfile(prompt, profile, {
      ...options,
      apiKeyIndex: index,
      modelTier: profile.tier,
    });
    try {
      return await streamEndpoint(endpoint, prompt, currentProfile, options);
    } catch (error) {
      lastError = error;
      if (index >= keyCount - 1) {
        break;
      }
    }
  }

  throw lastError;
}

async function streamModelText(prompt, options = {}) {
  const envConfig = buildStreamingChatConfig(options.env || process.env);
  const config = {
    ...envConfig,
    ...Object.fromEntries(Object.entries(options).filter(([key]) => [
      'baseUrl',
      'apiKey',
      'apiKeys',
      'model',
      'simpleModel',
      'thinkingModel',
      'endpointMode',
      'requestTimeoutMs',
      'timeoutMs',
    ].includes(key))),
  };
  config.baseUrl = normalizeBaseUrl(config.baseUrl);
  const profile = resolveStreamingModelProfile(prompt, config, options);

  if (!profile.baseUrl || !profile.apiKey || !profile.model) {
    throw new Error('Missing streaming model config.');
  }

  if (profile.endpointMode === 'responses') {
    return streamWithKeyFallback('responses', prompt, profile, options);
  }

  if (profile.endpointMode === 'chat_completions' || profile.endpointMode === 'chat-completions') {
    return streamWithKeyFallback('chat_completions', prompt, profile, options);
  }

  try {
    return await streamWithKeyFallback('responses', prompt, profile, options);
  } catch {
    return streamWithKeyFallback('chat_completions', prompt, profile, options);
  }
}

module.exports = {
  buildStreamingChatConfig,
  parseChatCompletionSseEvent,
  parseResponsesSseEvent,
  parseStreamingUsageEvent,
  resolveStreamingModelProfile,
  streamModelText,
};
