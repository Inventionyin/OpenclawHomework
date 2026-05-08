const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildProtocolTestCases,
  buildProtocolAssetReport,
  saveHotMonitorCandidatesAsProtocolAssets,
  findProtocolAssets,
  listProtocolAssets,
  normalizeProtocolAssetInput,
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
    host: 'api.example.com',
    normalizedPath: '/v1/users/42',
    status: 204,
    contentType: 'application/json',
    durationMs: 250,
    tags: ['users', 'update'],
  });
});

test('findProtocolAssets filters by method path tag status range and text query', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'protocol-assets-find-'));
  try {
    saveProtocolAsset({
      method: 'GET',
      url: 'https://api.example.com/v1/users',
      status: 200,
      tags: ['users', 'catalog'],
      summaryText: 'List users',
      createdAt: '2026-05-07T10:00:00.000Z',
    }, { dir: tempDir });
    const match = saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/v1/sessions',
      status: 401,
      tags: ['auth', 'session'],
      summaryText: 'Create session',
      createdAt: '2026-05-07T10:01:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/internal/jobs',
      status: 503,
      tags: ['internal'],
      summaryText: 'Create job',
      createdAt: '2026-05-07T10:02:00.000Z',
    }, { dir: tempDir });

    const result = findProtocolAssets({
      method: 'post',
      path: '/v1',
      tag: 'auth',
      statusMin: 400,
      statusMax: 499,
      text: 'session',
    }, { dir: tempDir });

    assert.equal(result.length, 1);
    assert.equal(result[0].id, match.id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildProtocolAssetReport returns concise aggregates and recent summaries', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'protocol-assets-report-'));
  try {
    saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/v1/sessions',
      status: 201,
      tags: ['auth'],
      summaryText: 'Create session',
      createdAt: '2026-05-07T10:03:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'GET',
      url: 'https://api.example.com/v1/sessions',
      status: 200,
      tags: ['auth'],
      summaryText: 'Read session',
      createdAt: '2026-05-07T10:02:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/v1/users',
      status: 422,
      tags: ['users'],
      summaryText: 'Create user',
      createdAt: '2026-05-07T10:01:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'DELETE',
      url: 'https://api.example.com/v1/users/42',
      status: 503,
      tags: ['users'],
      summaryText: 'Delete user',
      createdAt: '2026-05-07T10:00:00.000Z',
    }, { dir: tempDir });

    const report = buildProtocolAssetReport({ text: 'session' }, { dir: tempDir });
    assert.equal(report.total, 2);
    assert.deepEqual(report.byMethod, { POST: 1, GET: 1 });
    assert.deepEqual(report.byStatusClass, { '2xx': 2 });
    assert.equal(report.recent.length, 2);
    assert.deepEqual(report.recent.map((item) => item.summaryText), ['Create session', 'Read session']);
    assert.deepEqual(report.topPaths, [{ path: '/v1/sessions', count: 2 }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildProtocolAssetReport highlights hosts, abnormal assets and next actions', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'protocol-assets-diagnosis-'));
  try {
    saveProtocolAsset({
      method: 'GET',
      url: 'https://shop.evanshine.me/api/products',
      status: 200,
      tags: ['catalog'],
      summaryText: 'List products',
      createdAt: '2026-05-07T10:04:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'POST',
      url: 'https://shop.evanshine.me/api/login',
      status: 401,
      tags: ['auth', 'login'],
      summaryText: 'Login failed',
      createdAt: '2026-05-07T10:03:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'POST',
      url: 'https://api.evanshine.me/api/order',
      status: 500,
      tags: ['order'],
      summaryText: 'Create order failed',
      createdAt: '2026-05-07T10:02:00.000Z',
    }, { dir: tempDir });

    const report = buildProtocolAssetReport({}, { dir: tempDir });

    assert.deepEqual(report.byHost, {
      'shop.evanshine.me': 2,
      'api.evanshine.me': 1,
    });
    assert.equal(report.abnormal.length, 2);
    assert.deepEqual(report.abnormal.map((item) => item.path), ['/api/login', '/api/order']);
    assert.deepEqual(report.nextActions, [
      '优先复盘 5xx 接口：POST api.evanshine.me/api/order 500',
      '检查登录/鉴权链路：POST shop.evanshine.me/api/login 401',
      '把异常接口转成回归用例：把最近抓到的接口整理成测试用例',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('normalizeProtocolAssetInput returns stable normalized query structure', () => {
  const normalized = normalizeProtocolAssetInput({
    method: 'patch',
    path: ' /v1/users ',
    tag: ' Auth ',
    statusMin: '400',
    statusMax: '499',
    text: ' Session ',
  });

  assert.deepEqual(normalized, {
    method: 'PATCH',
    path: '/v1/users',
    tag: 'auth',
    statusMin: 400,
    statusMax: 499,
    text: 'session',
  });
});

test('buildProtocolTestCases turns captured assets into reusable contract cases', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'protocol-assets-cases-'));
  try {
    const session = saveProtocolAsset({
      method: 'POST',
      url: 'https://api.example.com/api/session?token=secret',
      status: 201,
      tags: ['auth', 'login'],
      summaryText: 'Create session',
      createdAt: '2026-05-07T10:03:00.000Z',
    }, { dir: tempDir });
    saveProtocolAsset({
      method: 'GET',
      url: 'https://api.example.com/api/products',
      status: 200,
      tags: ['shop'],
      summaryText: 'List products',
      createdAt: '2026-05-07T10:02:00.000Z',
    }, { dir: tempDir });

    const result = buildProtocolTestCases({ text: 'session' }, { dir: tempDir, limit: 3 });

    assert.equal(result.totalAssets, 1);
    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0].name, 'POST /api/session should return 201');
    assert.equal(result.cases[0].method, 'POST');
    assert.equal(result.cases[0].path, '/api/session');
    assert.equal(result.cases[0].expectedStatus, 201);
    assert.equal(result.cases[0].sourceAssetId, session.id);
    assert.deepEqual(result.cases[0].tags, ['auth', 'login', 'contract']);
    assert.deepEqual(result.cases[0].assertions, [
      { field: 'status', op: 'equals', value: 201 },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveHotMonitorCandidatesAsProtocolAssets stores searchable hot monitor links', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hot-candidates-protocol-'));
  try {
    const result = saveHotMonitorCandidatesAsProtocolAssets([
      {
        id: 'benefit:gpu',
        title: 'Free GPU credits',
        titleZh: 'GPU 额度福利线索',
        summary: 'Apply before May 30.',
        source: 'Tavily 搜索',
        kind: 'benefit-search',
        link: 'https://example.com/gpu',
        categories: ['benefit'],
        score: 120,
      },
    ], { dir: tempDir, now: '2026-05-08T10:00:00.000Z' });

    assert.equal(result.saved.length, 1);
    assert.equal(result.saved[0].summary.normalizedPath, '/gpu');
    assert(result.saved[0].tags.includes('hot-monitor'));
    assert(result.saved[0].tags.includes('benefit'));
    assert.match(result.saved[0].summaryText, /GPU 额度福利线索/);
    const report = buildProtocolAssetReport({ tag: 'hot-monitor' }, { dir: tempDir });
    assert.equal(report.total, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
