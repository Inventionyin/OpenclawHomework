const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planMultiIntent,
  hasMultipleSafeIntents,
} = require('../scripts/agents/multi-intent-planner');

test('splits known low-risk combined intents into ordered sub-intents', () => {
  const text = '看看两台服务器内存硬盘，顺便看今天失败任务，再发我邮箱';
  const plan = planMultiIntent(text);

  assert.equal(plan.isMultiIntent, true);
  assert.equal(plan.confidence, 'high');
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.intents.length, 3);
  assert.deepEqual(
    plan.intents.map((item) => item.action),
    ['load-summary', 'task-center-failed', 'daily-email']
  );
  assert.equal(hasMultipleSafeIntents(text), true);
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
