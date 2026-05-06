const test = require('node:test');
const assert = require('node:assert/strict');

const { loadMailboxActionConfig } = require('../scripts/mailbox-action-config');

test('loadMailboxActionConfig returns first-phase actions from default config file', () => {
  const config = loadMailboxActionConfig();

  assert.equal(config.version, 1);
  assert.equal(config.actions.report.mailbox, 'watchee.report@claw.163.com');
  assert.equal(config.actions.replay.mailbox, 'evasan.replay@claw.163.com');
  assert.equal(config.actions.files.mailbox, 'agent3.files@claw.163.com');
  assert.equal(config.actions.daily.mailbox, 'agent4.daily@claw.163.com');
  assert.equal(config.actions.account.mailbox, 'evasan.account@claw.163.com');
  assert.equal(config.actions.shop.mailbox, 'evasan.shop@claw.163.com');
  assert.equal(config.actions.support.mailbox, 'agent4.support@claw.163.com');
  assert.equal(config.actions.task.mailbox, 'watchee.ui@claw.163.com');
  assert.equal(config.actions.eval.mailbox, 'agent4.archive@claw.163.com');
  assert.equal(config.actions.verify.mailbox, 'evasan.account@claw.163.com');
  assert.equal(config.actions.archive.mailbox, 'agent4.archive@claw.163.com');
});
