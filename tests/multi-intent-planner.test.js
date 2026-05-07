const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planMultiIntent,
  hasMultipleSafeIntents,
} = require('../scripts/agents/multi-intent-planner');

test('splits known low-risk combined intents into ordered sub-intents', () => {
  const text = '看看两台服务器内存硬盘，顺便看今天失败任务，再统计 token 用量';
  const plan = planMultiIntent(text);

  assert.equal(plan.isMultiIntent, true);
  assert.equal(plan.confidence, 'high');
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.intents.length, 3);
  assert.deepEqual(
    plan.intents.map((item) => item.action),
    ['load-summary', 'task-center-failed', 'token-summary']
  );
  assert.equal(hasMultipleSafeIntents(text), true);
});

test('daily email is not auto-executed as part of multi-intent plan', () => {
  const plan = planMultiIntent('看看今天失败任务，再发送今天日报到邮箱');

  assert.equal(plan.isMultiIntent, false);
  assert.deepEqual(plan.intents.map((item) => item.action), ['task-center-failed']);
  assert.equal(hasMultipleSafeIntents('看看今天失败任务，再发送今天日报到邮箱'), false);
});

test('ordinary today token and trend questions are not split by incidental words', () => {
  assert.equal(planMultiIntent('文员，统计今天 Hermes 和 OpenClaw 谁更费 token').isMultiIntent, false);
  assert.equal(planMultiIntent('今天有什么值得学的开源项目').isMultiIntent, false);
  assert.equal(planMultiIntent('文员，烧 token 看新闻').isMultiIntent, false);
});

test('dangerous combined ops are blocked and not treated as safe multi-intent', () => {
  const text = '重启服务并清理硬盘';
  const plan = planMultiIntent(text);

  assert.equal(plan.isMultiIntent, false);
  assert.equal(plan.intents.length, 0);
  assert.ok(plan.blocked.length >= 1);
  assert.equal(hasMultipleSafeIntents(text), false);
});

test('simple greeting is not multi-intent', () => {
  const text = '你好';
  const plan = planMultiIntent(text);

  assert.equal(plan.isMultiIntent, false);
  assert.equal(plan.intents.length, 0);
  assert.equal(plan.blocked.length, 0);
  assert.equal(hasMultipleSafeIntents(text), false);
});
