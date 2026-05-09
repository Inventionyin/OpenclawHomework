const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateSkillRisk,
} = require('../scripts/skills/skill-risk-gate');
const {
  listRegisteredSkills,
  findRegisteredSkill,
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

  assert.equal(findRegisteredSkill('research-dev-loop').riskLevel, 'medium');
  assert.equal(findRegisteredSkill('web-fetch-summary').autoRun, true);
  assert.equal(findRegisteredSkill('skill-flow').requiresAuth, true);
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
