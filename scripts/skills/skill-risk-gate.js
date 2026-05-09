const {
  findRegisteredSkill,
  findRegisteredSkillByAction,
} = require('./skill-registry');

function resolveSkill(route = {}) {
  return findRegisteredSkill(route.sourceSkillId || route.skillId)
    || findRegisteredSkillByAction(route.action)
    || null;
}

function evaluateSkillRisk(route = {}) {
  const skill = resolveSkill(route);
  const riskLevel = skill?.riskLevel || route.riskLevel || 'medium';

  if (route.action === 'skill-flow' && !route.skillId) {
    return {
      allowed: false,
      requiresConfirmation: false,
      riskLevel,
      reason: 'missing_skill_id',
    };
  }

  if (riskLevel === 'high') {
    return {
      allowed: false,
      requiresConfirmation: true,
      riskLevel,
      reason: 'high_risk_requires_confirmation',
    };
  }

  if (riskLevel === 'low' && skill?.autoRun) {
    return {
      allowed: true,
      requiresConfirmation: false,
      riskLevel,
      reason: 'low_risk_autorun',
    };
  }

  return {
    allowed: true,
    requiresConfirmation: false,
    riskLevel,
    reason: 'explicit_skill_request',
  };
}

module.exports = {
  evaluateSkillRisk,
  resolveSkill,
};
