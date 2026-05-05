const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildChatAgentPrompt,
  buildCapabilityGuideReply,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildQaAgentReply,
  sanitizeReplyField,
} = require('../scripts/agents/agent-handlers');

test('buildCapabilityGuideReply explains practical agent playbook', () => {
  const reply = buildCapabilityGuideReply('OpenClaw');
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /UI 自动化/);
  assert.match(reply, /服务器/);
  assert.match(reply, /记忆/);
  assert.match(reply, /邮箱/);
});

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

test('buildMemoryAgentReply supports keyword search', () => {
  const reply = buildMemoryAgentReply({ action: 'search', query: 'session lock' }, '', {
    searchMemoryContext: () => '# 记忆检索结果\n\n- session lock 已修复',
  });
  assert.match(reply, /记忆检索结果/);
  assert.match(reply, /session lock/);
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

test('buildQaAgentReply answers customer service training requests naturally', () => {
  const reply = buildQaAgentReply({
    action: 'customer-service-data',
  });

  assert.match(reply, /电商客服训练数据/);
  assert.match(reply, /144/);
  assert.match(reply, /customer-service-cases\.json/);
  assert.doesNotMatch(reply, /\/status/);
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

test('buildOpsAgentReply renders friendly summary replies', async () => {
  const reply = await buildOpsAgentReply({
    action: 'memory-summary',
    target: 'self',
    confidence: 'high',
  }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      memory: { total: '8G', used: '3.1G', free: '4.9G' },
    }),
  });

  assert.match(reply, /我这台服务器目前正常/);
  assert.match(reply, /内存：8G 总量/);
});

test('buildOpsAgentReply asks for clarification on medium-confidence dangerous ops', async () => {
  const reply = await buildOpsAgentReply({
    action: 'restart',
    target: 'self',
    confidence: 'medium',
    originalText: '你重起一下',
  });

  assert.match(reply, /你是想让我重启/);
});

test('buildOpsAgentReply guides on low-confidence ops requests', async () => {
  const reply = await buildOpsAgentReply({
    action: 'clarify',
    target: 'unknown',
    confidence: 'low',
  });

  assert.match(reply, /我没完全听懂/);
  assert.match(reply, /你现在内存多少/);
});

test('buildOpsAgentReply supports whitelisted peer repair actions', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'peer-repair' }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'peer',
        commit: 'abc1234',
        target: 'OpenClaw',
        operation: 'peer-repair',
        detail: 'restart ok; tests ok',
      };
    },
  });

  assert.equal(receivedAction, 'peer-repair');
  assert.match(reply, /目标：OpenClaw/);
  assert.match(reply, /操作：peer-repair/);
  assert.match(reply, /restart ok; tests ok/);
});

test('buildOpsAgentReply supports explicit exec actions', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'exec', command: 'df -h' }, {
    runOpsCheck: async (action, route) => {
      receivedAction = `${action}:${route.command}`;
      return {
        service: 'root-shell',
        active: 'ok',
        health: 'n/a',
        watchdog: 'manual',
        commit: 'n/a',
        operation: 'exec',
        detail: 'Filesystem      Size  Used Avail Use% Mounted on',
      };
    },
  });

  assert.equal(receivedAction, 'exec:df -h');
  assert.match(reply, /操作：exec/);
  assert.match(reply, /Filesystem/);
});

test('buildOpsAgentReply renders disk audit cleanup candidates', async () => {
  const reply = await buildOpsAgentReply({ action: 'disk-audit' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      disk: { size: '40G', used: '36G', available: '4G', usePercent: '90%' },
      audit: {
        candidates: [
          {
            id: 1,
            name: 'khoj',
            path: '/opt/khoj',
            size: '9.5G',
            risk: 'confirm',
            recommendation: '如果不用 Khoj，可以确认清理。',
          },
          {
            id: 2,
            name: 'npm-cache',
            path: '/root/.npm',
            size: '1.2G',
            risk: 'safe',
            recommendation: '可清理 npm 缓存。',
          },
        ],
      },
    }),
  });

  assert.match(reply, /硬盘占用盘点/);
  assert.match(reply, /1\. khoj/);
  assert.match(reply, /\/opt\/khoj/);
  assert.match(reply, /确认清理第 1 个/);
});

test('buildOpsAgentReply renders cleanup confirmation results', async () => {
  const reply = await buildOpsAgentReply({ action: 'cleanup-confirm', selection: 1 }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      operation: 'cleanup-confirm',
      cleaned: {
        name: 'khoj',
        path: '/opt/khoj',
        beforeAvailable: '4G',
        afterAvailable: '13G',
        detail: '清理完成',
      },
    }),
  });

  assert.match(reply, /已清理 khoj/);
  assert.match(reply, /4G -> 13G/);
});

test('buildOpsAgentReply rejects unknown ops actions', async () => {
  const reply = await buildOpsAgentReply({ action: 'rm -rf /' }, {
    runOpsCheck: async () => {
      throw new Error('runOpsCheck should not be called for unknown ops actions');
    },
  });

  assert.match(reply, /不支持的运维指令/);
});

test('buildOpsAgentReply does not echo secret-like unknown ops actions', async () => {
  const reply = await buildOpsAgentReply({ action: 'Authorization: Bearer abc.def.secret' }, {
    runOpsCheck: async () => {
      throw new Error('runOpsCheck should not be called for unknown ops actions');
    },
  });

  assert.match(reply, /不支持的运维指令/);
  assert.doesNotMatch(reply, /Authorization|Bearer|abc\.def\.secret/);
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

test('sanitizeReplyField redacts ops-specific secret formats', () => {
  assert.equal(sanitizeReplyField('Authorization: Bearer abc.def.secret'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('Authorization: Basic dXNlcjpwYXNz'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('Authorization: token abcdefghijkl'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('token=sk-proj-abc123456789'), '[redacted secret-like output]');
  assert.equal(
    sanitizeReplyField('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'),
    '[redacted secret-like output]',
  );
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

test('buildOpsAgentReply returns safe reply when ops check fails', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => {
      throw new Error('Authorization: Bearer abc.def.secret');
    },
  });

  assert.match(reply, /服务器状态暂时不可用/);
  assert.doesNotMatch(reply, /abc\.def\.secret/);
});

test('buildOpsAgentReply tolerates empty ops check result', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => null,
  });

  assert.match(reply, /服务器状态摘要/);
  assert.match(reply, /unknown/);
});

test('buildOpsAgentReply uses provided local ops runner for watchdog action', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'watchdog' }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234',
      };
    },
  });

  assert.equal(receivedAction, 'watchdog');
  assert.match(reply, /watchdog：active/);
  assert.doesNotMatch(reply, /not configured in local mode/);
});

test('buildChatAgentPrompt does not include memory unless provided', () => {
  const reply = buildChatAgentPrompt('你好');
  assert.doesNotMatch(reply, /Memory Context/);
  assert.doesNotMatch(reply, /38\.76\./);
});
