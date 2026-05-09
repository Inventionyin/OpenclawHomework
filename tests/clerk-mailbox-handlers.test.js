const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');

const {
  buildClerkMailboxReply,
  isClerkMailboxAction,
} = require('../scripts/agents/clerk/mailbox-handlers');

test('isClerkMailboxAction identifies extracted mailbox actions', () => {
  assert.equal(isClerkMailboxAction('mailbox-workbench'), true);
  assert.equal(isClerkMailboxAction('mailbox-approvals'), true);
  assert.equal(isClerkMailboxAction('mailbox-approval-action'), true);
  assert.equal(isClerkMailboxAction('mailbox-daily-report'), true);
  assert.equal(isClerkMailboxAction('mailbox-tasks'), true);
  assert.equal(isClerkMailboxAction('mail-ledger'), true);
  assert.equal(isClerkMailboxAction('token-factory'), false);
});

test('buildClerkMailboxReply renders workbench approvals daily report and ledger', () => {
  const now = new Date('2026-05-07T12:00:00.000Z');
  const inbox = [
    {
      uid: 'm-1',
      from: 'buyer@example.com',
      subject: '退款处理',
      text: '我要退款',
    },
  ];
  const ledger = [
    {
      timestamp: '2026-05-07T01:00:00.000Z',
      assistant: 'Hermes',
      action: 'daily',
      sent: true,
      externalTo: ['1693457391@qq.com'],
    },
  ];
  const options = {
    readInboxMessages: () => inbox,
    readMailLedger: () => ledger,
    env: { FEISHU_ASSISTANT_NAME: 'Hermes' },
    now,
  };

  const workbenchReply = buildClerkMailboxReply({ action: 'mailbox-workbench' }, options);
  assert.match(workbenchReply, /邮箱工作台/);
  assert.match(workbenchReply, /待审批 1 封/);
  assert.match(workbenchReply, /邮箱动作绑定/);

  const approvalsReply = buildClerkMailboxReply({ action: 'mailbox-approvals' }, options);
  assert.match(approvalsReply, /待审批邮件/);
  assert.match(approvalsReply, /退款处理/);

  const dailyReply = buildClerkMailboxReply({ action: 'mailbox-daily-report' }, options);
  assert.match(dailyReply, /ClawEmail 每日报告预览/);
  assert.match(dailyReply, /成功发信 1 封/);

  const ledgerReply = buildClerkMailboxReply({ action: 'mail-ledger' }, options);
  assert.match(ledgerReply, /邮件发送账本/);
  assert.match(ledgerReply, /1693457391@qq.com/);
});

test('buildClerkMailboxReply handles approval actions with isolated queue file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-mailbox-'));
  const reply = buildClerkMailboxReply({
    action: 'mailbox-approval-action',
    approvalAction: 'approve',
    index: 1,
  }, {
    readInboxMessages: () => [
      {
        uid: 'm-1',
        from: 'buyer@example.com',
        subject: '退款处理',
        text: '我要退款',
      },
    ],
    readMailLedger: () => [],
    env: {
      LOCAL_PROJECT_DIR: dir,
      MAIL_APPROVAL_QUEUE_FILE: join(dir, 'mail-approval-queue.json'),
    },
    now: new Date('2026-05-07T12:00:00.000Z'),
  });

  assert.match(reply, /已审批第 1 封/);
  assert.match(reply, /不会自动对外发信/);
});
