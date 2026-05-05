const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIntentDiagnosis,
} = require('../scripts/agents/intent-diagnoser');

test('buildIntentDiagnosis explains invalid daily email recipient clearly', () => {
  const diagnosis = buildIntentDiagnosis(
    '文员，把今日日报发给 1693457391@.com',
    {
      agent: 'clerk-agent',
      action: 'daily-email-invalid-recipient',
      invalidRecipient: '1693457391@.com',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '发送今日日报到邮箱');
  assert.equal(diagnosis.canExecute, false);
  assert.match(diagnosis.reason, /邮箱格式不对/);
  assert.match(diagnosis.nextStep, /1693457391@qq\.com/);
});

test('buildIntentDiagnosis explains low-confidence ops request with clearer next step', () => {
  const diagnosis = buildIntentDiagnosis(
    '那个你帮我搞一下',
    {
      agent: 'ops-agent',
      action: 'clarify',
      target: 'unknown',
      confidence: 'low',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '服务器运维操作');
  assert.equal(diagnosis.canExecute, false);
  assert.match(diagnosis.reason, /我还不能确定/);
  assert.match(diagnosis.nextStep, /你现在内存多少|看看 Hermes 的服务器状态/);
});

test('buildIntentDiagnosis explains that daily report route is a preview not a send', () => {
  const diagnosis = buildIntentDiagnosis(
    '文员，把今天 UI 自动化结果发到邮箱',
    {
      agent: 'clerk-agent',
      action: 'daily-report',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '查看日报预览');
  assert.equal(diagnosis.canExecute, false);
  assert.match(diagnosis.reason, /我先按预览理解/);
  assert.match(diagnosis.nextStep, /发送今天日报到邮箱/);
});
