const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  applyMailApprovalAction,
  buildApprovalQueueFromMessages,
  getMailApprovalQueueFile,
  readMailApprovalQueue,
  writeMailApprovalQueue,
} = require('../scripts/mail-approval-queue');

test('buildApprovalQueueFromMessages keeps pending mail with stable indexes', () => {
  const queue = buildApprovalQueueFromMessages([
    {
      uid: 'm-1',
      from: 'candidate@example.com',
      subject: '应届生求职咨询',
      text: '我是一名大四应届毕业生，可以应聘测试岗位吗？',
    },
    {
      uid: 'm-2',
      from: 'noreply@example.com',
      subject: '验证码 123456',
      text: '验证码 123456',
    },
  ], { now: '2026-05-07T01:00:00.000Z' });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].id, 'm-1');
  assert.equal(queue.items[0].queueIndex, 1);
  assert.equal(queue.items[0].status, 'pending');
  assert.match(queue.items[0].draft, /你好/);
  assert.match(queue.items[0].draft, /测试岗位/);
});

test('applyMailApprovalAction approves ignores and converts to training data', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mail-approval-queue-'));
  const queueFile = join(tempDir, 'queue.json');
  try {
    writeMailApprovalQueue({
      updatedAt: '2026-05-07T01:00:00.000Z',
      items: buildApprovalQueueFromMessages([
        {
          uid: 'm-1',
          from: 'buyer@example.com',
          subject: '商品损坏退款',
          text: '商品坏了，我要退款。',
        },
        {
          uid: 'm-2',
          from: 'student@example.com',
          subject: '应届生求职咨询',
          text: '我可以应聘测试岗位吗？',
        },
      ]).items,
    }, queueFile);

    const approved = applyMailApprovalAction({ action: 'approve', index: 1 }, { queueFile, now: '2026-05-07T01:10:00.000Z' });
    assert.equal(approved.ok, true);
    assert.equal(approved.item.status, 'approved');
    assert.match(approved.reply, /已审批第 1 封/);
    assert.match(approved.reply, /只生成已审批草稿/);

    const ignored = applyMailApprovalAction({ action: 'ignore', index: 2 }, { queueFile, now: '2026-05-07T01:11:00.000Z' });
    assert.equal(ignored.ok, true);
    assert.equal(ignored.item.status, 'ignored');
    assert.match(ignored.reply, /已忽略第 2 封/);

    writeMailApprovalQueue({
      items: buildApprovalQueueFromMessages([{
        uid: 'm-3',
        from: 'support@example.com',
        subject: '客服咨询',
        text: '优惠券不能用怎么办？',
      }]).items,
    }, queueFile);
    const training = applyMailApprovalAction({ action: 'training-data', index: 1 }, { queueFile, now: '2026-05-07T01:12:00.000Z' });
    assert.equal(training.ok, true);
    assert.equal(training.item.status, 'training_data');
    assert.match(training.reply, /训练数据样本/);
    assert.match(training.trainingSample.answer, /客服/);

    const saved = readMailApprovalQueue(queueFile);
    assert.equal(saved.items[0].status, 'training_data');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getMailApprovalQueueFile resolves env override and default project path', () => {
  assert.equal(getMailApprovalQueueFile({ MAIL_APPROVAL_QUEUE_FILE: '/tmp/queue.json' }), '/tmp/queue.json');
  assert.match(getMailApprovalQueueFile({ LOCAL_PROJECT_DIR: '/project' }), /data[\\/]memory[\\/]mailbox-approval-queue\.json$/);
});

test('readMailApprovalQueue tolerates missing file', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mail-approval-missing-'));
  try {
    const file = join(tempDir, 'missing.json');
    assert.equal(existsSync(file), false);
    assert.deepEqual(readMailApprovalQueue(file), { items: [] });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
