function decideIntentRoute(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top) return null;

  if (top.safety === 'blocked') {
    return {
      agent: 'planner-agent',
      action: 'clarify',
      confidence: 'low',
      reason: 'dangerous_intent',
      missing: top.missing && top.missing.length ? top.missing : ['confirmation'],
      requiresAuth: false,
    };
  }

  const second = sorted[1];
  if (second && top.safety === 'safe' && second.safety === 'safe' && Math.abs(top.score - second.score) < 0.05) {
    return {
      agent: 'planner-agent',
      action: 'clarify',
      confidence: 'low',
      reason: 'ambiguous_intent',
      missing: ['disambiguation'],
      requiresAuth: false,
    };
  }

  if (top.safety === 'clarify') {
    return {
      agent: 'planner-agent',
      action: 'clarify',
      confidence: 'low',
      reason: 'insufficient_context',
      missing: top.missing || [],
      requiresAuth: false,
    };
  }

  return {
    agent: top.agent,
    action: top.action,
    ...top.params,
    requiresAuth: Boolean(top.requiresAuth),
  };
}

module.exports = {
  decideIntentRoute,
};
