const {
  parseImageChannelConfig,
} = require('../image-channel-config');
const {
  parseModelChannelConfig,
} = require('../model-channel-config');

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

  if (/(你|本机|服务器).{0,8}(搞一下|处理一下)/.test(normalized)
    || /你帮我搞一下/.test(normalized)) {
    return {
      agent: 'ops-agent',
      action: 'clarify',
      target: 'unknown',
      confidence: 'low',
      requiresAuth: true,
    };
  }

  if (/(重启|修复|重起)/.test(normalized)) {
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
    if (/(重启|重起|修复)/.test(normalized)) {
      return {
        agent: 'ops-agent',
        action: 'clarify',
        target: 'unknown',
        confidence: 'low',
        requiresAuth: true,
      };
    }
  }

  const wantsMemorySummary = /(内存|memory|ram)/i.test(normalized);
  const wantsDiskSummary = /(硬盘|磁盘|存储|空间|disk|df)/i.test(normalized);
  const wantsLoadSummary = /(卡不卡|卡吗|负载|cpu|CPU|load|压力|慢不慢)/i.test(normalized);
  const resourceSummaryCount = [wantsMemorySummary, wantsDiskSummary, wantsLoadSummary]
    .filter(Boolean).length;
  if (resourceSummaryCount >= 2) {
    return toOpsRoute('load-summary', target, 'high');
  }

  if (/(服务器状态|自己.{0,8}状态|你这台.{0,8}状态|本机.{0,8}状态)/.test(normalized)
    || (hasExplicitPeer && /(状态|正常吗|运行)/.test(normalized))) {
    return toOpsRoute('status', target, hasExplicitPeer ? 'high' : 'medium');
  }

  if (wantsMemorySummary && /(多少|剩|占用|使用|状态|够不够|高不高)?/.test(normalized)) {
    return toOpsRoute('memory-summary', target, 'high');
  }

  if (wantsDiskSummary && /(多少|剩|占用|使用|状态|够不够)?/.test(normalized)) {
    return toOpsRoute('disk-summary', target, 'high');
  }

  if (wantsLoadSummary) {
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

function looksLikeShortContinuationIntent(text) {
  const withoutWakeWord = stripMention(String(text ?? '').trim())
    .replace(/^(?:文员|秘书|助理|clerk|office)[，,.\s:：。]*/i, '')
    .trim();
  return /^(?:继续|继续吧|接着|接着做|下一步|下步|下一条|往下)[。.!！?？~～\s]*$/i.test(withoutWakeWord);
}

function hasClerkWakeWord(text) {
  return /^(?:@\S+\s*)?(?:文员|秘书|助理|clerk|office)(?:[，,.\s:：。]+|$)/i.test(String(text ?? '').trim());
}

function routeClerkIntent(text) {
  const original = stripMention(String(text ?? '').trim());
  const normalized = original.toLowerCase();
  const emailLikeMatch = original.match(/\b([^\s]+@[^\s]+)\b/);
  const emailLike = emailLikeMatch ? emailLikeMatch[1].replace(/[，。！!？?,;；]+$/u, '') : '';
  const recipientMatch = original.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  const recipientEmail = recipientMatch ? recipientMatch[1] : '';
  if (!/(文员|秘书|助理|clerk|office)/i.test(normalized)) {
    return null;
  }

  if (/(projectku-web|projectku).{0,30}(注册|验证码|验证).{0,20}(测试|跑一轮|测一下|执行)/i.test(normalized)
    || /(注册|验证码|验证).{0,20}(测试|跑一轮|测一下|执行).{0,30}(projectku-web|projectku)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'platform-registration-runner', requiresAuth: true };
  }

  if (/(子邮箱|别名邮箱|测试邮箱|邮箱账号|账号池).{0,30}(注册|平台注册|账号|平台|验证码|测试)/i.test(normalized)
    || /(注册|平台注册|账号|平台).{0,30}(子邮箱|别名邮箱|测试邮箱|账号池)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-registration-playbook', requiresAuth: true };
  }

  if (/(verify|验证码|邮箱验证|注册验证|找回密码).{0,30}(测试|计划|流程|用例|设计|跑一轮|测一下)/i.test(normalized)
    || /(测试|计划|流程|用例|设计|跑一轮|测一下).{0,30}(verify|验证码|邮箱验证|注册验证|找回密码)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'verification-test-plan', requiresAuth: true };
  }

  if (/(今天|当前|现在).{0,12}(邮箱|邮件).{0,12}(任务|队列|待办|有什么|有哪些)/i.test(normalized)
    || /(邮箱|邮件).{0,12}(任务|队列|待办).{0,12}(今天|当前|现在|有哪些|有什么)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-tasks', requiresAuth: true };
  }

  if (/(待审批|待确认|审批).{0,16}(邮件|邮箱)|((邮件|邮箱).{0,16}(待审批|待确认|审批))/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-approvals', requiresAuth: true };
  }

  const approvalActionMatch = original.match(/(?:文员[，,\s]*)?(审批|忽略|无视).{0,10}第\s*(\d+)\s*封(?:并发送|并外发|并归档|邮件)?/i);
  if (approvalActionMatch) {
    const keyword = approvalActionMatch[1];
    const index = Number(approvalActionMatch[2]);
    let approvalAction = 'approve';
    if (/(忽略|无视)/i.test(keyword)) approvalAction = 'ignore';
    if (/(转成|整理成|转为)/i.test(keyword)) approvalAction = 'training-data';
    return {
      agent: 'clerk-agent',
      action: 'mailbox-approval-action',
      approvalAction,
      index,
      requiresAuth: true,
    };
  }

  const approvalTrainingMatch = original.match(/(?:文员[，,\s]*)?(?:把|将)?第\s*(\d+)\s*封.{0,12}(整理成|转成|转为).{0,8}(客服)?训练数据/i);
  if (approvalTrainingMatch) {
    return {
      agent: 'clerk-agent',
      action: 'mailbox-approval-action',
      approvalAction: 'training-data',
      index: Number(approvalTrainingMatch[1]),
      requiresAuth: true,
    };
  }

  if (!/(发送|发到|发给|寄到|寄给|外发)/i.test(normalized)
    && (/(clawemail|邮箱|邮件).{0,24}(每日报告|日结|每日总结|生成报告)|(生成|查看|预览|制作).{0,12}(clawemail|邮箱|邮件).{0,24}(日报|报告)|(每日报告|日结|每日总结|生成报告).{0,24}(clawemail|邮箱|邮件)/i.test(normalized))) {
    return { agent: 'clerk-agent', action: 'mailbox-daily-report', requiresAuth: true };
  }

  if (/(邮件|邮箱).{0,18}(发了|发送了|发出去|发送记录|流水|账本|历史|记录|哪些|列表)/i.test(normalized)
    || /(发了|发送了|发出去|发送记录|流水|账本|历史|记录|哪些|列表).{0,18}(邮件|邮箱)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mail-ledger', requiresAuth: true };
  }

  if (/(自动流水线|每日流水线|daily\s*pipeline)/i.test(normalized)) {
    if (/(状态|进度|查看|查询|跑到哪|怎么样)/i.test(normalized)) {
      return { agent: 'clerk-agent', action: 'daily-pipeline-status', requiresAuth: true };
    }
    return {
      agent: 'clerk-agent',
      action: 'daily-pipeline',
      ...(/(试跑|dry\s*-?\s*run|预演|演练)/i.test(normalized) ? { dryRun: true } : {}),
      requiresAuth: true,
    };
  }

  if (/(烧|消耗|花完|用掉).{0,12}(token|额度).{0,30}(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势)/i.test(normalized)
    || /(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势).{0,30}(烧|消耗|花完|用掉).{0,12}(token|额度)/i.test(normalized)
    || /longcat.{0,18}(分析|看|研究|总结).{0,18}(热点|新闻|热榜|开源|github|项目|趋势)/i.test(normalized)
    || /(热点|新闻|热榜|开源|github|项目|趋势).{0,18}(longcat).{0,18}(分析|看|研究|总结)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'trend-token-factory', requiresAuth: true };
  }

  if (/(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点).{0,24}(热榜|热点|新闻|日报|看看|分析|今天|每日|推荐|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(今天|每日).{0,12}(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(值得学|学习|学什么|推荐项目).{0,24}(开源|github|热门项目|项目|趋势)/i.test(normalized)
    || /(测试圈|测试社区|qa圈|测试热点).{0,24}(热点|看看|新闻|趋势|日报|推荐)?/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'trend-intel', requiresAuth: true };
  }

  if (/(飞书|消息|聊天|群里|里面|卡片).{0,16}(嵌入|打开|查看|显示|发).{0,16}(控制台|看板|dashboard|console)/i.test(normalized)
    || /(控制台|看板|dashboard|console).{0,16}(飞书|消息|聊天|群里|里面|卡片|打开|查看|显示)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'dashboard-card', requiresAuth: true };
  }

  if (/(一屏看懂|总览|项目总览|整体情况|今天.*(进展|做了啥|做了什么|情况)|现在.*(该怎么玩|先做什么))/i.test(normalized)
    || /((进展|做了啥|做了什么|情况).{0,12}(总览|一屏|汇总))/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'command-center', requiresAuth: true };
  }

  if (/(启动|开始|跑|执行|开).{0,12}(多\s*agent|多智能体|agent).{0,20}(训练场|实验室|lab|对打|评测|生成|归档)/i.test(normalized)
    || /(多\s*agent|多智能体|agent).{0,20}(训练场|实验室|lab|对打|评测|生成|归档)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'multi-agent-lab', requiresAuth: true };
  }

  if (/(任务中枢|任务中心|主控脑).{0,10}(主控脑|大脑|总览|全景|复盘|下一步|历史|脑图)/i.test(normalized)
    || /(今日任务|历史任务|失败复盘|下一步计划).{0,12}(中枢|任务中心|主控脑)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-brain', requiresAuth: true };
  }

  if (/(邮箱平台|邮箱|clawemail).{0,24}(怎么玩|玩法|调度|归档|验证码|结合|分工|工作台)/i.test(normalized)
    || /(怎么玩|玩法|调度|归档|验证码|结合|分工|工作台).{0,24}(邮箱平台|邮箱|clawemail)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-workbench', requiresAuth: true };
  }

  if (/(文件通道|附件通道|文件收件|上传文件|报告附件|截图|trace).{0,24}(怎么玩|玩法|工作台|结合|归档|收到|有哪些|最近|查看|整理)/i.test(normalized)
    || /(怎么玩|玩法|工作台|结合|归档|收到|有哪些|最近|查看|整理).{0,24}(文件通道|附件通道|文件收件|上传文件|报告附件|截图|trace)/i.test(normalized)) {
    const action = /(最近|收到|有哪些|查看|列表)/i.test(normalized)
      ? 'recent-files'
      : 'file-channel-workbench';
    return { agent: 'clerk-agent', action, requiresAuth: true };
  }

  if (/(客服|客户|售后|support).{0,20}(训练|语料|数据|案例|用例|评测|评分)/i.test(normalized)
    || /(训练|生成|整理).{0,20}(电商|商城|购物).{0,20}(客服|售后)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'training-data', requiresAuth: true };
  }

  if (/(把|将|让).{0,8}token.{0,8}(跑起来|用起来)/i.test(normalized)
    || /(来一套|安排一套|整一套).{0,12}(高\s*token|token).{0,12}(玩法|流程|全链路)/i.test(normalized)
    || /(生成|做|整理).{0,16}(一套|一批).{0,16}(训练数据|语料).{0,20}(评测|评审).{0,12}(归档|沉淀)/i.test(normalized)
    || /(token).{0,20}(全链路|流水线|工厂|产线)/i.test(normalized)
    || /(今天).{0,10}(把).{0,8}(token).{0,8}(用起来)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-factory', requiresAuth: true };
  }

  if (/(token.?factory|token\s*工厂).{0,20}(状态|进度|跑到哪|怎么样|查询|查看)/i.test(normalized)
    || /(状态|进度|跑到哪|怎么样|查询|查看).{0,20}(token.?factory|token\s*工厂)/i.test(normalized)) {
    const taskMatch = original.match(/\b(tf-[a-z0-9-]+)\b/i);
    return {
      agent: 'clerk-agent',
      action: 'token-factory-status',
      ...(taskMatch ? { taskId: taskMatch[1] } : {}),
      requiresAuth: true,
    };
  }

  if (/(今天|今日|今天的).{0,12}(任务|待办).{0,12}(中枢|中心)/i.test(normalized)
    || /(任务中枢|任务中心).{0,12}(今天|今日|待办|任务)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-today', requiresAuth: true };
  }
  if (/(失败任务|失败的任务|失败清单|失败列表).{0,12}(查看|汇总|有哪些|整理)?/i.test(normalized)
    || /(查看|汇总|整理).{0,12}(失败任务|失败清单|失败列表)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-failed', requiresAuth: true };
  }

  if (/(继续|恢复|接着跑|接着做).{0,10}(昨天|昨日).{0,24}(任务中枢|任务中心|任务|token.?factory|token\s*工厂)/i.test(normalized)
    || /(昨天|昨日).{0,24}(任务中枢|任务中心|任务|token.?factory|token\s*工厂).{0,10}(继续|恢复|接着跑|接着做)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-continue-yesterday', requiresAuth: true };
  }

  if (/(继续|接着|延续).{0,12}(昨天|昨晚|昨日).{0,12}(没跑完|没做完|没完成).{0,12}(token|token\s*工厂|token-factory)/i.test(normalized)
    || /(token|token\s*工厂|token-factory).{0,18}(继续|接着).{0,12}(昨天|昨晚|昨日)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-factory', requiresAuth: true };
  }

  if (looksLikeShortContinuationIntent(original)) {
    return { agent: 'clerk-agent', action: 'continue-context', requiresAuth: true };
  }

  if (/(启动|开始|跑|执行|开).{0,12}(高\s*token|token).{0,20}(训练场|实验室|lab|额度|数据|训练|烧|消耗)/i.test(normalized)
    || /(高\s*token|token).{0,20}(训练场|实验室|lab|额度|烧|消耗)/i.test(normalized)
    || /(烧|消耗|花完).{0,12}(token|额度).{0,20}(训练|数据|训练场)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-lab', requiresAuth: true };
  }

  if (/(耗时|用量|账本|谁更费|谁更省|统计|对比|token\s*(用量|消耗|统计|账本|对比))/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-summary', requiresAuth: true };
  }

  const looksLikeDailyDeliveryWithInvalidEmail = (
    (/(发送|发|寄).{0,12}(日报|周报|报告).{0,16}(给|到|到达|寄给|发给|寄到)?/i.test(normalized)
      || /((发到|发给|寄到|寄给).{0,20}(日报|周报|报告)|(日报|周报|报告).{0,20}(发到|发给|寄到|寄给))/i.test(normalized))
    && emailLike
    && !recipientEmail
  );
  if (looksLikeDailyDeliveryWithInvalidEmail) {
    return {
      agent: 'clerk-agent',
      action: 'daily-email-invalid-recipient',
      invalidRecipient: emailLike,
      requiresAuth: true,
    };
  }

  if (/(发送|发|寄).{0,12}(日报|周报|报告).{0,12}(邮箱|邮件)|((日报|周报|报告).{0,12}(发送|发|寄).{0,12}(邮箱|邮件))|((发到|发给|寄到|寄给).{0,24}[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.test(normalized)) {
    return {
      agent: 'clerk-agent',
      action: 'daily-email',
      ...(recipientEmail ? { recipientEmail } : {}),
      requiresAuth: true,
    };
  }

  if (/(今日|今天).{0,10}(总结).{0,10}(明日|明天).{0,10}(计划)/i.test(normalized)
    || /(明日|明天).{0,10}(计划).{0,10}(今日|今天).{0,10}(总结)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'todo-summary', requiresAuth: true };
  }

  if (/(待办|todo|清单|还没|未完成|下一步|整理一下)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'todo-summary', requiresAuth: true };
  }

  if (/(日报|周报|报告|ui\s*自动化|测试结果|发到邮箱|邮件|总结)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'daily-report', requiresAuth: true };
  }

  if (/(知识库|沉淀|归档|记录|整理)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'knowledge-summary', requiresAuth: true };
  }

  if (/(干嘛|做什么|能做|会做|工作台|今天|现在|帮我)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'workbench', requiresAuth: true };
  }

  return { agent: 'clerk-agent', action: 'guide', requiresAuth: true };
}

