const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildImageConfig,
  chooseImageModel,
  editImage,
  extractImageResult,
  generateImage,
} = require('../scripts/image-client');

test('buildImageConfig uses isolated image env values', () => {
  const config = buildImageConfig({
    IMAGE_MODEL_BASE_URL: 'https://img.example.test/',
    IMAGE_MODEL_API_KEY: 'image-secret',
    IMAGE_MODEL_ID: 'auto',
    IMAGE_MODEL_SIZE: '1024x1024',
    STREAMING_MODEL_API_KEY: 'chat-secret',
  });

  assert.equal(config.baseUrl, 'https://img.example.test');
  assert.equal(config.apiKey, 'image-secret');
  assert.equal(config.model, 'auto');
  assert.equal(config.size, '1024x1024');
});

test('chooseImageModel prefers image models from model list', () => {
  assert.equal(chooseImageModel(['auto', 'gpt-5', 'codex-gpt-image-2', 'gpt-image-2']), 'gpt-image-2');
  assert.equal(chooseImageModel(['gpt-5', 'codex-gpt-image-2']), 'codex-gpt-image-2');
  assert.equal(chooseImageModel(['gpt-5', 'flux-pro']), 'flux-pro');
});

test('extractImageResult supports url and b64_json responses', () => {
  assert.deepEqual(extractImageResult({ data: [{ url: 'https://example.test/a.png' }] }), {
    type: 'url',
    url: 'https://example.test/a.png',
    revisedPrompt: '',
  });

  assert.deepEqual(extractImageResult({ data: [{ b64_json: 'abc' }] }), {
    type: 'b64_json',
    b64Json: 'abc',
    mimeType: 'image/png',
    revisedPrompt: '',
  });
});

test('generateImage resolves auto model and sends image generation request', async () => {
  const calls = [];
  const result = await generateImage('画一个杯子', {
    env: {
      IMAGE_MODEL_BASE_URL: 'https://img.example.test',
      IMAGE_MODEL_API_KEY: 'image-secret',
      IMAGE_MODEL_ID: 'auto',
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'gpt-5' },
            { id: 'gpt-image-2' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        data: [{ b64_json: 'abc123' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(result.model, 'gpt-image-2');
  assert.equal(result.type, 'b64_json');
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).model, 'gpt-image-2');
  assert.equal(JSON.parse(calls[1].options.body).prompt, '画一个杯子');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer image-secret');
});

test('editImage sends multipart image edit request', async () => {
  const calls = [];
  const result = await editImage('修复旧照片', {
    image: {
      buffer: Buffer.from('old-photo'),
      mimeType: 'image/jpeg',
      filename: 'old-photo.jpg',
    },
    env: {
      IMAGE_MODEL_BASE_URL: 'https://img.example.test',
      IMAGE_MODEL_API_KEY: 'image-secret',
      IMAGE_MODEL_ID: 'gpt-image-2',
      IMAGE_MODEL_SIZE: '1024x1024',
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      assert.equal(url, 'https://img.example.test/v1/images/edits');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer image-secret');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('model'), 'gpt-image-2');
      assert.equal(options.body.get('prompt'), '修复旧照片');
      assert.equal(options.body.get('size'), '1024x1024');
      assert.ok(options.body.get('image') instanceof Blob);
      return new Response(JSON.stringify({
        data: [{ b64_json: 'edited123' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(result.model, 'gpt-image-2');
  assert.equal(result.type, 'b64_json');
  assert.equal(result.b64Json, 'edited123');
  assert.equal(calls.length, 1);
});
