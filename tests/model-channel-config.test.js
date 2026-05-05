const assert = require('node:assert/strict');
const test = require('node:test');

const {
  maskApiKey,
  parseModelChannelConfig,
} = require('../scripts/model-channel-config');

test('parseModelChannelConfig extracts explicit LongCat chat channel switch', () => {
  const parsed = parseModelChannelConfig([
    '切换聊天模型通道',
    'url：https://api.longcat.chat/openai/v1',
    'key：ak_test_secret_123456',
    'model：LongCat-Flash-Chat',
    'simple：LongCat-Flash-Lite',
    'thinking：LongCat-Flash-Thinking-2601',
    'mode：chat_completions',
  ].join('\n'));

  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.url, 'https://api.longcat.chat/openai/v1');
  assert.equal(parsed.apiKey, 'ak_test_secret_123456');
  assert.equal(parsed.model, 'LongCat-Flash-Chat');
  assert.equal(parsed.simpleModel, 'LongCat-Flash-Lite');
  assert.equal(parsed.thinkingModel, 'LongCat-Flash-Thinking-2601');
  assert.equal(parsed.endpointMode, 'chat_completions');
  assert.deepEqual(parsed.missing, []);
});

test('parseModelChannelConfig treats bare url and key as medium confidence', () => {
  const parsed = parseModelChannelConfig('url: https://api.longcat.chat/openai/v1 key: ak_short_term');

  assert.equal(parsed.confidence, 'medium');
  assert.equal(parsed.hasCandidateFields, true);
  assert.equal(parsed.hasExplicitSwitchIntent, false);
});

test('parseModelChannelConfig reports missing url as low confidence', () => {
  const parsed = parseModelChannelConfig('切换模型 key: ak_only');

  assert.equal(parsed.confidence, 'low');
  assert.deepEqual(parsed.missing, ['url']);
});

test('maskApiKey never returns the full key', () => {
  assert.equal(maskApiKey('ak_20x19J9ZP74X02t1yW9tp4bJ3j57V'), 'ak_20x...j57V (32)');
});
