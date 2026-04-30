const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
} = require('../scripts/agents/agent-handlers');

test('buildDocAgentReply answers project progress from memory', () => {
  const memoryContext = [
    '# Memory Context',
    'GitHub Actions workflow_dispatch triggers UI automation',
    'Watchdog timers check bridge health',
  ].join('\n');

  const reply = buildDocAgentReply('老师任务还差哪些', memoryContext);
  assert.match(reply, /已完成/);
  assert.match(reply, /GitHub Actions/);
  assert.match(reply, /watchdog/i);
});

test('buildMemoryAgentReply shows memory context', () => {
  const reply = buildMemoryAgentReply({ action: 'show' }, '# Memory Context\nOpenClaw 已部署');
  assert.match(reply, /当前记忆摘要/);
  assert.match(reply, /OpenClaw/);
});

test('buildMemoryAgentReply stores safe note', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-handler-test-'));
  try {
    const file = join(tempDir, 'runbook-notes.md');
    writeFileSync(file, '# Runbook Notes\n', 'utf8');
    const reply = buildMemoryAgentReply({ action: 'remember', note: 'OpenClaw 已加串行队列' }, '', {
      noteFile: file,
    });
    assert.match(reply, /已记住/);
    assert.match(readFileSync(file, 'utf8'), /OpenClaw 已加串行队列/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryAgentReply rejects secret-like notes', () => {
  assert.match(
    buildMemoryAgentReply({ action: 'remember', note: 'GITHUB_TOKEN=ghp_example' }, ''),
    /不能保存疑似密钥/,
  );
});

test('buildOpsAgentReply formats whitelisted check results', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234 test commit',
      };
    },
  });

  assert.match(reply, /openclaw-feishu-bridge/);
  assert.match(reply, /active/);
  assert.match(reply, /abc1234/);
  assert.equal(receivedAction, 'status');
});

test('buildOpsAgentReply redacts secret-like fields', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: 'GITHUB_TOKEN: abc123',
      watchdog: 'active',
      commit: 'def5678 test commit',
    }),
  });

  assert.doesNotMatch(reply, /abc123/);
  assert.doesNotMatch(reply, /GITHUB_TOKEN/);
  assert.match(reply, /\[redacted secret-like output\]/);
});

test('buildOpsAgentReply trims long fields', async () => {
  const longHealth = 'x'.repeat(2000);
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: longHealth,
      watchdog: 'active',
      commit: 'abc1234 test commit',
    }),
  });

  assert.doesNotMatch(reply, new RegExp(longHealth));
  assert.match(reply, /x{500}\.\.\./);
});
