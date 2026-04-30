const assert = require('node:assert/strict');
const test = require('node:test');

const {
  routeAgentIntent,
} = require('../scripts/agents/router');

test('routeAgentIntent routes UI automation requests', () => {
  assert.equal(routeAgentIntent('/run-ui-test main smoke').agent, 'ui-test-agent');
  assert.equal(routeAgentIntent('帮我跑一下 main 分支的 UI 自动化冒烟测试').agent, 'ui-test-agent');
});

test('routeAgentIntent routes safe ops commands', () => {
  assert.deepEqual(routeAgentIntent('/status'), { agent: 'ops-agent', action: 'status', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/health'), { agent: 'ops-agent', action: 'health', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/watchdog'), { agent: 'ops-agent', action: 'watchdog', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/logs'), { agent: 'ops-agent', action: 'logs', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('@OpenClaw UI 自动化助手 /status'), {
    agent: 'ops-agent',
    action: 'status',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes memory commands', () => {
  assert.deepEqual(routeAgentIntent('/memory'), { agent: 'memory-agent', action: 'show', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/memory remember 今天修复了 session lock'), {
    agent: 'memory-agent',
    action: 'remember',
    note: '今天修复了 session lock',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes documentation questions', () => {
  assert.deepEqual(routeAgentIntent('老师任务还差哪些'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.equal(routeAgentIntent('怎么让新 AI 接手').agent, 'doc-agent');
  assert.equal(routeAgentIntent('GitHub Actions workflow 文档在哪').agent, 'doc-agent');
});

test('routeAgentIntent defaults to chat agent', () => {
  assert.deepEqual(routeAgentIntent('你好，今天状态怎么样'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('系统运行正常吗'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('这个 UI 怎么设计'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});

test('routeAgentIntent keeps memory and explicit UI test boundaries', () => {
  assert.deepEqual(routeAgentIntent('记住 workflow 今天失败了'), {
    agent: 'memory-agent',
    action: 'show',
    requiresAuth: true,
  });
  assert.equal(routeAgentIntent('帮我跑测试').agent, 'ui-test-agent');
});

test('routeAgentIntent prioritizes imperative test runs over fuzzy docs', () => {
  assert.deepEqual(routeAgentIntent('帮我跑测试并更新文档'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('请执行冒烟测试'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('触发 UI 自动化测试'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
});

test('routeAgentIntent does not run tests for questions negations or failure discussion', () => {
  assert.deepEqual(routeAgentIntent('如何运行测试'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('不要运行测试'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('不要 /run-ui-test main smoke'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('如何使用 /run-ui-test main smoke'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('contract test failure 怎么办'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});
