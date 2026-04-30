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

const ALLOWED_OPS_ACTIONS = new Set(['status', 'health', 'watchdog', 'logs']);

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

async function buildOpsAgentReply(route, options = {}) {
  if (!ALLOWED_OPS_ACTIONS.has(route.action)) {
    return `不支持的运维指令：${route.action}`;
  }

  let result;
  try {
    result = await (options.runOpsCheck || defaultRunOpsCheck)(route.action);
  } catch (error) {
    return [
      '服务器状态暂时不可用。',
      `原因：${sanitizeReplyField(error.message || error)}`,
    ].join('\n');
  }

  const safeResult = result && typeof result === 'object' ? result : {};
  return [
    '服务器状态摘要：',
    `服务：${sanitizeReplyField(safeResult.service || 'unknown')}`,
    `服务状态：${sanitizeReplyField(safeResult.active || 'unknown')}`,
    `健康检查：${sanitizeReplyField(safeResult.health || 'unknown')}`,
    `watchdog：${sanitizeReplyField(safeResult.watchdog || 'unknown')}`,
    `代码版本：${sanitizeReplyField(safeResult.commit || 'unknown')}`,
  ].join('\n');
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
