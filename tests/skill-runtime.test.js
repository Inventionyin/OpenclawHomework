const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSkillExecutionPlan,
} = require('../scripts/skill-runtime');

test('low-risk autorun skill route becomes executable plan', () => {
  const plan = normalizeSkillExecutionPlan({
    skillId: 'trend-intel',
    action: 'trend-intel',
  });

  assert.equal(plan.skillId, 'trend-intel');
  assert.equal(plan.name, '热点和开源学习雷达');
  assert.equal(plan.agent, 'clerk-agent');
  assert.equal(plan.action, 'trend-intel');
  assert.equal(plan.riskLevel, 'low');
  assert.equal(plan.autoRun, true);
  assert.equal(plan.status, 'executable');
  assert.equal(plan.nextStep, 'execute_skill');
});

test('medium-risk skill route becomes confirmation plan', () => {
  const plan = normalizeSkillExecutionPlan({
    skillId: 'ui-automation-run',
    action: 'run',
  });

  assert.equal(plan.skillId, 'ui-automation-run');
  assert.equal(plan.name, 'UI 自动化执行');
  assert.equal(plan.agent, 'ui-test-agent');
  assert.equal(plan.action, 'run');
  assert.equal(plan.riskLevel, 'medium');
  assert.equal(plan.autoRun, false);
  assert.equal(plan.status, 'needs_confirmation');
  assert.equal(plan.nextStep, 'request_confirmation');
});

test('missing skill route becomes unsupported plan', () => {
  const plan = normalizeSkillExecutionPlan({
    skillId: 'missing-skill',
    action: 'missing-action',
  });

  assert.equal(plan.skillId, 'missing-skill');
  assert.equal(plan.name, '');
  assert.equal(plan.agent, '');
  assert.equal(plan.action, 'missing-action');
  assert.equal(plan.riskLevel, 'unknown');
  assert.equal(plan.autoRun, false);
  assert.equal(plan.status, 'unsupported');
  assert.equal(plan.nextStep, 'choose_registered_skill');
});

test('runtime resolves registered skill by action when skill id is absent', () => {
  const plan = normalizeSkillExecutionPlan({
    action: 'obsidian-sync',
  });

  assert.equal(plan.skillId, 'obsidian-memory-sync');
  assert.equal(plan.name, 'Obsidian 记忆同步');
  assert.equal(plan.agent, 'memory-agent');
  assert.equal(plan.action, 'obsidian-sync');
  assert.equal(plan.riskLevel, 'low');
  assert.equal(plan.autoRun, true);
  assert.equal(plan.status, 'executable');
  assert.equal(plan.nextStep, 'execute_skill');
});
