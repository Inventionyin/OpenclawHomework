const { join } = require('node:path');
const {
  buildAgentEvalTasks,
  buildCustomerServiceCases,
  buildEmailPlaybook,
  buildUiAutomationMatrix,
} = require('../qa-assets');
const {
  buildMemoryContext,
  buildMemorySearchContext,
  isSafeMemoryText,
  rememberMemoryNote,
} = require('./memory-store');
const {
  listCapabilities,
} = require('./capability-registry');

const OPS_SECRET_PATTERNS = [
  /\bauthorization\s*:\s*\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i,
];

const ALLOWED_OPS_ACTIONS = new Set([
  'status',
  'health',
  'watchdog',
  'logs',
  'restart',
  'repair',
  'exec',
  'memory-summary',
  'disk-summary',
  'disk-audit',
  'cleanup-confirm',
  'load-summary',
  'peer-status',
  'peer-health',
  'peer-logs',
  'peer-restart',
  'peer-repair',
  'peer-exec',
  'peer-memory-summary',
  'peer-disk-summary',
  'peer-load-summary',
  'clarify',
]);

const DANGEROUS_OPS_ACTIONS = new Set(['restart', 'repair', 'peer-restart', 'peer-repair']);

function trimForReply(value, limit = 1200) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isSafeOpsText(value) {
  const text = String(value ?? '');
  return isSafeMemoryText(text) && !OPS_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeReplyField(value, limit = 500) {
  if (!isSafeOpsText(value)) {
    return '[redacted secret-like output]';
  }
  return trimForReply(value, limit);
}

function buildDocAgentReply(text, memoryContext = buildMemoryContext()) {
  return [
    '已完成的主线能力：',
    '- 飞书 OpenClaw/Hermes 机器人接入',
    '- GitHub Actions UI 自动化触发',
    '- Allure/GitHub Actions 报告回传',
    '- 双服务器拆分、watchdog、去重、OpenClaw CLI 串行队列',
    '',
    '我当前参考的记忆摘要：',
    trimForReply(memoryContext, 700),
  ].join('\n');
}

function buildCapabilityGuideReply(assistantName = 'OpenClaw') {
  const capabilities = listCapabilities();
  return [
    `${assistantName} 当前适合这样玩：`,
    '',
    'UI 自动化：',
    '- 帮我跑一下 main 分支的 UI 自动化冒烟测试',
    '- 如何使用 /run-ui-test main smoke',
    '',
    '服务器运维：',
    '- 看我自己：你现在内存多少 / 你硬盘还剩多少 / 你现在卡不卡',
    '- 你现在内存多少',
    '- 你硬盘还剩多少',
    '- 硬盘清理：看看哪些东西占硬盘 / khoj 可以清理吗 / 确认清理第 1 个',
    '- 看对方：看看 Hermes 的服务器状态 / OpenClaw 硬盘还剩多少',
    '- 重启修复：修复你自己 / 修复 Hermes / 修复 OpenClaw',
    '',
    '记忆和接手：',
    '- /memory',
    '- /memory search session lock',
    '- /memory remember 今天修复了某个非敏感问题',
    '- Obsidian 存储和 GBrain 工作流怎么结合',
    '- 把这段经验沉淀到知识库：UI 自动化失败先看 Allure',
    '- 老师任务还差哪些',
    '',
    'QA 数据资产：',
    '- 帮我生成一批电商平台客服训练数据',
    '- 生成电商客服训练数据',
    '- 帮我做一轮 OpenClaw 和 Hermes 的能力评测',
    '- 整理一下 UI 自动化测试矩阵',
    '',
    '邮箱和报告：',
    '- UI 自动化完成后发报告到飞书和邮箱',
    '- 查看 ClawEmail/SMTP 是否正常时先问状态，不要发密钥',
    '',
    '图片生成：',
    '- 生成一张图片：赛博风电商客服机器人海报',
    '- /image 极简科技风商品主图',
    '',
    `已注册能力：${capabilities.map((capability) => capability.name).join('、')}`,
  ].join('\n');
}

function buildBrainGuideReply(assistantName = 'OpenClaw') {
  return [
    `${assistantName} 的长期记忆建议这样搭：`,
    '',
    'Obsidian：给你自己看的项目笔记库，适合放服务器接手手册、测试经验、邮箱规划、模型对比。',
    'GBrain：给 Agent 用的“脑库层”，后面接 MCP/技能后，可以把 Markdown、检索、知识图谱和定时任务接进 OpenClaw/Hermes。',
    '',
    '推荐分工：',
    '- OpenClaw：保留讯飞 CodingPlan，做稳定对照和 UI 自动化入口',
    '- Hermes：继续用 LongCat，做自然语言总控、资料生成、评测和知识整理',
    '- Obsidian/GBrain：沉淀长期记忆，不直接保存密钥',
    '',
    '你可以直接说：把这段经验沉淀到知识库：xxx',
  ].join('\n');
}

function buildPlannerClarifyReply(text = '') {
  return [
    '我可以继续，但这个需求有点大，我先帮你拆成可执行方向。',
    '',
    '你可以直接说其中一种：',
    '- 升级自然语言：让 OpenClaw/Hermes 更会聊天、更会判断任务',
    '- 优化服务器：看硬盘、内存、日志、重启和互修',
    '- 强化 UI 自动化：补用例、跑 GitHub Actions、整理 Allure 报告',
    '- 建知识库：把经验写进 Obsidian/GBrain 风格的长期记忆',
    '- 生成 QA 数据：电商客服训练数据、Agent 评测题、邮箱测试玩法',
    '',
    `我刚收到的是：${trimForReply(text, 120)}`,
  ].join('\n');
}

function buildMemoryAgentReply(route, memoryContext = buildMemoryContext(), options = {}) {
  if (route.action === 'brain-guide') {
    return buildBrainGuideReply(options.assistantName || 'OpenClaw');
  }

  if (route.action === 'remember') {
    try {
      rememberMemoryNote(
        options.noteFile || join(process.cwd(), 'data', 'memory', 'runbook-notes.md'),
        route.note,
      );
      return `已记住：${route.note}`;
    } catch (error) {
      return `不能保存疑似密钥或敏感信息：${error.message}`;
    }
  }

  if (route.action === 'search') {
    const searchMemoryContext = options.searchMemoryContext || buildMemorySearchContext;
    return searchMemoryContext(route.query);
  }

  return [
    '当前记忆摘要：',
    trimForReply(memoryContext, 1400),
  ].join('\n');
}

async function defaultRunOpsCheck() {
  return {
    service: 'bridge-service',
    active: 'unknown',
    health: 'not configured in local mode',
    watchdog: 'unknown',
    commit: 'unknown',
  };
}

function buildQaAgentReply(route = {}) {
  const customerCases = buildCustomerServiceCases();
  const agentTasks = buildAgentEvalTasks();
  const uiMatrix = buildUiAutomationMatrix();
  const emailPlaybook = buildEmailPlaybook();

  if (route.action === 'customer-service-data') {
    return [
      `已准备好一批电商客服训练数据：${customerCases.length} 条。`,
      '你可以直接让我继续做：',
      '- 抽 20 条给 AI 客服回答并评分',
      '- 把退款/物流/优惠券场景各扩展 100 条',
      '- 找出客服语料里还缺哪些场景',
      '',
      '数据位置：data/qa-assets/customer-service-cases.json',
      '建议归档邮箱：agent3.archive@claw.163.com',
    ].join('\n');
  }

  if (route.action === 'agent-eval') {
    return [
      `已准备好 OpenClaw/Hermes Agent 评测题：${agentTasks.length} 条。`,
      '可以这样玩：',
      '- 跑一轮 OpenClaw 和 Hermes 对比',
      '- 只测 UI 自动化、服务器运维、邮箱调度三类',
      '- 生成评分报告并发到 hagent.eval@claw.163.com',
      '',
      '数据位置：data/qa-assets/agent-eval-tasks.json',
    ].join('\n');
  }

  if (route.action === 'ui-matrix') {
    return [
      `已整理 UI 自动化测试矩阵：${uiMatrix.length} 条。`,
      '优先建议从 P0 开始：登录、邮箱验证码、搜索、加购、下单、AI 客服入口。',
      '你可以继续说：把 P0 转成 Playwright 用例 / 只看 AI 客服相关用例 / 生成 GitHub Actions 跑法。',
      '',
      '数据位置：data/qa-assets/ui-automation-matrix.json',
    ].join('\n');
  }

  if (route.action === 'email-playbook') {
    return [
      `邮箱平台玩法已经整理好：${emailPlaybook.length} 个动作入口。`,
      '最自然的用法：',
      '- 用 verify 邮箱测注册验证码',
      '- 把失败样本归档到 archive',
      '- 把 Agent 评测结果发到 eval',
      '- 每天发一封测试日报到 daily',
      '',
      '数据位置：data/qa-assets/email-playbook.json',
      '说明文档：docs/QA数据资产与邮箱平台玩法.md',
    ].join('\n');
  }

  return [
    '当前 QA 数据资产可以这样用：',
    `- 电商客服训练数据：${customerCases.length} 条`,
    `- Agent 评测题：${agentTasks.length} 条`,
    `- UI 自动化矩阵：${uiMatrix.length} 条`,
    `- 邮箱平台玩法：${emailPlaybook.length} 个动作`,
    '',
    '你可以直接说：帮我生成一批电商平台客服训练数据 / 做一轮 Agent 评测 / 整理 UI 自动化测试矩阵 / 邮箱平台可以怎么玩。',
  ].join('\n');
}

function targetLabel(target) {
  if (target === 'hermes') return 'Hermes';
  if (target === 'openclaw') return 'OpenClaw';
  if (target === 'peer') return '对方';
  return '我这台';
}

function buildClarifyReply(route) {
  const actionText = String(route.action || '').includes('repair') ? '修复' : '重启';
  const target = targetLabel(route.target);
  return [
    `你是想让我${actionText}${target === '我这台' ? '我自己' : target}吗？`,
    `为了避免误操作，请发更明确的一句，比如：${actionText}你自己 / ${actionText} Hermes / ${actionText} OpenClaw。`,
  ].join('\n');
}

function buildLowConfidenceOpsReply() {
  return [
    '我没完全听懂你想让我看哪台服务器，或者要做什么操作。',
    '可以这样说：',
    '- 你现在内存多少',
    '- 你硬盘还剩多少',
    '- 看看 Hermes 的服务器状态',
    '- 重启你自己',
    '- 修复 OpenClaw',
  ].join('\n');
}

function buildSummaryReply(route, result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const target = route.target && route.target !== 'self'
    ? targetLabel(route.target)
    : '我这台服务器';
  const lines = [
    `${target}目前${safeResult.active === 'active' ? '正常' : '状态需要留意'}。`,
  ];

  if (safeResult.memory) {
    lines.push(`内存：${sanitizeReplyField(safeResult.memory.total || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.memory.used || 'unknown')}，可用 ${sanitizeReplyField(safeResult.memory.free || 'unknown')}`);
  }
  if (safeResult.disk) {
    lines.push(`硬盘：${sanitizeReplyField(safeResult.disk.size || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.disk.used || 'unknown')}，剩余 ${sanitizeReplyField(safeResult.disk.available || 'unknown')}，使用率 ${sanitizeReplyField(safeResult.disk.usePercent || 'unknown')}`);
  }
  if (safeResult.load) {
    lines.push(`负载：${sanitizeReplyField(safeResult.load.loadAverage || 'unknown')}，CPU：${sanitizeReplyField(safeResult.load.cpu || 'unknown')}`);
  }

  lines.push(`服务：${sanitizeReplyField(safeResult.service || 'unknown')}（${sanitizeReplyField(safeResult.active || 'unknown')}）`);
  lines.push(`代码版本：${sanitizeReplyField(safeResult.commit || 'unknown')}`);
  return lines.join('\n');
}

function buildDiskAuditReply(result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const candidates = Array.isArray(safeResult.audit?.candidates) ? safeResult.audit.candidates : [];
  const lines = [
    '硬盘占用盘点：',
  ];

  if (safeResult.disk) {
    lines.push(`硬盘：${sanitizeReplyField(safeResult.disk.size || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.disk.used || 'unknown')}，剩余 ${sanitizeReplyField(safeResult.disk.available || 'unknown')}，使用率 ${sanitizeReplyField(safeResult.disk.usePercent || 'unknown')}`);
  }

  if (candidates.length === 0) {
    lines.push('暂时没有找到白名单内可建议清理的候选项。');
    return lines.join('\n');
  }

  candidates.forEach((candidate, index) => {
    const id = candidate.id || index + 1;
    const risk = candidate.risk === 'safe' ? '可清理' : '需确认';
    lines.push(`${id}. ${sanitizeReplyField(candidate.name || 'unknown')} ${sanitizeReplyField(candidate.size || 'unknown')} - ${sanitizeReplyField(candidate.path || 'unknown')}（${risk}）`);
    if (candidate.recommendation) {
      lines.push(`   ${sanitizeReplyField(candidate.recommendation)}`);
    }
  });

  lines.push('要执行请回复：确认清理第 1 个 / 清理 khoj。');
  return lines.join('\n');
}

function buildCleanupConfirmReply(result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  if (!safeResult.cleaned) {
    return [
      '还没有可执行的清理项。',
      safeResult.detail ? `原因：${sanitizeReplyField(safeResult.detail)}` : '请先说“看看哪些东西占硬盘”，让我先生成候选清单。',
    ].join('\n');
  }

  const cleaned = safeResult.cleaned;
  const before = cleaned.beforeAvailable || 'unknown';
  const after = cleaned.afterAvailable || 'unknown';
  return [
    `已清理 ${sanitizeReplyField(cleaned.name || 'unknown')}。`,
    `路径：${sanitizeReplyField(cleaned.path || 'unknown')}`,
    `硬盘剩余：${sanitizeReplyField(before)} -> ${sanitizeReplyField(after)}`,
    cleaned.detail ? `详情：${sanitizeReplyField(cleaned.detail)}` : null,
  ].filter(Boolean).join('\n');
}

async function buildOpsAgentReply(route, options = {}) {
  if (!ALLOWED_OPS_ACTIONS.has(route.action)) {
    return '不支持的运维指令。';
  }

  if (route.action === 'clarify' || route.confidence === 'low') {
    return buildLowConfidenceOpsReply();
  }

  if (DANGEROUS_OPS_ACTIONS.has(route.action) && route.confidence && route.confidence !== 'high') {
    return buildClarifyReply(route);
  }

  let result;
  try {
    result = await (options.runOpsCheck || defaultRunOpsCheck)(route.action, route);
  } catch (error) {
    return [
      '服务器状态暂时不可用。',
      `原因：${sanitizeReplyField(error.message || error)}`,
    ].join('\n');
  }

  const safeResult = result && typeof result === 'object' ? result : {};
  if (route.action === 'disk-audit') {
    return buildDiskAuditReply(safeResult);
  }
  if (route.action === 'cleanup-confirm') {
    return buildCleanupConfirmReply(safeResult);
  }
  if (/summary$/.test(route.action)) {
    return buildSummaryReply(route, safeResult);
  }

  return [
    '服务器状态摘要：',
    safeResult.target ? `目标：${sanitizeReplyField(safeResult.target || 'unknown')}` : null,
    safeResult.operation ? `操作：${sanitizeReplyField(safeResult.operation || 'unknown')}` : null,
    `服务：${sanitizeReplyField(safeResult.service || 'unknown')}`,
    `服务状态：${sanitizeReplyField(safeResult.active || 'unknown')}`,
    `健康检查：${sanitizeReplyField(safeResult.health || 'unknown')}`,
    `watchdog：${sanitizeReplyField(safeResult.watchdog || 'unknown')}`,
    `代码版本：${sanitizeReplyField(safeResult.commit || 'unknown')}`,
    safeResult.detail ? `详情：${sanitizeReplyField(safeResult.detail, 1000)}` : null,
  ].filter(Boolean).join('\n');
}

function buildChatAgentPrompt(text, memoryContext = '') {
  const parts = [
    '请基于以上记忆，用中文自然回答用户，像一个会一起做项目的助手。',
    '不要编造实时服务器状态；如果用户要实时状态，建议他说“你现在内存多少”“你硬盘还剩多少”或“看看服务器状态”。',
    '如果用户在聊想法，先正常解释和拆解，不要机械要求用户先查 /status。',
    `用户消息：${text}`,
  ];

  if (memoryContext) {
    parts.unshift(memoryContext, '');
  }

  return parts.join('\n');
}

module.exports = {
  ALLOWED_OPS_ACTIONS,
  buildCapabilityGuideReply,
  buildBrainGuideReply,
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildPlannerClarifyReply,
  buildQaAgentReply,
  isSafeOpsText,
  sanitizeReplyField,
  trimForReply,
};
