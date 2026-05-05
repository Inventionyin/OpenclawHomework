const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentEvalTasks,
  buildCustomerServiceCases,
  buildEmailPlaybook,
  buildSubmailboxRegistrationPool,
  buildUiAutomationMatrix,
} = require('../scripts/qa-assets');

test('buildAgentEvalTasks creates a balanced OpenClaw and Hermes evaluation set', () => {
  const tasks = buildAgentEvalTasks();

  assert.equal(tasks.length >= 80, true);
  assert(tasks.some((task) => task.assistant === 'OpenClaw' && task.expectedRoute === 'ui-test-agent'));
  assert(tasks.some((task) => task.assistant === 'Hermes' && task.expectedRoute === 'ops-agent'));
  assert(tasks.some((task) => task.expectedRoute === 'mailbox-agent'));
  assert(tasks.every((task) => task.id && task.prompt && task.rubric));
});

test('buildCustomerServiceCases covers ecommerce support workflows', () => {
  const cases = buildCustomerServiceCases();
  const topics = new Set(cases.map((item) => item.topic));

  assert.equal(cases.length >= 120, true);
  assert(topics.has('refund'));
  assert(topics.has('shipping'));
  assert(topics.has('coupon'));
  assert(topics.has('ai-support'));
  assert(cases.every((item) => item.customerMessage && item.expectedReply && item.scoring));
});

test('buildUiAutomationMatrix covers the ecommerce and AI support surfaces', () => {
  const matrix = buildUiAutomationMatrix();

  assert.equal(matrix.length >= 40, true);
  assert(matrix.some((item) => item.area === 'auth' && /邮箱/.test(item.scenario)));
  assert(matrix.some((item) => item.area === 'ai-support'));
  assert(matrix.some((item) => item.priority === 'P0'));
});

test('buildEmailPlaybook binds mailbox addresses to real QA actions', () => {
  const playbook = buildEmailPlaybook();

  assert.equal(playbook.length >= 10, true);
  assert(playbook.some((item) => item.mailbox === 'watchee.task@claw.163.com' && /触发/.test(item.action)));
  assert(playbook.some((item) => item.mailbox === 'evasan.verify@claw.163.com' && /验证码/.test(item.action)));
  assert(playbook.some((item) => item.mailbox === 'hagent.eval@claw.163.com' && /评测/.test(item.action)));
});

test('buildSubmailboxRegistrationPool separates registration-safe and internal mailboxes', () => {
  const pool = buildSubmailboxRegistrationPool();

  assert.equal(pool.length >= 6, true);
  assert(pool.some((item) => item.mailbox === 'evasan.verify@claw.163.com' && item.policy === 'allowed'));
  assert(pool.some((item) => item.group === 'archive' && item.policy === 'internal-only'));
  assert(pool.every((item) => item.platformRule && item.statusFields.includes('verification_result')));
});
