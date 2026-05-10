const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  loadGoldenIntentCases,
  runGoldenIntentEvals,
  scoreRoute,
} = require('../scripts/agent-evals');

test('scoreRoute compares expected agent and action', () => {
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'load-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), true);
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'disk-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), false);
});

test('loadGoldenIntentCases reads json cases', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-evals-'));
  try {
    const file = join(tempDir, 'cases.json');
    writeFileSync(file, JSON.stringify([{ text: '你好', expected: { agent: 'chat-agent', action: 'chat' } }]), 'utf8');
    assert.equal(loadGoldenIntentCases(file).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runGoldenIntentEvals returns pass and failure details', () => {
  const result = runGoldenIntentEvals({
    cases: [
      { text: '内存多少', expected: { agent: 'ops-agent', action: 'load-summary' } },
      { text: '你好', expected: { agent: 'chat-agent', action: 'chat' } },
    ],
    routeIntent: (text) => (text === '内存多少'
      ? { agent: 'ops-agent', action: 'load-summary' }
      : { agent: 'clerk-agent', action: 'command-center' }),
  });

  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].text, '你好');
});

test('golden intent cases cover phase 2 and phase 3 natural-language controls', () => {
  const byText = new Map(loadGoldenIntentCases().map((item) => [item.text, item.expected]));

  assert.deepEqual(byText.get('观察 https://shop.evanshine.me/login 页面结构'), {
    agent: 'browser-agent',
    action: 'browser-dry-run',
  });
  assert.deepEqual(byText.get('抓一下 https://github.com/microsoft/RD-Agent 正文'), {
    agent: 'clerk-agent',
    action: 'web-content-fetch',
  });
  assert.deepEqual(byText.get('请根据需求文档生成测试用例'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
  });
  assert.deepEqual(byText.get('邮箱平台怎么玩'), {
    agent: 'qa-agent',
    action: 'email-playbook',
  });
  assert.deepEqual(byText.get('文员，邮箱平台现在怎么结合起来玩'), {
    agent: 'clerk-agent',
    action: 'mailbox-workbench',
  });
  assert.deepEqual(byText.get('同步 Obsidian 记忆库'), {
    agent: 'memory-agent',
    action: 'obsidian-sync',
  });
  assert.deepEqual(byText.get('烧 token 看新闻'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
  });
  assert.deepEqual(byText.get('文员，查看任务中枢主控脑'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
  });
});
