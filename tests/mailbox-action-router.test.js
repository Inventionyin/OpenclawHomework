const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMailboxAction } = require('../scripts/mailbox-action-router');

test('resolveMailboxAction returns configured mailbox metadata', () => {
  const resolved = resolveMailboxAction('report');
  assert.equal(resolved.mailbox, 'watchee.report@claw.163.com');
  assert.equal(resolved.subjectPrefix, '[OpenClaw Report]');
  assert.equal(resolved.enabled, true);
});

test('resolveMailboxAction prefers env override', () => {
  const resolved = resolveMailboxAction('report', {
    MAILBOX_ACTION_REPORT_TO: 'override@example.com',
  });
  assert.equal(resolved.mailbox, 'override@example.com');
});

test('resolveMailboxAction returns skipped metadata when action is disabled', () => {
  const resolved = resolveMailboxAction('daily', {}, {
    version: 1,
    actions: {
      daily: {
        mailbox: 'agent4.daily@claw.163.com',
        subjectPrefix: '[Daily Summary]',
        description: 'daily',
        enabled: false,
      },
    },
  });

  assert.equal(resolved.enabled, false);
  assert.equal(resolved.skipReason, 'disabled');
});
