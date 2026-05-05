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

function extractImagePrompt(text) {
  const normalized = stripMention(String(text ?? '').trim());
  const commandMatch = normalized.match(/^\/(?:image|img|draw|generate-image)\s+(.+)$/i);
  if (commandMatch) {
    return commandMatch[1].trim();
  }

  const naturalMatch = normalized.match(/(?:帮我|给我|请|麻烦)?(?:生成|画|绘制|做|出)(?:一张|个|幅)?(?:图片|图|插画|海报|头像|壁纸|logo|Logo|图标|封面|表情包)[:：\s]*(.+)/i);
  if (naturalMatch) {
    return naturalMatch[1].trim();
  }

  const imageFirstMatch = normalized.match(/(?:图片|生图|画图)[:：\s]+(.+)/i);
  if (imageFirstMatch) {
    return imageFirstMatch[1].trim();
  }

  return '';
}

function looksLikeImageEditRequest(text) {
  const normalized = stripMention(String(text ?? '').trim());
  return /(修复|修一下|恢复|还原|增强|清晰|变清楚|去噪|上色|改图|编辑|处理|美化|抠图|换背景|放大|超分|旧照片|老照片|刚才那张|这张|这幅|这张图|这张图片)/i.test(normalized)
    && /(图|图片|照片|相片|photo|image|刚才那张|这张)/i.test(normalized);
}

function looksLikeImageGenerationRequest(text) {
  return Boolean(extractImagePrompt(text));
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

function routeQaAssetIntent(text) {
  const normalized = String(text ?? '').trim().toLowerCase();

  if (/(客服|客户|售后|support).{0,20}(训练|语料|数据|案例|用例|评测|评分)/i.test(normalized)
    || /(训练|生成|整理).{0,20}(电商|商城|购物).{0,20}(客服|售后)/i.test(normalized)) {
    return { agent: 'qa-agent', action: 'customer-service-data', requiresAuth: true };
  }

  if (/(agent|openclaw|hermes|龙虾).{0,30}(评测|评分|对比|能力测试|排行榜)/i.test(normalized)
    || /(评测|评分|对比).{0,20}(agent|openclaw|hermes|龙虾)/i.test(normalized)) {
    return { agent: 'qa-agent', action: 'agent-eval', requiresAuth: true };
  }

  if (/(ui|自动化|测试矩阵|测试用例).{0,20}(矩阵|清单|补|整理|生成|覆盖)/i.test(normalized)
    || /(整理|生成|补).{0,20}(ui|自动化).{0,20}(测试|用例|矩阵)/i.test(normalized)) {
    return { agent: 'qa-agent', action: 'ui-matrix', requiresAuth: true };
  }

  if (/(邮箱平台|邮箱|clawemail).{0,20}(怎么玩|玩法|调度|归档|验证码|结合)/i.test(normalized)) {
    return { agent: 'qa-agent', action: 'email-playbook', requiresAuth: true };
  }

  if (/(qa\s*数据资产|数据资产|训练场|评测集)/i.test(normalized)) {
    return { agent: 'qa-agent', action: 'overview', requiresAuth: true };
  }

  return null;
}

function routeCapabilityIntent(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (/(你|我)?(现在)?(能|可以|会).{0,12}(做|干|玩).{0,20}(什么|哪些|啥|事情|功能)/i.test(normalized)
    || /(有哪些|有什么).{0,16}(功能|能力|玩法|指令|命令|技能)/i.test(normalized)
    || /^(帮助|help|怎么用|使用说明|你会做什么|你能做什么|怎么玩|玩法)$/i.test(normalized)) {
    return { agent: 'capability-agent', action: 'guide', requiresAuth: false };
  }
  return null;
}

function routeBrainMemoryIntent(text) {
  const original = stripMention(String(text ?? '').trim());
  const normalized = original.toLowerCase();

  const brainSearchMatch = original.match(/^(?:查|搜索|问|查询|检索).{0,6}(?:知识库|脑库|gbrain|brain)[:：\s]*(.+)$/i);
  if (brainSearchMatch) {
    return {
      agent: 'memory-agent',
      action: 'brain-search',
      query: brainSearchMatch[1].trim(),
      requiresAuth: true,
    };
  }

  const knowledgeNoteMatch = original.match(/(?:沉淀|保存|记住|记录).{0,12}(?:知识库|记忆|经验|笔记)?[:：]\s*(.+)$/i);
  if (knowledgeNoteMatch) {
    return {
      agent: 'memory-agent',
      action: 'remember',
      note: knowledgeNoteMatch[1].trim(),
      requiresAuth: true,
    };
  }

  if (/(obsidian|gbrain|知识库|长期记忆|记忆系统|脑库|brain).{0,30}(怎么|如何|结合|接入|玩法|工作流|存储|分析)/i.test(normalized)
    || /(怎么|如何).{0,30}(obsidian|gbrain|知识库|长期记忆|记忆系统|脑库|brain)/i.test(normalized)) {
    return { agent: 'memory-agent', action: 'brain-guide', requiresAuth: true };
  }

  return null;
}

function routeBroadPlannerIntent(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (/(帮我|给我|把|将|来).{0,12}(项目|机器人|openclaw|hermes|龙虾|系统).{0,18}(优化|升级|完善|搞好|弄好|改好|二改|重构|增强)/i.test(normalized)
    || /(搞|做|整|安排).{0,12}(完整|全套|一套|重度).{0,16}(工作流|系统|方案|agent|智能体)/i.test(normalized)) {
    return {
      agent: 'planner-agent',
      action: 'clarify',
      confidence: 'low',
      requiresAuth: false,
    };
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
  const searchMatch = normalized.match(/^\/memory\s+(?:search|find|查找|搜索)\s+(.+)$/i);
  if (searchMatch) {
    return {
      agent: 'memory-agent',
      action: 'search',
      query: searchMatch[1].trim(),
      requiresAuth: true,
    };
  }
  if (/^\/memory\b/i.test(normalized) || /(记住|记忆|项目状态)/.test(normalized)) {
    return { agent: 'memory-agent', action: 'show', requiresAuth: true };
  }

  const capabilityRoute = routeCapabilityIntent(normalized);
  if (capabilityRoute) {
    return capabilityRoute;
  }

  const brainMemoryRoute = routeBrainMemoryIntent(original);
  if (brainMemoryRoute) {
    return brainMemoryRoute;
  }

  if (looksLikeImageGenerationRequest(normalized)) {
    return {
      agent: 'image-agent',
      action: 'generate',
      prompt: extractImagePrompt(normalized),
      requiresAuth: true,
    };
  }

  if (looksLikeImageEditRequest(normalized)) {
    return {
      agent: 'image-agent',
      action: 'edit',
      prompt: stripMention(original).trim(),
      requiresAuth: true,
    };
  }

  const qaAssetRoute = routeQaAssetIntent(normalized);
  if (qaAssetRoute) {
    return qaAssetRoute;
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

  const broadPlannerRoute = routeBroadPlannerIntent(normalized);
  if (broadPlannerRoute) {
    return broadPlannerRoute;
  }

  return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
}

module.exports = {
  extractCommandText,
  looksLikeTestHowToQuestion,
  looksLikeTestNegation,
  looksLikeTestRunRequest,
  extractImagePrompt,
  looksLikeImageEditRequest,
  looksLikeImageGenerationRequest,
  normalizeText,
  normalizeNaturalLanguageOpsText,
  routeAgentIntent,
  routeBrainMemoryIntent,
  routeBroadPlannerIntent,
  routeCapabilityIntent,
  routeQaAssetIntent,
  routeNaturalLanguageOps,
  stripMention,
};
