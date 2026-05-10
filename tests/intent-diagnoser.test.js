const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIntentDiagnosis,
  buildExecutionDiagnosisCard,
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
  assert.match(diagnosis.reason, /这次先不执行|先没执行/);
  assert.match(diagnosis.nextStep, /你现在内存多少|看看 Hermes 的服务器状态/);
  assert.doesNotMatch(diagnosis.nextStep, /unknown|guide/i);
});

test('buildIntentDiagnosis supports natural tone for low-confidence ops clarification', () => {
  const diagnosis = buildIntentDiagnosis(
    '那个你帮我搞一下',
    {
      agent: 'ops-agent',
      action: 'clarify',
      target: 'unknown',
      confidence: 'low',
      requiresAuth: true,
    },
    { tone: 'natural' },
  );

  assert.equal(diagnosis.intentLabel, '服务器运维操作');
  assert.equal(diagnosis.canExecute, false);
  assert.match(diagnosis.reason, /这句有点宽/);
  assert.doesNotMatch(diagnosis.reason, /我理解你想做的是|这次先不执行/);
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

test('buildIntentDiagnosis explains short continuation context requests', () => {
  const diagnosis = buildIntentDiagnosis(
    '继续',
    {
      agent: 'clerk-agent',
      action: 'continue-context',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '继续最近项目上下文');
  assert.equal(diagnosis.canExecute, true);
  assert.match(diagnosis.reason, /最近上下文/);
  assert.match(diagnosis.nextStep, /任务中枢|趋势雷达/);
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

test('buildIntentDiagnosis creates precise browser clue card for live page debugging', () => {
  const diagnosis = buildIntentDiagnosis(
    '真实执行打开 https://shop.evanshine.me/login 页面检查，截图，抓 console，抓接口',
    {
      agent: 'browser-agent',
      action: 'browser-live-run',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.intentLabel, '浏览器/CDP 页面定位');
  assert.equal(diagnosis.canExecute, true);
  assert.equal(diagnosis.clueCard.targetUrl, 'https://shop.evanshine.me/login');
  assert.equal(diagnosis.clueCard.executionMode, '真实浏览器/CDP 执行');
  assert(diagnosis.clueCard.matchedSignals.includes('截图'));
  assert(diagnosis.clueCard.matchedSignals.includes('console'));
  assert(diagnosis.clueCard.matchedSignals.includes('接口/抓包'));
  assert.match(diagnosis.nextStep, /截图|console|协议资产/);
});

test('buildIntentDiagnosis asks for target url when browser request is too vague', () => {
  const diagnosis = buildIntentDiagnosis(
    '这个 CTF 页面怎么下手，帮我定位一下',
    {
      agent: 'browser-agent',
      action: 'browser-dry-run',
      requiresAuth: true,
    },
  );

  assert.equal(diagnosis.outcome, 'clarify');
  assert.equal(diagnosis.canExecute, false);
  assert.deepEqual(diagnosis.missing, ['targetUrl']);
  assert.match(diagnosis.reason, /缺少目标 URL/);
  assert.match(diagnosis.nextStep, /CTF 靶场地址/);
});

test('buildExecutionDiagnosisCard explains selected skill metadata before execution', () => {
  const card = buildExecutionDiagnosisCard('把今天日报发到 1693457391@qq.com', {
    agent: 'clerk-agent',
    action: 'daily-email',
    skillId: 'daily-email',
    recipientEmail: '1693457391@qq.com',
    confidence: 'high',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
  });

  assert.match(card, /执行前识别/);
  assert.match(card, /日报邮件/);
  assert.match(card, /clerk-agent \/ daily-email/);
  assert.match(card, /置信度：high/);
  assert.match(card, /风险：medium/);
  assert.match(card, /执行方式：需要明确指令/);
  assert.match(card, /触发依据：发送日报|发到邮箱/);
  assert.match(card, /收件人：1693457391@qq\.com/);
});

test('buildExecutionDiagnosisCard explains non-skill capability and task brain routes', () => {
  const capabilityCard = buildExecutionDiagnosisCard('大神版菜单', {
    agent: 'capability-agent',
    action: 'guide',
    mode: 'pro',
    requiresAuth: false,
  });

  assert.match(capabilityCard, /能力菜单/);
  assert.match(capabilityCard, /capability-agent \/ guide/);
  assert.match(capabilityCard, /Skill：无（非注册 skill 路由）/);
  assert.match(capabilityCard, /无需授权/);

  const brainCard = buildExecutionDiagnosisCard('看看总控脑', {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });

  assert.match(brainCard, /任务中枢主控脑/);
  assert.match(brainCard, /clerk-agent \/ task-center-brain/);
  assert.match(brainCard, /Skill：无（非注册 skill 路由）/);
  assert.match(brainCard, /需要授权/);
});
