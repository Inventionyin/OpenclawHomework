const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildMailWorkbenchReport,
  classifyMailMessage,
  extractPendingApprovalItems,
  formatMailWorkbenchReply,
} = require('../scripts/mail-workbench');

test('classifyMailMessage maps common ClawEmail workbench categories', () => {
  assert.equal(classifyMailMessage({
    from: 'student@example.com',
    subject: '应届生求职咨询',
    text: '你好，我是一名大四应届毕业生，可以应聘测试岗位吗？',
  }).category, 'recruitment');

  assert.equal(classifyMailMessage({
    from: 'buyer@example.com',
    subject: '订单售后',
    text: '商品损坏了，我要退款或者换货。',
  }).category, 'after-sales');

  assert.equal(classifyMailMessage({
    from: 'noreply@example.com',
    subject: '验证码 123456',
    text: '你的注册验证码是 123456，5 分钟内有效。',
  }).category, 'verification');

  assert.equal(classifyMailMessage({
    from: 'watchdog@claw.163.com',
    subject: '系统告警：Hermes bridge unhealthy',
    text: 'health check failed',
  }).category, 'system-alert');

  assert.equal(classifyMailMessage({
    from: 'promo@example.com',
    subject: '限时中奖贷款优惠',
    text: '点击领取大奖',
  }).category, 'spam-abnormal');
});

test('buildMailWorkbenchReport combines inbox and outgoing ledger into ClawEmail style summary', () => {
  const report = buildMailWorkbenchReport({
    assistant: 'Hermes',
    day: '2026-05-07',
    inboxMessages: [
      {
        uid: 'm-1',
        mailbox: 'shine1@claw.163.com',
        from: 'student@example.com',
        subject: '应届生求职咨询',
        date: '2026-05-07T02:00:00.000Z',
        text: '你好，我是一名大四应届毕业生，可以应聘测试岗位吗？',
      },
      {
        uid: 'm-2',
        mailbox: 'shine1@claw.163.com',
        from: 'noreply@example.com',
        subject: '验证码 123456',
        date: '2026-05-07T02:01:00.000Z',
        text: '你的注册验证码是 123456。',
      },
    ],
    mailEntries: [
      {
        timestamp: '2026-05-07T01:00:00.000Z',
        assistant: 'Hermes',
        action: 'daily',
        sent: true,
        externalTo: ['1693457391@qq.com'],
        archiveTo: ['agent4.daily@claw.163.com'],
      },
      {
        timestamp: '2026-05-07T01:10:00.000Z',
        assistant: 'Hermes',
        action: 'report',
        sent: false,
        reason: 'smtp timeout',
        to: ['agent4.archive@claw.163.com'],
      },
    ],
  });

  assert.equal(report.summary.received, 2);
  assert.equal(report.summary.sent, 1);
  assert.equal(report.summary.failedSent, 1);
  assert.equal(report.summary.pendingApproval, 1);
  assert.equal(report.categories.recruitment, 1);
  assert.equal(report.categories.verification, 1);
  assert.match(report.text, /Hermes ClawEmail 邮箱工作台/);
  assert.match(report.text, /收信 2 封/);
  assert.match(report.text, /待审批 1 封/);
  assert.match(report.text, /应届生求职咨询/);
  assert.match(report.html, /ClawEmail/);
  assert.match(report.html, /前往后台/);
});

test('extractPendingApprovalItems returns only human approval mail', () => {
  const pending = extractPendingApprovalItems([
    {
      uid: 'm-1',
      from: 'buyer@example.com',
      subject: '退款处理',
      text: '我要退款',
    },
    {
      uid: 'm-2',
      from: 'noreply@example.com',
      subject: '验证码 123456',
      text: '验证码',
    },
  ]);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'm-1');
  assert.equal(pending[0].category, 'after-sales');
});

test('formatMailWorkbenchReply renders pending approval list naturally', () => {
  const reply = formatMailWorkbenchReply(buildMailWorkbenchReport({
    assistant: 'OpenClaw',
    day: '2026-05-07',
    inboxMessages: [
      {
        uid: 'm-1',
        from: 'partner@example.com',
        subject: '商务合作咨询',
        text: '想和你们合作做测试平台。',
      },
    ],
    mailEntries: [],
  }), { mode: 'pending' });

  assert.match(reply, /待审批邮件/);
  assert.match(reply, /商务合作咨询/);
  assert.match(reply, /审批第 1 封/);
});
