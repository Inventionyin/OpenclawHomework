function normalizeText(text) {
  return extractCommandText(stripMention(String(text ?? '').trim()));
}

function stripMention(text) {
  return String(text ?? '').trim().replace(/^@\S+\s*/, '');
}

function extractCommandText(text) {
  const commandMatch = text.match(/\/(?:status|health|watchdog|logs|peer(?:[-\s](?:status|health|logs|restart|repair))?|memory|run-ui-test)\b/i);
  if (!commandMatch) {
    return text;
  }
  return text.slice(commandMatch.index).trim();
}

function looksLikeTestHowToQuestion(text) {
  return /(如何|怎么|怎样|在哪|哪里).{0,30}(使用|运行|跑|触发|执行)?.{0,20}(\/run-ui-test|run-ui-test|测试|UI\s*自动化|冒烟|全量|smoke\s+test|contracts?\s+test)/i.test(text)
    || /(\/run-ui-test|run-ui-test).{0,60}(如何|怎么|怎样|用法|怎么用|如何用)/i.test(text);
}

function looksLikeTestNegation(text) {
  return /(不要|别|不用|无需|不要再|先别).{0,30}(\/run-ui-test|run-ui-test|运行|跑|触发|执行).{0,30}(测试|UI\s*自动化|冒烟|全量|smoke|contracts?)?/i.test(text);
}

function looksLikeTestRunRequest(text) {
  if (looksLikeTestHowToQuestion(text) || looksLikeTestNegation(text)) {
    return false;
  }

  return /(帮我|请|麻烦|帮忙|给我)?.{0,12}(跑|运行|触发|执行).{0,40}(测试|UI\s*自动化|冒烟|全量)/.test(text)
    || /^(帮我|请|麻烦|帮忙|给我).{0,20}(冒烟|全量|smoke|contracts?).{0,10}(测试|test)$/i.test(text);
}

function routeAgentIntent(text) {
  const original = stripMention(text);
  if (looksLikeTestHowToQuestion(original)) {
    return { agent: 'doc-agent', action: 'answer', requiresAuth: true };
  }

  if (looksLikeTestNegation(original)) {
    return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
  }

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
  const peerMatch = normalized.match(/^\/peer(?:[-\s](status|health|logs|restart|repair))\b/i);
  if (peerMatch) {
    return { agent: 'ops-agent', action: `peer-${peerMatch[1].toLowerCase()}`, requiresAuth: true };
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

  if (looksLikeTestHowToQuestion(normalized)) {
    return { agent: 'doc-agent', action: 'answer', requiresAuth: true };
  }

  if (/^(\/run-ui-test|run-ui-test)\b/i.test(normalized) || looksLikeTestRunRequest(normalized)) {
    return {
      agent: 'ui-test-agent',
      action: 'run',
      requiresAuth: true,
    };
  }

  if (/(老师任务|还差|接手|交接|文档|handoff|完成度)/i.test(normalized)) {
    return { agent: 'doc-agent', action: 'answer', requiresAuth: true };
  }

  return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
}

module.exports = {
  extractCommandText,
  looksLikeTestHowToQuestion,
  looksLikeTestNegation,
  looksLikeTestRunRequest,
  normalizeText,
  routeAgentIntent,
  stripMention,
};
