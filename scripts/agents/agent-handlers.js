const { join } = require('node:path');
const {
  buildMemoryContext,
  rememberMemoryNote,
} = require('./memory-store');

function trimForReply(value, limit = 1200) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
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
  const result = await (options.runOpsCheck || defaultRunOpsCheck)(route.action);
  return [
    '服务器状态摘要：',
    `服务：${result.service}`,
    `服务状态：${result.active}`,
    `健康检查：${result.health}`,
    `watchdog：${result.watchdog}`,
    `代码版本：${result.commit}`,
  ].join('\n');
}

function buildChatAgentPrompt(text, memoryContext = buildMemoryContext()) {
  return [
    memoryContext,
    '',
    '请基于以上记忆，用中文简洁回答用户。不要编造服务器状态；需要实时状态时提示用户使用 /status。',
    `用户消息：${text}`,
  ].join('\n');
}

module.exports = {
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  trimForReply,
};
