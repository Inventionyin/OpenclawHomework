const assert = require('node:assert/strict');
const test = require('node:test');

const {
  maskApiKey,
  parseImageChannelConfig,
} = require('../scripts/image-channel-config');

test('parseImageChannelConfig extracts url key model and size with Chinese colons', () => {
  const parsed = parseImageChannelConfig([
    '切换生图通道',
    'url：https://img2.suneora.com',
    'key：sk-test-secret-123456',
    'model：auto',
    'size：1024x1024',
  ].join('\n'));

  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.url, 'https://img2.suneora.com');
  assert.equal(parsed.apiKey, 'sk-test-secret-123456');
  assert.equal(parsed.model, 'auto');
  assert.equal(parsed.size, '1024x1024');
  assert.deepEqual(parsed.missing, []);
});

test('parseImageChannelConfig treats bare url and key as medium confidence', () => {
  const parsed = parseImageChannelConfig('url: https://img.example.test key: sk-short-term');

  assert.equal(parsed.confidence, 'medium');
  assert.equal(parsed.hasCandidateFields, true);
  assert.equal(parsed.hasExplicitSwitchIntent, false);
});

test('parseImageChannelConfig reports missing fields as low confidence', () => {
  const parsed = parseImageChannelConfig('切换生图 key: sk-only');

  assert.equal(parsed.confidence, 'low');
  assert.deepEqual(parsed.missing, ['url']);
});

test('maskApiKey never returns the full key', () => {
  assert.equal(maskApiKey('sk-ep1cS_k4u0Jw_6VJ4MQ6vi52j005BxKP'), 'sk-ep1...BxKP (35)');
});
