const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExecutionPlanCard,
} = require('../scripts/execution-plan-card');

test('low risk skill route renders readable executable card', () => {
  const card = buildExecutionPlanCard({
    skillId: 'trend-intel',
    action: 'trend-intel',
  });

  assert.match(card, /执行计划卡/);
  assert.match(card, /目标能力：热点和开源学习雷达/);
  assert.match(card, /路由：trend-intel/);
  assert.match(card, /Skill：trend-intel/);
  assert.match(card, /风险：low/);
  assert.match(card, /执行方式：自动执行/);
  assert.match(card, /下一步：执行 skill/);
});

test('medium risk skill route renders confirmation card', () => {
  const card = buildExecutionPlanCard({
    skillId: 'ui-automation-run',
    action: 'run',
  });

  assert.match(card, /目标能力：UI 自动化执行/);
  assert.match(card, /路由：run/);
  assert.match(card, /Skill：ui-automation-run/);
  assert.match(card, /风险：medium/);
  assert.match(card, /执行方式：需要确认/);
  assert.match(card, /下一步：请求确认/);
});

test('browser observe route renders runtime card with step summary', () => {
  const card = buildExecutionPlanCard({
    action: 'browser-observe',
    targetUrl: 'https://shop.evanshine.me/login',
    instruction: '观察登录页结构',
  });

  assert.match(card, /Browser Runtime/);
  assert.match(card, /操作：observe/);
  assert.match(card, /目标：https:\/\/shop\.evanshine\.me\/login/);
  assert.match(card, /状态：可计划/);
  assert.match(card, /步骤摘要：/);
  assert.match(card, /navigate/);
  assert.match(card, /observe_dom/);
});

test('legacy browser dry-run route renders observe runtime card', () => {
  const card = buildExecutionPlanCard({
    agent: 'browser-agent',
    action: 'browser-dry-run',
    rawText: '观察 https://shop.evanshine.me/login 页面结构',
  });

  assert.match(card, /Browser Runtime/);
  assert.match(card, /操作：observe/);
  assert.match(card, /目标：https:\/\/shop\.evanshine\.me\/login/);
  assert.match(card, /observe_dom/);
});

test('blocked browser route renders blocker reason', () => {
  const card = buildExecutionPlanCard({
    action: 'browser-observe',
    targetUrl: 'https://www.jd.com',
    instruction: '观察商品页',
  });

  assert.match(card, /Browser Runtime/);
  assert.match(card, /操作：observe/);
  assert.match(card, /状态：已拦截/);
  assert.match(card, /原因：Blocked: external ecommerce targets are outside the self-owned allowlist\./);
});

test('unknown route returns short unregistered capability diagnostic', () => {
  const card = buildExecutionPlanCard({
    action: 'missing-action',
  });

  assert.match(card, /非注册能力/);
  assert.match(card, /missing-action/);
  assert.doesNotThrow(() => buildExecutionPlanCard({ action: 'missing-action' }));
});

test('execution plan card redacts secret-like values', () => {
  const card = buildExecutionPlanCard({
    action: 'browser-observe',
    targetUrl: 'https://shop.evanshine.me/login?token=sk-proj-secretvalue123456789',
    instruction: 'key=ak_secretvalue123456 password=hunter2 ck_live_secretvalue123456',
  });

  assert.match(card, /\[redacted\]/);
  assert.doesNotMatch(card, /sk-proj-secretvalue123456789/);
  assert.doesNotMatch(card, /ak_secretvalue123456/);
  assert.doesNotMatch(card, /hunter2/);
  assert.doesNotMatch(card, /ck_live_secretvalue123456/);
});
