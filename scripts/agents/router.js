function normalizeText(text) {
  return extractCommandText(stripMention(String(text ?? '').trim()));
}

function stripMention(text) {
  return String(text ?? '').trim().replace(/^@\S+\s*/, '');
}

function extractCommandText(text) {
  const commandMatch = text.match(/\/(?:status|health|watchdog|logs|exec|peer(?:-exec|[-\s](?:status|health|logs|restart|repair))?|memory|run-ui-test)\b/i);
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

function normalizeNaturalLanguageOpsText(text) {
  return String(text ?? '')
    .trim()
    .replace(/open\s*claw/ig, 'openclaw')
    .replace(/龙虾/g, 'openclaw')
    .replace(/赫尔墨斯/ig, 'hermes')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function detectOpsTarget(text) {
  const normalized = normalizeNaturalLanguageOpsText(text);
  const hasHermes = /\bhermes\b/.test(normalized);
  const hasOpenClaw = /\bopenclaw\b/.test(normalized);
  if (hasHermes && !hasOpenClaw) return 'hermes';
  if (hasOpenClaw && !hasHermes) return 'openclaw';
  if (/(你自己|自己|你这台|本机|自己服务器|你的服务器)/.test(normalized)) return 'self';
  return 'self';
}

function toOpsRoute(action, target = 'self', confidence = 'high') {
  const routedAction = target === 'self' || action.startsWith('peer-') ? action : `peer-${action}`;
  return {
    agent: 'ops-agent',
    action: routedAction,
    target,
    confidence,
    requiresAuth: true,
  };
}

function routeNaturalLanguageOps(text) {
  const normalized = normalizeNaturalLanguageOpsText(text).replace(/重起/g, '重启');
  const target = detectOpsTarget(normalized);
  const hasExplicitPeer = target !== 'self';

  const cleanupSelectionMatch = normalized.match(/(?:确认)?清理(?:第\s*)?(\d+)\s*(?:个|项)?/);
  if (cleanupSelectionMatch) {
    return {
      ...toOpsRoute('cleanup-confirm', target, 'high'),
      selection: Number(cleanupSelectionMatch[1]),
    };
  }

  const cleanupNameMatch = normalized.match(/(?:确认)?清理\s*(khoj|npm|缓存|日志|tmp|临时文件)/i);
  if (cleanupNameMatch) {
    return {
      ...toOpsRoute('cleanup-confirm', target, 'high'),
      selectionName: cleanupNameMatch[1].toLowerCase(),
    };
  }

  if (/(khoj)/i.test(normalized) && /(清理|删除|能删|可以删|占用|硬盘|空间)/.test(normalized)) {
    return {
      ...toOpsRoute('disk-audit', target, 'high'),
      cleanupHint: 'khoj',
    };
  }

  if (/(哪些|哪里|什么|地方|文件|目录).{0,16}(占用|占|耗|吃).{0,12}(硬盘|磁盘|空间|存储)/.test(normalized)
    || /(没用|无用|可以删|能删|可清理).{0,20}(硬盘|磁盘|空间|存储)/.test(normalized)
    || /(硬盘|磁盘|空间|存储).{0,20}(没用|无用|可以删|能删|可清理|占用多|大户)/.test(normalized)) {
    return toOpsRoute('disk-audit', target, 'high');
  }

  if (/(重启|修复|重起|搞一下)/.test(normalized)) {
    const selfRestart = /(重启|重起).{0,8}(你自己|自己|你这台|本机)|你.{0,4}(重启|重起).{0,4}(一下)?/.test(normalized);
    const peerRestart = hasExplicitPeer && /(重启|重起)/.test(normalized);
    const selfRepair = /修复.{0,8}(你自己|自己|你这台|本机)|你.{0,4}修复/.test(normalized);
    const peerRepair = hasExplicitPeer && /修复/.test(normalized);

    if (peerRestart) {
      return toOpsRoute('restart', target, 'high');
    }
    if (peerRepair) {
      return toOpsRoute('repair', target, 'high');
    }
    if (selfRestart) {
      const confidence = /重起/.test(String(text ?? '')) ? 'medium' : 'high';
      return toOpsRoute('restart', 'self', confidence);
    }
    if (selfRepair) {
      return toOpsRoute('repair', 'self', 'high');
    }
    if (/(重启|重起|修复|搞一下)/.test(normalized)) {
      return {
        agent: 'ops-agent',
        action: 'clarify',
        target: 'unknown',
        confidence: 'low',
        requiresAuth: true,
      };
    }
  }

  if (/(服务器状态|自己.{0,8}状态|你这台.{0,8}状态|本机.{0,8}状态)/.test(normalized)
    || (hasExplicitPeer && /(状态|正常吗|运行)/.test(normalized))) {
    return toOpsRoute('status', target, hasExplicitPeer ? 'high' : 'medium');
  }

  if (/(内存|memory|ram)/i.test(normalized) && /(多少|剩|占用|使用|状态|够不够|高不高)?/.test(normalized)) {
    return toOpsRoute('memory-summary', target, 'high');
  }

  if (/(硬盘|磁盘|存储|空间|disk|df)/i.test(normalized) && /(多少|剩|占用|使用|状态|够不够)?/.test(normalized)) {
    return toOpsRoute('disk-summary', target, 'high');
  }

  if (/(卡不卡|卡吗|负载|cpu|CPU|load|压力|慢不慢)/i.test(normalized)) {
    return toOpsRoute('load-summary', target, hasExplicitPeer ? 'high' : 'medium');
  }

  return null;
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
  const execMatch = normalized.match(/^\/exec\s+(.+)$/i);
  if (execMatch) {
    return { agent: 'ops-agent', action: 'exec', command: execMatch[1].trim(), requiresAuth: true };
  }
  const peerExecMatch = normalized.match(/^\/peer-exec\s+(.+)$/i);
  if (peerExecMatch) {
    return { agent: 'ops-agent', action: 'peer-exec', command: peerExecMatch[1].trim(), requiresAuth: true };
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

  const naturalLanguageOpsRoute = routeNaturalLanguageOps(normalized);
  if (naturalLanguageOpsRoute) {
    return naturalLanguageOpsRoute;
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
  normalizeNaturalLanguageOpsText,
  routeAgentIntent,
  routeNaturalLanguageOps,
  stripMention,
};
