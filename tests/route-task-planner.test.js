const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildRouteTaskRecord,
  recordRouteTask,
} = require('../scripts/route-task-planner');

test('low risk skill route builds queued task record', () => {
  const record = buildRouteTaskRecord({
    skillId: 'trend-intel',
    action: 'trend-intel',
    rawText: '看看今天热点',
  }, {
    now: new Date('2026-05-10T01:00:00.000Z'),
  });

  assert.equal(record.type, 'skill:trend-intel');
  assert.equal(record.status, 'queued');
  assert.equal(record.summary.routeAction, 'trend-intel');
  assert.equal(record.summary.nextStep, 'execute_skill');
  assert.equal(record.metadata.skillId, 'trend-intel');
  assert.equal(record.metadata.riskLevel, 'low');
  assert.equal(record.metadata.autoRun, true);
});

test('medium risk skill route builds confirmation task record', () => {
  const record = buildRouteTaskRecord({
    skillId: 'ui-automation-run',
    action: 'run',
  });

  assert.equal(record.type, 'skill:ui-automation-run');
  assert.equal(record.status, 'queued');
  assert.equal(record.summary.nextStep, 'request_confirmation');
  assert.equal(record.summary.routeStatus, 'needs_confirmation');
  assert.equal(record.metadata.riskLevel, 'medium');
});

test('registered skill route can be classified by action without skill id', () => {
  const record = buildRouteTaskRecord({
    agent: 'clerk-agent',
    action: 'trend-intel',
  });

  assert.equal(record.type, 'skill:trend-intel');
  assert.equal(record.status, 'queued');
  assert.equal(record.metadata.skillId, 'trend-intel');
});

test('browser observe route builds browser verify task record', () => {
  const record = buildRouteTaskRecord({
    agent: 'browser-agent',
    action: 'browser-observe',
    targetUrl: 'http://localhost:3000',
    rawText: '观察页面',
  });

  assert.equal(record.type, 'browser-verify');
  assert.equal(record.status, 'queued');
  assert.equal(record.summary.routeAction, 'browser-observe');
  assert.equal(record.summary.nextStep, 'browser_observe');
  assert.equal(record.metadata.runtime, 'browser-runtime');
  assert.equal(record.metadata.browser.operation, 'observe');
  assert.equal(record.metadata.browser.targetUrl, 'http://localhost:3000');
});

test('legacy browser dry-run route builds browser observe task record', () => {
  const record = buildRouteTaskRecord({
    agent: 'browser-agent',
    action: 'browser-dry-run',
    rawText: '观察 https://shop.evanshine.me/login 页面结构',
  });

  assert.equal(record.type, 'browser-verify');
  assert.equal(record.status, 'queued');
  assert.equal(record.metadata.browser.operation, 'observe');
  assert.equal(record.metadata.browser.targetUrl, 'https://shop.evanshine.me/login');
});

test('unknown route builds degraded task record', () => {
  const record = buildRouteTaskRecord({
    agent: 'unknown-agent',
    action: 'unknown-action',
  });

  assert.equal(record.type, 'route:unknown');
  assert.equal(record.status, 'degraded');
  assert.equal(record.summary.nextStep, 'manual_triage');
  assert.equal(record.metadata.reason, 'unsupported_route');
});

test('route task metadata redacts common secret values', () => {
  const record = buildRouteTaskRecord({
    skillId: 'trend-intel',
    action: 'trend-intel',
    token: 'sk-live-secret',
    nested: {
      password: 'plain-password',
      value: 'abc ak_live_123 ck_live_456 tail',
    },
  });
  const serialized = JSON.stringify(record);

  assert.doesNotMatch(serialized, /sk-live-secret/);
  assert.doesNotMatch(serialized, /plain-password/);
  assert.doesNotMatch(serialized, /ak_live_123/);
  assert.doesNotMatch(serialized, /ck_live_456/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('recordRouteTask calls injected createTask with draft record', () => {
  let received = null;
  const task = recordRouteTask({
    skillId: 'trend-intel',
    action: 'trend-intel',
  }, {
    now: new Date('2026-05-10T01:00:00.000Z'),
    createTask: (input) => {
      received = input;
      return { id: 'task-1', ...input };
    },
  });

  assert.equal(received.type, 'skill:trend-intel');
  assert.equal(received.status, 'queued');
  assert.equal(task.id, 'task-1');
});

test('recordRouteTask defaults to background task store createTask', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'route-task-planner-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    const task = recordRouteTask({
      skillId: 'trend-intel',
      action: 'trend-intel',
    }, {
      env,
      now: new Date('2026-05-10T01:00:00.000Z'),
    });

    assert.equal(task.type, 'skill:trend-intel');
    assert.equal(task.status, 'queued');
    assert.equal(task.summary.routeAction, 'trend-intel');
    assert.equal(task.metadata.skillId, 'trend-intel');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
