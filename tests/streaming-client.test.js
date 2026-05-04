const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildStreamingChatConfig,
  parseChatCompletionSseEvent,
  parseResponsesSseEvent,
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
  assert.deepEqual(result, {
    text: '你好',
    endpoint: 'chat_completions',
  });
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
