function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildStreamingChatConfig(env = process.env) {
  return {
    baseUrl: normalizeBaseUrl(env.STREAMING_MODEL_BASE_URL || env.OPENAI_BASE_URL || env.XFYUN_BASE_URL || ''),
    apiKey: String(env.STREAMING_MODEL_API_KEY || env.OPENAI_API_KEY || env.XFYUN_API_KEY || '').trim(),
    model: String(env.STREAMING_MODEL_ID || env.OPENAI_MODEL || env.XFYUN_MODEL || '').trim(),
    endpointMode: String(env.STREAMING_MODEL_ENDPOINT_MODE || 'auto').trim().toLowerCase(),
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
  };
}

async function postStreamingEndpoint(endpoint, prompt, config, fetchImpl) {
  const path = endpoint === 'responses' ? '/responses' : '/chat/completions';
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(buildStreamingRequestBody(endpoint, prompt, config)),
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
  };
}

async function streamModelText(prompt, options = {}) {
  const envConfig = buildStreamingChatConfig(options.env || process.env);
  const config = {
    ...envConfig,
    ...Object.fromEntries(Object.entries(options).filter(([key]) => ['baseUrl', 'apiKey', 'model', 'endpointMode'].includes(key))),
  };
  config.baseUrl = normalizeBaseUrl(config.baseUrl);

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error('Missing streaming model config.');
  }

  if (config.endpointMode === 'responses') {
    return streamEndpoint('responses', prompt, config, options);
  }

  if (config.endpointMode === 'chat_completions' || config.endpointMode === 'chat-completions') {
    return streamEndpoint('chat_completions', prompt, config, options);
  }

  try {
    return await streamEndpoint('responses', prompt, config, options);
  } catch {
    return streamEndpoint('chat_completions', prompt, config, options);
  }
}

module.exports = {
  buildStreamingChatConfig,
  parseChatCompletionSseEvent,
  parseResponsesSseEvent,
  streamModelText,
};
