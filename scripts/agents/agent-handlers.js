const { join } = require('node:path');
const {
  buildMemoryContext,
  isSafeMemoryText,
  rememberMemoryNote,
} = require('./memory-store');

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

function buildMemoryAgentReply(route, memoryContext = buildMemoryContext(), options = {}) {
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
    '请基于以上记忆，用中文简洁回答用户。不要编造服务器状态；需要实时状态时提示用户使用 /status。',
    `用户消息：${text}`,
  ];

  if (memoryContext) {
    parts.unshift(memoryContext, '');
  }

  return parts.join('\n');
}

module.exports = {
  ALLOWED_OPS_ACTIONS,
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  isSafeOpsText,
  sanitizeReplyField,
  trimForReply,
};
