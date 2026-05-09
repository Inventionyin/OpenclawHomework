const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSkillRisk,
} = require('../scripts/skills/skill-risk-gate');
const {
  listRegisteredSkills,
  findRegisteredSkill,
  buildRegisteredSkillMenu,
} = require('../scripts/skills/skill-registry');
const {
  routeSkillIntent,
} = require('../scripts/skills/skill-router');

test('skill registry exposes workflow enhancement skills with risk metadata', () => {
  const skills = listRegisteredSkills();
  const ids = skills.map((skill) => skill.id);

  assert.ok(ids.includes('research-dev-loop'));
  assert.ok(ids.includes('web-fetch-summary'));
  assert.ok(ids.includes('skill-flow'));
  assert.ok(ids.includes('daily-email'));
  assert.ok(ids.includes('ui-automation-run'));
  assert.ok(ids.includes('dify-testing-assistant'));
  assert.ok(ids.includes('trend-intel'));
  assert.ok(ids.includes('trend-token-factory'));
  assert.ok(ids.includes('token-factory'));
  assert.ok(ids.includes('command-center'));
  assert.ok(ids.includes('todo-summary'));
  assert.ok(ids.includes('mailbox-workbench'));
  assert.ok(ids.includes('mailbox-approvals'));
  assert.ok(ids.includes('server-ops-status'));

  assert.equal(findRegisteredSkill('research-dev-loop').riskLevel, 'medium');
  assert.equal(findRegisteredSkill('web-fetch-summary').autoRun, true);
  assert.equal(findRegisteredSkill('skill-flow').requiresAuth, true);
  assert.equal(findRegisteredSkill('daily-email').riskLevel, 'medium');
  assert.equal(findRegisteredSkill('ui-automation-run').riskLevel, 'medium');
  assert.equal(findRegisteredSkill('dify-testing-assistant').riskLevel, 'low');
  assert.equal(findRegisteredSkill('command-center').autoRun, true);
  assert.equal(findRegisteredSkill('server-ops-status').agent, 'ops-agent');
  assert.equal(findRegisteredSkill('trend-intel').category, '热点学习');
  assert.equal(findRegisteredSkill('mailbox-workbench').category, '邮箱协同');
});

test('skill registry builds categorized pro menu from registered skills', () => {
  const menu = buildRegisteredSkillMenu({ mode: 'pro' });

  assert.match(menu, /Skill 总控菜单/);
  assert.match(menu, /热点学习/);
  assert.match(menu, /邮箱协同/);
  assert.match(menu, /UI 自动化执行/);
  assert.match(menu, /触发：/);
  assert.match(menu, /风险：medium/);
  assert.match(menu, /执行：自动|执行：手动/);
});

test('skill router selects the safest matching skill from natural language', () => {
  assert.deepEqual(routeSkillIntent('文员，抓一下 https://github.com/microsoft/RD-Agent 正文'), {
    agent: 'clerk-agent',
    action: 'web-content-fetch',
    skillId: 'web-fetch-summary',
    url: 'https://github.com/microsoft/RD-Agent',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('文员，启动 RD-Agent-lite 研发循环，优化 UI 自动化失败复盘'), {
    agent: 'clerk-agent',
    action: 'research-dev-loop',
    skillId: 'research-dev-loop',
    goal: '优化 UI 自动化失败复盘',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });

  assert.deepEqual(routeSkillIntent('文员，按 ui-automation 技能跑一轮流程'), {
    agent: 'clerk-agent',
    action: 'skill-flow',
    skillId: 'ui-automation',
    sourceSkillId: 'skill-flow',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });
});

test('skill router keeps browser and protocol requests out of web fetch skill', () => {
  assert.equal(routeSkillIntent('抓一下 https://evanshine.me 的接口和 CDP 协议'), null);
});

test('skill router selects office testing and proactive skills', () => {
  assert.deepEqual(routeSkillIntent('把今天日报发到 1693457391@qq.com'), {
    agent: 'clerk-agent',
    action: 'daily-email',
    skillId: 'daily-email',
    recipientEmail: '1693457391@qq.com',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });

  assert.deepEqual(routeSkillIntent('帮我跑一下 main 分支的 UI 自动化冒烟测试'), {
    agent: 'ui-test-agent',
    action: 'run',
    skillId: 'ui-automation-run',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });

  assert.deepEqual(routeSkillIntent('请根据需求文档生成测试用例'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
    skillId: 'dify-testing-assistant',
    query: '请根据需求文档生成测试用例',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('今天有什么值得学的开源项目'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    skillId: 'trend-intel',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('烧 token 看新闻'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    skillId: 'trend-token-factory',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });
});

test('skill router selects command center todo mailbox and ops status skills', () => {
  assert.deepEqual(routeSkillIntent('给我一屏看懂今天项目'), {
    agent: 'clerk-agent',
    action: 'command-center',
    skillId: 'command-center',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('整理一下今天待办'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    skillId: 'todo-summary',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('邮箱平台怎么玩'), {
    agent: 'clerk-agent',
    action: 'mailbox-workbench',
    skillId: 'mailbox-workbench',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });

  assert.deepEqual(routeSkillIntent('列出待审批邮件'), {
    agent: 'clerk-agent',
    action: 'mailbox-approvals',
    skillId: 'mailbox-approvals',
    requiresAuth: true,
    riskLevel: 'medium',
    autoRun: false,
  });

  assert.deepEqual(routeSkillIntent('你现在内存多少硬盘多少'), {
    agent: 'ops-agent',
    action: 'load-summary',
    skillId: 'server-ops-status',
    target: 'self',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });
});

test('skill router keeps broad menu phrases available for capability guide', () => {
  assert.equal(routeSkillIntent('大神版菜单'), null);
  assert.deepEqual(routeSkillIntent('邮箱平台怎么玩'), {
    agent: 'clerk-agent',
    action: 'mailbox-workbench',
    skillId: 'mailbox-workbench',
    requiresAuth: true,
    riskLevel: 'low',
    autoRun: true,
  });
});

test('skill risk gate separates automatic low risk and confirmable medium risk skills', () => {
  assert.deepEqual(evaluateSkillRisk({
    action: 'web-content-fetch',
    skillId: 'web-fetch-summary',
  }), {
    allowed: true,
    requiresConfirmation: false,
    riskLevel: 'low',
    reason: 'low_risk_autorun',
  });

  assert.deepEqual(evaluateSkillRisk({
    action: 'research-dev-loop',
    skillId: 'research-dev-loop',
  }), {
    allowed: true,
    requiresConfirmation: false,
    riskLevel: 'medium',
    reason: 'explicit_skill_request',
  });

  assert.deepEqual(evaluateSkillRisk({
    action: 'skill-flow',
    skillId: '',
    sourceSkillId: 'skill-flow',
  }), {
    allowed: false,
    requiresConfirmation: false,
    riskLevel: 'medium',
    reason: 'missing_skill_id',
  });
});
