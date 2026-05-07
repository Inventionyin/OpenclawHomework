const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  listProtocolAssets,
  redactProtocolAsset,
  saveProtocolAsset,
  summarizeProtocolAsset,
} = require('../scripts/protocol-asset-store');

test('redactProtocolAsset redacts secrets from headers query and body', () => {
  const redacted = redactProtocolAsset({
    request: {
      headers: {
        Authorization: 'Bearer abc',
        'x-api-key': 'plain-key',
        'content-type': 'application/json',
      },
      query: {
        token: 'my-token',
        page: '1',
      },
      body: {
        password: 'pass123',
        nested: {
          value: 'sk-123456',
          gh: 'github_pat_123456',
        },
      },
    },
    response: {
      headers: {
        'set-cookie': 'a=1',
      },
      body: 'this has ck_live_abc and ak_demo inside',
    },
  });

  assert.equal(redacted.request.headers.Authorization, '[REDACTED]');
  assert.equal(redacted.request.headers['x-api-key'], '[REDACTED]');
  assert.equal(redacted.request.query.token, '[REDACTED]');
  assert.equal(redacted.request.body.password, '[REDACTED]');
  assert.equal(redacted.request.body.nested.value, '[REDACTED]');
  assert.equal(redacted.request.body.nested.gh, '[REDACTED]');
  assert.equal(redacted.response.headers['set-cookie'], '[REDACTED]');
  assert.equal(redacted.request.headers['content-type'], 'application/json');
  assert.equal(redacted.request.query.page, '1');
  assert.equal(redacted.response.body.includes('[REDACTED]'), true);
});

test('saveProtocolAsset and listProtocolAssets persist and load protocol assets', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'protocol-assets-'));
  try {
    const first = saveProtocolAsset({
      method: 'GET',
      url: 'https://api.example.com/v1/users?token=secret',
      status: 200,
      tags: ['api', 'users'],
      createdAt: '2026-05-07T00:00:00.000Z',
    }, { dir: tempDir });

    const second = saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/v1/sessions',
      status: 201,
      tags: ['auth'],
      createdAt: '2026-05-07T00:01:00.000Z',
    }, { dir: tempDir });

    assert.equal(existsSync(join(tempDir, `${first.id}.json`)), true);
    assert.equal(existsSync(join(tempDir, `${second.id}.json`)), true);

    const stored = JSON.parse(readFileSync(join(tempDir, `${first.id}.json`), 'utf8'));
    assert.equal(stored.url, 'https://api.example.com/v1/users?token=secret');
    assert.equal(stored.summary.normalizedPath, '/v1/users');
    assert.equal(stored.summary.tags.length, 2);

    const list = listProtocolAssets({ dir: tempDir });
    assert.deepEqual(list.map((item) => item.id), [second.id, first.id]);
    assert.equal(list[1].summary.method, 'GET');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('summarizeProtocolAsset normalizes method url status content type duration and tags', () => {
  const summary = summarizeProtocolAsset({
    method: 'patch',
    url: 'https://api.example.com///v1/users/42/?token=abc#x',
    response: {
      status: 204,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
    startedAt: '2026-05-07T10:00:00.000Z',
    endedAt: '2026-05-07T10:00:00.250Z',
    tags: ['users', 'update'],
  });

  assert.deepEqual(summary, {
    method: 'PATCH',
    normalizedPath: '/v1/users/42',
    status: 204,
    contentType: 'application/json',
    durationMs: 250,
    tags: ['users', 'update'],
  });
});
