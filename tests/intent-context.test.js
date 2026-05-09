const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildConversationKey,
  getFreshIntentHint,
  readIntentContext,
  routeFromContextHint,
  writeIntentContext,
} = require('../scripts/agents/intent-context');

test('buildConversationKey uses explicit key first', () => {
  const payload = {
    event: {
      message: { chat_id: 'oc_xxx' },
      sender: { sender_id: { open_id: 'ou_xxx' } },
    },
  };
  assert.equal(buildConversationKey(payload, 'manual-key'), 'manual-key');
  assert.equal(buildConversationKey('manual-key-2'), 'manual-key-2');
});

test('buildConversationKey builds from Feishu-like payload', () => {
  const payload = {
    event: {
      message: { chat_id: 'oc_123', message_id: 'om_456' },
      sender: { sender_id: { open_id: 'ou_789' } },
    },
  };
  assert.equal(buildConversationKey(payload), 'chat:oc_123:user:ou_789');
});

test('write/read stores only route metadata fields', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'intent-context-test-'));
  try {
    const filePath = join(tempDir, 'intent-context.json');
    const key = 'chat:oc_1:user:ou_1';
    writeIntentContext(
      key,
      {
        agent: 'clerk',
        action: 'todo_summary',
        confidence: 0.88,
        requiresAuth: false,
        source: 'router_rule',
        rawText: 'should-not-store',
      },
      { filePath, now: Date.parse('2026-05-09T00:00:00.000Z') }
    );

    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.deepEqual(Object.keys(parsed[key]).sort(), [
      'action',
      'agent',
      'confidence',
      'requiresAuth',
      'source',
      'updatedAt',
    ]);
    assert.equal(parsed[key].rawText, undefined);

    const hint = readIntentContext(key, { filePath });
    assert.equal(hint.agent, 'clerk');
    assert.equal(hint.action, 'todo_summary');
    assert.equal(hint.source, 'router_rule');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getFreshIntentHint returns null for expired hints', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'intent-context-test-'));
  try {
    const filePath = join(tempDir, 'intent-context.json');
    const key = 'chat:oc_1:user:ou_1';
    writeFileSync(
      filePath,
      JSON.stringify({
        [key]: {
          agent: 'clerk',
          action: 'todo_summary',
          confidence: 0.7,
          requiresAuth: false,
          source: 'router_rule',
          updatedAt: '2026-05-08T00:00:00.000Z',
        },
      }),
      'utf8'
    );
    const hint = getFreshIntentHint(key, {
      filePath,
      now: Date.parse('2026-05-09T00:10:00.000Z'),
      ttlMs: 60 * 1000,
    });
    assert.equal(hint, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('read/get fresh tolerate corrupt JSON', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'intent-context-test-'));
  try {
    const filePath = join(tempDir, 'intent-context.json');
    const key = 'chat:oc_1:user:ou_1';
    writeFileSync(filePath, '{bad json', 'utf8');
    assert.equal(readIntentContext(key, { filePath }), null);
    assert.equal(getFreshIntentHint(key, { filePath }), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeIntentContext caps entries and evicts oldest', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'intent-context-test-'));
  try {
    const filePath = join(tempDir, 'intent-context.json');
    writeIntentContext('k1', { agent: 'clerk', action: 'todo_summary' }, { filePath, maxEntries: 2, now: 1000 });
    writeIntentContext('k2', { agent: 'browser', action: 'browser_clarify' }, { filePath, maxEntries: 2, now: 2000 });
    writeIntentContext('k3', { agent: 'clerk', action: 'token_summary' }, { filePath, maxEntries: 2, now: 3000 });
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(parsed.k1, undefined);
    assert.equal(Boolean(parsed.k2), true);
    assert.equal(Boolean(parsed.k3), true);
    assert.equal(Object.keys(parsed).length, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('routeFromContextHint maps safe follow-up by previous safe topic', () => {
  const route = routeFromContextHint('刚才那个呢', {
    agent: 'clerk-agent',
    action: 'token-summary',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(route, {
    agent: 'clerk-agent',
    action: 'token-summary',
    confidence: 'medium',
    requiresAuth: true,
    intentSource: 'context-hint',
  });
});

test('routeFromContextHint rejects dangerous ops hints', () => {
  const dangerous = routeFromContextHint('继续', {
    agent: 'ops-agent',
    action: 'restart',
    confidence: 0.9,
    requiresAuth: true,
  });
  assert.equal(dangerous, null);

  const safeAuthRequired = routeFromContextHint('继续', {
    agent: 'ops-agent',
    action: 'load-summary',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(safeAuthRequired, {
    agent: 'ops-agent',
    action: 'load-summary',
    confidence: 'medium',
    requiresAuth: true,
    intentSource: 'context-hint',
  });
});
