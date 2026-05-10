const { join } = require('node:path');
const {
  isSafeMemoryText,
  rememberMemoryNote,
} = require('./agents/memory-store');
const {
  syncObsidianMemoryVault,
} = require('./obsidian-memory-sync');

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function inferKind(event = {}, text = '') {
  if (/偏好|以后.*默认|默认.*用|我喜欢/.test(text)) return 'user-preference';
  if (/失败|报错|修复|事故|踩坑|问题/.test(text)) return 'incident';
  if (/步骤|流程|先看|检查|操作|runbook|以后/.test(text)) return 'procedure';
  if (event.taskType) return 'task-summary';
  return 'project-note';
}

function buildMemoryCandidateFromEvent(event = {}) {
  const text = normalizeText(event.text || event.summary || event.result || event.error || '');
  if (!text) {
    return { shouldWrite: false, reason: 'empty_event', sourceEventType: event.type || 'unknown' };
  }
  if (!isSafeMemoryText(text)) {
    return { shouldWrite: false, reason: 'secret_like_text', sourceEventType: event.type || 'unknown' };
  }

  const explicitMemory = /(记住|记一下|沉淀|以后别|以后.*踩坑|保存经验)/.test(text);
  const importantTask = ['task-completed', 'task-failed', 'daily-pipeline-completed'].includes(event.type)
    && /(ui|自动化|日报|pipeline|服务器|修复|token|邮件|热点)/i.test(String(event.taskType || text));
  const shouldWrite = explicitMemory || importantTask;

  return {
    shouldWrite,
    reason: shouldWrite ? 'accepted' : 'not_important',
    kind: inferKind(event, text),
    summary: text,
    sourceEventType: event.type || 'unknown',
    taskType: event.taskType,
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

function formatMemoryNote(candidate = {}) {
  return [
    `类型：${candidate.kind || 'project-note'}`,
    `来源：${candidate.sourceEventType || 'unknown'}${candidate.taskType ? ` / ${candidate.taskType}` : ''}`,
    `摘要：${candidate.summary}`,
  ].join('\n');
}

function runMemoryAutopilot(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const memoryDir = options.memoryDir || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory');
  const candidate = options.candidate || buildMemoryCandidateFromEvent(options.event || {});
  if (!candidate.shouldWrite) {
    return {
      written: false,
      candidate,
    };
  }

  rememberMemoryNote(join(memoryDir, 'runbook-notes.md'), formatMemoryNote(candidate), now);
  const syncer = options.syncObsidian || syncObsidianMemoryVault;
  let syncResult = null;
  try {
    syncResult = syncer({
      env,
      memoryDir,
      vaultDir: options.vaultDir,
      now,
      summarizeTaskCenterBrain: options.summarizeTaskCenterBrain,
    });
  } catch (error) {
    syncResult = { ok: false, error: error.message || String(error) };
  }

  return {
    written: true,
    candidate,
    syncResult,
  };
}

module.exports = {
  buildMemoryCandidateFromEvent,
  formatMemoryNote,
  runMemoryAutopilot,
};
