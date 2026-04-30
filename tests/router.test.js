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
  assert.deepEqual(routeAgentIntent('/watchdog'), { agent: 'ops-agent', action: 'watchdog', requiresAuth: true });
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
  assert.equal(routeAgentIntent('老师任务还差哪些').agent, 'doc-agent');
  assert.equal(routeAgentIntent('怎么让新 AI 接手').agent, 'doc-agent');
});

test('routeAgentIntent defaults to chat agent', () => {
  assert.deepEqual(routeAgentIntent('你好，今天状态怎么样'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});
