const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildStreamingChatConfig,
  parseChatCompletionSseEvent,
  parseResponsesSseEvent,
  resolveStreamingModelProfile,
  streamModelText,
} = require('../scripts/streaming-client');

function sseResponse(chunks, headers = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
    body: stream,
    text: async () => chunks.join(''),
  };
}

test('parseResponsesSseEvent extracts response output text deltas', () => {
  assert.equal(parseResponsesSseEvent({ type: 'response.output_text.delta', delta: '你好' }), '你好');
  assert.equal(parseResponsesSseEvent({ type: 'response.completed' }), '');
});

test('parseChatCompletionSseEvent extracts chat completion deltas', () => {
  assert.equal(parseChatCompletionSseEvent({ choices: [{ delta: { content: '你好' } }] }), '你好');
  assert.equal(parseChatCompletionSseEvent({ choices: [{ delta: { role: 'assistant' } }] }), '');
});

test('buildStreamingChatConfig prefers explicit streaming env values', () => {
  const config = buildStreamingChatConfig({
    STREAMING_MODEL_BASE_URL: 'https://example.test/v1',
    STREAMING_MODEL_API_KEY: 'secret',
    STREAMING_MODEL_ID: 'model-a',
    STREAMING_MODEL_ENDPOINT_MODE: 'responses',
  });

  assert.equal(config.baseUrl, 'https://example.test/v1');
  assert.equal(config.apiKey, 'secret');
  assert.equal(config.model, 'model-a');
  assert.equal(config.endpointMode, 'responses');
});

test('buildStreamingChatConfig supports LongCat model tiers and multiple keys', () => {
  const config = buildStreamingChatConfig({
    STREAMING_MODEL_BASE_URL: 'https://api.longcat.chat/openai/v1',
    STREAMING_MODEL_API_KEY: 'primary',
    STREAMING_MODEL_API_KEYS: 'primary, backup',
    STREAMING_MODEL_ID: 'LongCat-Flash-Chat',
    STREAMING_MODEL_SIMPLE_ID: 'LongCat-Flash-Lite',
    STREAMING_MODEL_THINKING_ID: 'LongCat-Flash-Thinking-2601',
    STREAMING_MODEL_ENDPOINT_MODE: 'chat_completions',
  });

  assert.deepEqual(config.apiKeys, ['primary', 'backup']);
  assert.equal(config.model, 'LongCat-Flash-Chat');
  assert.equal(config.simpleModel, 'LongCat-Flash-Lite');
  assert.equal(config.thinkingModel, 'LongCat-Flash-Thinking-2601');
});

test('resolveStreamingModelProfile routes simple prompts to Flash-Lite', () => {
  const profile = resolveStreamingModelProfile('你现在内存多少', {
    model: 'LongCat-Flash-Chat',
    simpleModel: 'LongCat-Flash-Lite',
    thinkingModel: 'LongCat-Flash-Thinking-2601',
    apiKey: 'primary',
    apiKeys: ['primary', 'backup'],
  });

  assert.equal(profile.model, 'LongCat-Flash-Lite');
  assert.equal(profile.apiKey, 'primary');
  assert.equal(profile.tier, 'simple');
});

test('streamModelText falls back from non-SSE responses endpoint to chat completions', async () => {
  const calls = [];
  const deltas = [];
  const result = await streamModelText('你好', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
    model: 'model-a',
    endpointMode: 'auto',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/responses')) {
        return sseResponse(['<html>One API</html>'], { 'content-type': 'text/html; charset=utf-8' });
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n',
      ], { 'content-type': 'text/event-stream' });
    },
    onDelta: async (delta) => {
      deltas.push(delta);
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/responses$/);
  assert.match(calls[1].url, /\/chat\/completions$/);
  assert.equal(JSON.parse(calls[1].options.body).stream, true);
  assert.deepEqual(deltas, ['你', '好']);
  assert.equal(result.text, '你好');
  assert.equal(result.endpoint, 'chat_completions');
  assert.equal(result.model, 'model-a');
});

test('streamModelText uses simple model tier for lightweight prompts', async () => {
  const calls = [];
  const result = await streamModelText('你现在内存多少', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'primary',
    apiKeys: ['primary', 'backup'],
    model: 'LongCat-Flash-Chat',
    simpleModel: 'LongCat-Flash-Lite',
    thinkingModel: 'LongCat-Flash-Thinking-2601',
    endpointMode: 'chat_completions',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"正常"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\n\n',
        'data: [DONE]\n\n',
      ], { 'content-type': 'text/event-stream' });
    },
  });

  assert.equal(JSON.parse(calls[0].options.body).model, 'LongCat-Flash-Lite');
  assert.equal(JSON.parse(calls[0].options.body).stream_options.include_usage, true);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer primary');
  assert.equal(result.text, '正常');
  assert.equal(result.model, 'LongCat-Flash-Lite');
  assert.equal(result.tier, 'simple');
  assert.deepEqual(result.usage, {
    prompt_tokens: 12,
    completion_tokens: 2,
    total_tokens: 14,
  });
});

test('streamModelText retries with backup key when the first key is rate limited', async () => {
  const calls = [];
  const result = await streamModelText('正常聊天', {
    baseUrl: 'https://example.test/v1',
    apiKeys: ['primary', 'backup'],
    model: 'LongCat-Flash-Chat',
    endpointMode: 'chat_completions',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.headers.Authorization === 'Bearer primary') {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: () => 'application/json' },
          text: async () => '{"error":"rate limited"}',
        };
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"备用成功"}}]}\n\n',
        'data: [DONE]\n\n',
      ], { 'content-type': 'text/event-stream' });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer primary');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer backup');
  assert.equal(result.text, '备用成功');
  assert.equal(result.apiKeyIndex, 1);
});

test('streamModelText streams responses endpoint deltas when supported', async () => {
  const deltas = [];
  const result = await streamModelText('你好', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
    model: 'model-a',
    endpointMode: 'responses',
    fetchImpl: async () => sseResponse([
      'data: {"type":"response.output_text.delta","delta":"你"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"好"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ], { 'content-type': 'text/event-stream' }),
    onDelta: async (delta) => deltas.push(delta),
  });

  assert.deepEqual(deltas, ['你', '好']);
  assert.equal(result.text, '你好');
  assert.equal(result.endpoint, 'responses');
});

test('streamModelText fails clearly when no streaming config is available', async () => {
  await assert.rejects(
    () => streamModelText('你好', {
      baseUrl: '',
      apiKey: '',
      model: '',
      fetchImpl: async () => {
        throw new Error('fetch should not run');
      },
    }),
    /Missing streaming model config/,
  );
});