function routeOfficeIntent(text) {
  const original = stripMention(String(text ?? '').trim());
  const normalized = original.toLowerCase();
  const emailLikeMatch = original.match(/\b([^\s]+@[^\s]+)\b/);
  const emailLike = emailLikeMatch ? emailLikeMatch[1].replace(/[，。！!？?,;；]+$/u, '') : '';
  const recipientMatch = original.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  const recipientEmail = recipientMatch ? recipientMatch[1] : '';

  const officeApprovalActionMatch = original.match(/(?:审批|忽略|无视).{0,10}第\s*(\d+)\s*封(?:并发送|并外发|并归档|邮件)?/i);
  if (officeApprovalActionMatch) {
    let approvalAction = 'approve';
    if (/(忽略|无视)/i.test(original)) approvalAction = 'ignore';
    return {
      agent: 'clerk-agent',
      action: 'mailbox-approval-action',
      approvalAction,
      index: Number(officeApprovalActionMatch[1]),
      requiresAuth: true,
    };
  }

  const officeApprovalTrainingMatch = original.match(/(?:把|将)?第\s*(\d+)\s*封.{0,12}(整理成|转成|转为).{0,8}(客服)?训练数据/i);
  if (officeApprovalTrainingMatch) {
    return {
      agent: 'clerk-agent',
      action: 'mailbox-approval-action',
      approvalAction: 'training-data',
      index: Number(officeApprovalTrainingMatch[1]),
      requiresAuth: true,
    };
  }

  if (/(继续|接着|延续).{0,12}(昨天|昨晚|昨日).{0,12}(没跑完|没做完|没完成).{0,12}(token|token\s*工厂|token-factory)/i.test(normalized)
    || /(token|token\s*工厂|token-factory).{0,18}(继续|接着).{0,12}(昨天|昨晚|昨日)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-factory', requiresAuth: true };
  }

  if (looksLikeShortContinuationIntent(original)) {
    return { agent: 'clerk-agent', action: 'continue-context', requiresAuth: true };
  }

  if (/(耗时|用量|账本|谁更费|谁更省|统计|对比|token\s*(用量|消耗|统计|账本|对比)).{0,30}(hermes|openclaw|模型|调用|今天|最近)?/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'token-summary', requiresAuth: true };
  }

  const looksLikeDailyDeliveryWithInvalidEmail = (
    (/(发送|发|寄).{0,12}(日报|周报|报告).{0,16}(给|到|到达|寄给|发给|寄到)?/i.test(normalized)
      || /((发到|发给|寄到|寄给).{0,20}(日报|周报|报告)|(日报|周报|报告).{0,20}(发到|发给|寄到|寄给))/i.test(normalized))
    && emailLike
    && !recipientEmail
  );
  if (looksLikeDailyDeliveryWithInvalidEmail) {
    return {
      agent: 'clerk-agent',
      action: 'daily-email-invalid-recipient',
      invalidRecipient: emailLike,
      requiresAuth: true,
    };
  }

  if (/(发送|发|寄|给我).{0,12}(今天|当前|今儿)?.{0,8}(日报|周报|报告).{0,20}(邮箱|邮件|给|到|发给|发到|寄给|寄到)/i.test(normalized)
    || /(今天|当前|今儿)?.{0,8}(日报|周报|报告).{0,20}(发送|发|寄|邮箱|邮件|发给|发到)/i.test(normalized)
    || /((发到|发给|寄到|寄给).{0,24}[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.test(normalized)) {
    return {
      agent: 'clerk-agent',
      action: 'daily-email',
      ...(recipientEmail ? { recipientEmail } : {}),
      requiresAuth: true,
    };
  }

  if (/(今天|当前|现在).{0,12}(邮箱|邮件).{0,12}(任务|队列|待办|有什么|有哪些)/i.test(normalized)
    || /(邮箱|邮件).{0,12}(任务|队列|待办).{0,12}(今天|当前|现在|有哪些|有什么)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-tasks', requiresAuth: true };
  }

  if (/(待审批|待确认|审批).{0,16}(邮件|邮箱)|((邮件|邮箱).{0,16}(待审批|待确认|审批))/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mailbox-approvals', requiresAuth: true };
  }

  if (!/(发送|发到|发给|寄到|寄给|外发)/i.test(normalized)
    && (/(clawemail|邮箱|邮件).{0,24}(每日报告|日结|每日总结|生成报告)|(生成|查看|预览|制作).{0,12}(clawemail|邮箱|邮件).{0,24}(日报|报告)|(每日报告|日结|每日总结|生成报告).{0,24}(clawemail|邮箱|邮件)/i.test(normalized))) {
    return { agent: 'clerk-agent', action: 'mailbox-daily-report', requiresAuth: true };
  }

  if (/(邮件|邮箱).{0,18}(发了|发送了|发出去|发送记录|流水|账本|历史|记录|哪些|列表)/i.test(normalized)
    || /(发了|发送了|发出去|发送记录|流水|账本|历史|记录|哪些|列表).{0,18}(邮件|邮箱)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'mail-ledger', requiresAuth: true };
  }

  if (/(烧|消耗|花完|用掉).{0,12}(token|额度).{0,30}(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势)/i.test(normalized)
    || /(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势).{0,30}(烧|消耗|花完|用掉).{0,12}(token|额度)/i.test(normalized)
    || /longcat.{0,18}(分析|看|研究|总结).{0,18}(热点|新闻|热榜|开源|github|项目|趋势)/i.test(normalized)
    || /(热点|新闻|热榜|开源|github|项目|趋势).{0,18}(longcat).{0,18}(分析|看|研究|总结)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'trend-token-factory', requiresAuth: true };
  }

  if (/(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点).{0,24}(热榜|热点|新闻|日报|看看|分析|今天|每日|推荐|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(今天|每日).{0,12}(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(值得学|学习|学什么|推荐项目).{0,24}(开源|github|热门项目|项目|趋势)/i.test(normalized)
    || /(测试圈|测试社区|qa圈|测试热点).{0,24}(热点|看看|新闻|趋势|日报|推荐)?/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'trend-intel', requiresAuth: true };
  }

  if (/(飞书|消息|聊天|群里|里面|卡片).{0,16}(嵌入|打开|查看|显示|发).{0,16}(控制台|看板|dashboard|console)/i.test(normalized)
    || /(控制台|看板|dashboard|console).{0,16}(飞书|消息|聊天|群里|里面|卡片|打开|查看|显示)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'dashboard-card', requiresAuth: true };
  }

  if (/(一屏看懂|总览|项目总览|整体情况|今天.*(进展|做了啥|做了什么|情况)|现在.*(该怎么玩|先做什么))/i.test(normalized)
    || /((进展|做了啥|做了什么|情况).{0,12}(总览|一屏|汇总))/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'command-center', requiresAuth: true };
  }

  if (/(今天|今日|今天的).{0,12}(任务|待办).{0,12}(中枢|中心)/i.test(normalized)
    || /(任务中枢|任务中心).{0,12}(今天|今日|待办|任务)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-today', requiresAuth: true };
  }

  if (/(整理|列一下|看看|汇总).{0,12}(今天|当前|项目)?.{0,12}(待办|todo|清单|还没|未完成|下一步)/i.test(normalized)
    || /(待办|todo|清单|还没|未完成|下一步).{0,12}(整理|列一下|看看|汇总)?/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'todo-summary', requiresAuth: true };
  }

  if (/(今天|现在).{0,8}(还有|还).{0,8}(什么|哪些).{0,8}(没做|未做|没完成|未完成)/i.test(normalized)
    || /(昨天).{0,10}(失败了|失败的).{0,10}(什么|哪些)/i.test(normalized)
    || /(今日|今天).{0,10}(总结).{0,10}(明日|明天).{0,10}(计划)/i.test(normalized)
    || /(明日|明天).{0,10}(计划).{0,10}(今日|今天).{0,10}(总结)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'todo-summary', requiresAuth: true };
  }
  if (/(任务中枢|任务中心|主控脑).{0,10}(主控脑|大脑|总览|全景|复盘|下一步|历史|脑图)/i.test(normalized)
    || /(今日任务|历史任务|失败复盘|下一步计划).{0,12}(中枢|任务中心|主控脑)/i.test(normalized)) {
    return { agent: 'clerk-agent', action: 'task-center-brain', requiresAuth: true };
  }

  return null;
}

