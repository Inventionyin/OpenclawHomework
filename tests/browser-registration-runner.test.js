const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRegistrationPlan,
  loadPlatformRegistry,
  parseCliArgs,
  parseRegistrationTaskRequest,
} = require('../scripts/browser-registration-runner');

test('loadPlatformRegistry includes projectku-web as a first adapter', () => {
  const registry = loadPlatformRegistry();

  assert.ok(registry['projectku-web']);
  assert.equal(registry['projectku-web'].platformId, 'projectku-web');
  assert.equal(registry['projectku-web'].policy, 'self-owned');
  assert.equal(registry['projectku-web'].enabled, true);
});

test('parseRegistrationTaskRequest extracts platform and mailbox hints from natural language', () => {
  const parsed = parseRegistrationTaskRequest('文员，用 verify 邮箱给 projectku-web 跑一轮注册验证码测试');

  assert.equal(parsed.platformId, 'projectku-web');
  assert.equal(parsed.mailboxHint, 'verify');
  assert.equal(parsed.intent, 'registration-verification');
});

test('buildRegistrationPlan creates dry-run execution steps for allowed platforms', () => {
  const plan = buildRegistrationPlan({
    platformId: 'projectku-web',
    mailboxHint: 'verify',
  });

  assert.equal(plan.allowed, true);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.selectedMailbox.email, 'evasan.account@claw.163.com');
  assert.ok(plan.steps.length >= 6);
  assert.match(plan.steps[0], /打开/);
});

test('buildRegistrationPlan blocks unsupported external platforms by default', () => {
  const plan = buildRegistrationPlan({
    platformId: 'taobao',
    mailboxHint: 'verify',
  });

  assert.equal(plan.allowed, false);
  assert.match(plan.reason, /未在允许列表/);
});

test('parseCliArgs supports explicit platform and mailbox flags', () => {
  const parsed = parseCliArgs(['--platform', 'projectku-web', '--mailbox', 'verify']);

  assert.equal(parsed.platformId, 'projectku-web');
  assert.equal(parsed.mailboxHint, 'verify');
});
