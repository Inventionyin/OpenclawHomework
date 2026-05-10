const {
  findRegisteredSkill,
  findRegisteredSkillByAction,
} = require('./skills/skill-registry');
const {
  evaluateSkillRisk,
} = require('./skills/skill-risk-gate');

function resolveRuntimeSkill(route = {}) {
  return findRegisteredSkill(route.sourceSkillId || route.skillId)
    || findRegisteredSkillByAction(route.action)
    || null;
}

function buildUnsupportedPlan(route = {}) {
  return {
    skillId: String(route.sourceSkillId || route.skillId || ''),
    name: '',
    agent: '',
    action: String(route.action || ''),
    riskLevel: 'unknown',
    autoRun: false,
    status: 'unsupported',
    nextStep: 'choose_registered_skill',
  };
}

function normalizeSkillExecutionPlan(route = {}) {
  const skill = resolveRuntimeSkill(route);
  if (!skill) {
    return buildUnsupportedPlan(route);
  }

  const risk = evaluateSkillRisk({
    ...route,
    sourceSkillId: route.sourceSkillId || route.skillId || skill.id,
    skillId: route.skillId || skill.id,
    action: route.action || skill.action,
  });
  const riskLevel = risk.riskLevel || skill.riskLevel || 'medium';
  const autoRun = Boolean(skill.autoRun);
  const status = riskLevel === 'low' && autoRun && risk.allowed && !risk.requiresConfirmation
    ? 'executable'
    : 'needs_confirmation';

  return {
    skillId: skill.id,
    name: skill.name,
    agent: skill.agent,
    action: skill.action,
    riskLevel,
    autoRun,
    status,
    nextStep: status === 'executable' ? 'execute_skill' : 'request_confirmation',
  };
}

module.exports = {
  normalizeSkillExecutionPlan,
  resolveRuntimeSkill,
};
