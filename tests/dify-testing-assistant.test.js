const assert = require('node:assert/strict');
const test = require('node:test');

const {
  askDifyTestingAssistant,
  buildDifyChatMessagesUrl,
  buildDifyTestingAssistantConfig,
  redactApiKey,
} = require('../scripts/dify-testing-assistant');

test('buildDifyTestingAssistantConfig reads env values', () => {
  const config = buildDifyTestingAssistantConfig({
    DIFY_TESTING_ASSISTANT_ENABLED: 'true',
    DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test/',
    DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    DIFY_TESTING_ASSISTANT_TIMEOUT_MS: '4321',
    DIFY_TESTING_ASSISTANT_RESPONSE_MODE: 'blocking',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.url, 'https://dify.example.test');
  assert.equal(config.apiKey, 'secret-key');
  assert.equal(config.timeoutMs, 4321);
  assert.equal(config.responseMode, 'blocking');
});

test('redactApiKey hides secret content', () => {
  assert.equal(redactApiKey('token=abc123', 'abc123'), 'token=[REDACTED]');
});

test('buildDifyChatMessagesUrl accepts base URL or full chat-messages URL', () => {
  assert.equal(
    buildDifyChatMessagesUrl('https://dify.example.test'),
    'https://dify.example.test/v1/chat-messages',
  );
  assert.equal(
    buildDifyChatMessagesUrl('https://dify.example.test/v1/chat-messages'),
    'https://dify.example.test/v1/chat-messages',
  );
  assert.equal(
    buildDifyChatMessagesUrl('https://dify.example.test/v1/chat-messages/'),
    'https://dify.example.test/v1/chat-messages',
  );
});

test('askDifyTestingAssistant returns fallback report when disabled', async () => {
  const result = await askDifyTestingAssistant('ping', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'false',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    },
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.reason, 'disabled');
  assert.equal(result.config.apiKey, '[REDACTED]');
});

test('askDifyTestingAssistant returns fallback report when not configured', async () => {
  const result = await askDifyTestingAssistant('ping', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: '',
      DIFY_TESTING_ASSISTANT_API_KEY: '',
    },
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unconfigured');
});

test('askDifyTestingAssistant sends required payload and parses answer', async () => {
  const calls = [];
  const result = await askDifyTestingAssistant('do test plan', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
      DIFY_TESTING_ASSISTANT_RESPONSE_MODE: 'blocking',
      DIFY_TESTING_ASSISTANT_TIMEOUT_MS: '9999',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ answer: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://dify.example.test/v1/chat-messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    inputs: {},
    query: 'do test plan',
    response_mode: 'blocking',
    user: 'hermes-agent',
  });
  assert.equal(result.ok, true);
  assert.equal(result.answer, 'ok');
});

test('askDifyTestingAssistant supports text and data.answer response shapes', async () => {
  const textResult = await askDifyTestingAssistant('q1', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    },
    fetchImpl: async () => new Response(JSON.stringify({ text: 'text-answer' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(textResult.answer, 'text-answer');

  const dataAnswerResult = await askDifyTestingAssistant('q2', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    },
    fetchImpl: async () => new Response(JSON.stringify({ data: { answer: 'nested-answer' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(dataAnswerResult.answer, 'nested-answer');
});

test('askDifyTestingAssistant returns redacted fallback report on upstream error', async () => {
  const result = await askDifyTestingAssistant('query includes secret-key', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    },
    fetchImpl: async () => new Response('bad secret-key', { status: 500, statusText: 'boom' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.match(result.message, /\[REDACTED\]/);
  assert.doesNotMatch(result.message, /secret-key/);
});

test('askDifyTestingAssistant redacts api key from successful reply text', async () => {
  const result = await askDifyTestingAssistant('hello', {
    env: {
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
      DIFY_TESTING_ASSISTANT_URL: 'https://dify.example.test',
      DIFY_TESTING_ASSISTANT_API_KEY: 'secret-key',
    },
    fetchImpl: async () => new Response(JSON.stringify({ answer: 'use secret-key now' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, 'use [REDACTED] now');
});