function routeCapabilityIntent(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (/(你|我)?(现在)?(能|可以|会).{0,12}(做|干|玩).{0,20}(什么|哪些|啥|事情|功能)/i.test(normalized)
    || /(有哪些|有什么).{0,16}(功能|能力|玩法|指令|命令|技能)/i.test(normalized)
    || /^(帮助|help|怎么用|使用说明|你会做什么|你能做什么|怎么玩|玩法)$/i.test(normalized)
    || /(现在|今天).{0,8}(我|我们).{0,8}(该|可以).{0,8}(怎么玩|怎么用|做什么)/i.test(normalized)) {
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

function routeEcosystemIntent(text) {
  const normalized = normalizeNaturalLanguageOpsText(stripMention(String(text ?? '').trim()));
  const mentionsEcosystem = /(gbrain|g\s*brain|g\s*stack|hermes\s*webui|awesome\s*hermes|self\s*evolution|自进化|自我进化|生态插件|生态导航|技能|skill|插件|web\s*ui|网页\s*ui|后台自检|自检更新|自动更新|自我净化)/i.test(normalized);
  if (!mentionsEcosystem) {
    return null;
  }

  const target = detectOpsTarget(normalized);
  if (/(状态|查看|检查|有没有|装了没|安装了吗|当前)/.test(normalized)) {
    return {
      agent: 'ecosystem-agent',
      action: 'status',
      target,
      confidence: 'high',
      requiresAuth: true,
    };
  }

  const hasInstallVerb = /(安装|下载|配置|激活|接入|补装|升级|安排)/.test(normalized);
  const hasMaintenanceVerb = /(后台自检|自检更新|自动更新|长期最优|自我净化|记忆净化|维护|巡检|持续|开启)/.test(normalized);
  if (!hasInstallVerb && !hasMaintenanceVerb) {
    return null;
  }

  if (!hasInstallVerb && hasMaintenanceVerb) {
    return {
      agent: 'ecosystem-agent',
      action: 'enable-maintenance',
      target,
      confidence: 'high',
      requiresAuth: true,
    };
  }

  if (/(安装|下载|配置|激活|接入|开启|补装|更新|升级|安排)/.test(normalized)) {
    return {
      agent: 'ecosystem-agent',
      action: 'install-safe',
      target,
      confidence: 'high',
      requiresAuth: true,
    };
  }

  if (/(后台自检|自检更新|自动更新|长期最优|自我净化|记忆净化|维护|巡检|持续)/.test(normalized)) {
    return {
      agent: 'ecosystem-agent',
      action: 'enable-maintenance',
      target,
      confidence: 'high',
      requiresAuth: true,
    };
  }

  return {
    agent: 'ecosystem-agent',
    action: 'guide',
    target,
    confidence: 'medium',
    requiresAuth: true,
  };
}

function routeBroadPlannerIntent(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (/(帮我|给我|把|将|来).{0,12}(项目|机器人|openclaw|hermes|龙虾|系统).{0,18}(优化|升级|完善|搞好|弄好|改好|二改|重构|增强)/i.test(normalized)
    || /(搞|做|整|安排).{0,12}(完整|全套|一套|重度).{0,16}(工作流|系统|方案|agent|智能体)/i.test(normalized)
    || /(项目|整体).{0,12}(质量).{0,12}(搞一下|提升|优化|加强)/i.test(normalized)
    || /(ui\s*自动化|自动化|新闻|token).{0,20}(都|一起).{0,10}(安排|规划|统筹)/i.test(normalized)) {
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
  if (looksLikeShortContinuationIntent(original) && !hasClerkWakeWord(text)) {
    return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
  }

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
  const rememberNaturalMatch = original.match(/^(?:帮我)?(?:记住|记一下|记个|保存|沉淀|记录)(?:一下|下来)?[:：\s]+(.+)$/i);
  if (rememberNaturalMatch) {
    return {
      agent: 'memory-agent',
      action: 'remember',
      note: rememberNaturalMatch[1].trim(),
      requiresAuth: true,
    };
  }
  const earlyEcosystemRoute = routeEcosystemIntent(original);
  if (earlyEcosystemRoute) {
    return earlyEcosystemRoute;
  }
  if (/^\/memory\b/i.test(normalized) || /(记忆|项目状态)/.test(normalized)) {
    return { agent: 'memory-agent', action: 'show', requiresAuth: true };
  }

  const capabilityRoute = routeCapabilityIntent(normalized);
  if (capabilityRoute) {
    return capabilityRoute;
  }

  const brainMemoryRoute = routeBrainMemoryIntent(original);
  if (brainMemoryRoute) {
    const ecosystemRoute = routeEcosystemIntent(original);
    if (ecosystemRoute && /(后台自检|自检更新|自动更新|自我净化|记忆净化|生态插件|插件|skill|技能)/i.test(original)) {
      return ecosystemRoute;
    }
    return brainMemoryRoute;
  }

  const ecosystemRoute = routeEcosystemIntent(original);
  if (ecosystemRoute) {
    return ecosystemRoute;
  }

  const modelChannel = parseModelChannelConfig(original);
  if (modelChannel.hasCandidateFields) {
    return {
      agent: 'model-agent',
      action: modelChannel.confidence === 'high' ? 'model-channel-switch' : 'model-channel-clarify',
      confidence: modelChannel.confidence,
      config: {
        url: modelChannel.url,
        apiKey: modelChannel.apiKey,
        maskedApiKey: modelChannel.maskedApiKey,
        model: modelChannel.model,
        simpleModel: modelChannel.simpleModel,
        thinkingModel: modelChannel.thinkingModel,
        endpointMode: modelChannel.endpointMode,
        scope: modelChannel.scope,
      },
      missing: modelChannel.missing,
      requiresAuth: true,
    };
  }

  const imageChannel = parseImageChannelConfig(original);
  if (imageChannel.hasCandidateFields) {
    return {
      agent: 'image-agent',
      action: imageChannel.confidence === 'high' ? 'image-channel-switch' : 'image-channel-clarify',
      confidence: imageChannel.confidence,
      config: {
        url: imageChannel.url,
        apiKey: imageChannel.apiKey,
        maskedApiKey: imageChannel.maskedApiKey,
        model: imageChannel.model,
        size: imageChannel.size,
        scope: imageChannel.scope,
      },
      missing: imageChannel.missing,
      requiresAuth: true,
    };
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

  const clerkRoute = routeClerkIntent(original);
  if (clerkRoute) {
    return clerkRoute;
  }

  const officeRoute = routeOfficeIntent(original);
  if (officeRoute) {
    return officeRoute;
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
  routeEcosystemIntent,
  looksLikeShortContinuationIntent,
  hasClerkWakeWord,
  routeClerkIntent,
  routeOfficeIntent,
  routeQaAssetIntent,
  routeNaturalLanguageOps,
  stripMention,
};
