function normalizeText(text) {
  return extractCommandText(String(text ?? '').trim()).replace(/^@\S+\s*/, '');
}

function extractCommandText(text) {
  const commandMatch = text.match(/\/(?:status|health|watchdog|logs|memory|run-ui-test)\b/i);
  if (!commandMatch) {
    return text;
  }
  return text.slice(commandMatch.index).trim();
}

function routeAgentIntent(text) {
  const normalized = normalizeText(text);

  if (/^\/status\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'status', requiresAuth: true };
  }
  if (/^\/health\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'health', requiresAuth: true };
  }
  if (/^\/watchdog\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'watchdog', requiresAuth: true };
  }
  if (/^\/logs\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'logs', requiresAuth: true };
  }

  const rememberMatch = normalized.match(/^\/memory\s+remember\s+(.+)$/i);
  if (rememberMatch) {
    return {
      agent: 'memory-agent',
      action: 'remember',
      note: rememberMatch[1].trim(),
      requiresAuth: true,
    };
  }
  if (/^\/memory\b/i.test(normalized) || /(记住|记忆|项目状态)/.test(normalized)) {
    return { agent: 'memory-agent', action: 'show', requiresAuth: true };
  }

  if (/(老师任务|还差|接手|交接|文档|handoff|完成度)/i.test(normalized)) {
    return { agent: 'doc-agent', action: 'answer', requiresAuth: false };
  }

  if (/^(\/run-ui-test|run-ui-test)\b/i.test(normalized)
    || /(跑|运行|触发|执行).{0,40}测试/.test(normalized)
    || /UI\s*自动化/i.test(normalized)
    || /(冒烟|全量)\s*测试/.test(normalized)
    || /\b(smoke|contracts?)\s+test\b/i.test(normalized)) {
    return {
      agent: 'ui-test-agent',
      action: 'run',
      requiresAuth: true,
    };
  }

  return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
}

module.exports = {
  extractCommandText,
  normalizeText,
  routeAgentIntent,
};
