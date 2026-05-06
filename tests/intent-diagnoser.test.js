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

test('buildIntentDiagnosis explains todo-summary for today/failed-yesterday style requests', () => {
  const diagnosis = buildIntentDiagnosis(
    '昨天失败了什么',
    {
      agent: 'clerk-agent',
      action: 'todo-summary',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '整理项目待办与失败复盘');
  assert.equal(diagnosis.canExecute, true);
  assert.match(diagnosis.reason, /待办与失败复盘/);
  assert.match(diagnosis.nextStep, /未完成|失败项/);
});

test('buildIntentDiagnosis explains token-factory resume intent', () => {
  const diagnosis = buildIntentDiagnosis(
    '继续昨天没跑完的 token 工厂',
    {
      agent: 'clerk-agent',
      action: 'token-factory',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '推进 token 工厂流水线');
  assert.equal(diagnosis.canExecute, true);
  assert.match(diagnosis.reason, /继续推进 token 工厂/);
  assert.match(diagnosis.nextStep, /延续昨天未完成/);
});

test('buildIntentDiagnosis marks broad planner request as clarify', () => {
  const diagnosis = buildIntentDiagnosis(
    '把 UI 自动化、新闻、token 训练都安排一下',
    {
      agent: 'planner-agent',
      action: 'clarify',
      confidence: 'low',
      requiresAuth: false,
    },
  );

  assert.equal(diagnosis.outcome, 'clarify');
  assert.equal(diagnosis.canExecute, false);
  assert.match(diagnosis.reason, /范围较大/);
  assert.deepEqual(diagnosis.missing, ['scope', 'priority']);
});
