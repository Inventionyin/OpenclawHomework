const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  isSafeMemoryText,
  readJsonMemory,
  readTextFile,
} = require('./agents/memory-store');
const {
  summarizeTaskCenterBrain,
} = require('./task-center');

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeText(text = '', fallback = '[redacted secret-like memory content]') {
  const value = String(text ?? '');
  return isSafeMemoryText(value) ? value : fallback;
}

function safeJson(value = {}) {
  const text = JSON.stringify(value || {}, null, 2);
  return isSafeMemoryText(text) ? text : JSON.stringify({ redacted: true }, null, 2);
}

function listLines(items = []) {
  const normalized = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!normalized.length) return '- 暂无';
  return normalized.map((item) => `- ${safeText(typeof item === 'string' ? item : JSON.stringify(item))}`).join('\n');
}

function buildProjectStatusMarkdown({ memoryDir, brain, now }) {
  const userProfile = readJsonMemory(join(memoryDir, 'user-profile.json'), {});
  const projectState = readJsonMemory(join(memoryDir, 'project-state.json'), {});
  return [
    '---',
    'type: project-status',
    `updated: ${now.toISOString()}`,
    'tags: [memory, project, openclaw-hermes]',
    '---',
    '',
    '# 项目状态',
    '',
    '## 用户偏好',
    '```json',
    safeJson(userProfile),
    '```',
    '',
    '## 项目事实',
    '```json',
    safeJson(projectState),
    '```',
    '',
    '## 今日任务摘要',
    safeText(brain?.today?.summaryText || '暂无今日任务摘要。'),
  ].join('\n');
}

function buildDailyMarkdown({ brain, now, day }) {
  const failure = brain?.failureReview || {};
  const nextPlan = brain?.nextPlan || {};
  return [
    '---',
    `date: ${day}`,
    'source: task-center',
    'tags: [daily, task-center, postmortem]',
    `generated_at: ${now.toISOString()}`,
    '---',
    '',
    `# ${day} 今日总结`,
    '',
    '## 今日总结',
    safeText(brain?.today?.summaryText || '暂无今日总结。'),
    '',
    '## 失败复盘',
    safeText(failure.summaryText || '暂无失败复盘。'),
    '',
    '## 修复建议',
    listLines(failure.recommendations || []),
    '',
    '## 下一步计划',
    listLines(nextPlan.items || []),
    '',
    '## 快捷指令',
    listLines(nextPlan.quickCommands || []),
  ].join('\n');
}

function buildIncidentsMarkdown(memoryDir) {
  return [
    '# 事故和修复记录',
    '',
    safeText(readTextFile(join(memoryDir, 'incident-log.md'), '暂无事故记录。')),
  ].join('\n');
}

function buildRunbookMarkdown(memoryDir) {
  return [
    '# 运维和项目笔记',
    '',
    safeText(readTextFile(join(memoryDir, 'runbook-notes.md'), '暂无运维笔记。')),
  ].join('\n');
}

function buildIndexMarkdown({ day, now }) {
  return [
    '---',
    'type: obsidian-index',
    `updated: ${now.toISOString()}`,
    'tags: [memory, obsidian]',
    '---',
    '',
    '# Obsidian 记忆库索引',
    '',
    '- [[Project/Status]]',
    `- [[Daily/${day}]]`,
    '- [[Runbooks/Incidents]]',
    '- [[Runbooks/Notes]]',
    '',
    '说明：该 vault 由 OpenClawHomework 自动从 data/memory 和 task-center 摘要生成；密钥类内容会被脱敏。',
  ].join('\n');
}

function buildObsidianMemorySnapshot(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const day = options.day || dayKey(now);
  const memoryDir = options.memoryDir || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory');
  const brain = (options.summarizeTaskCenterBrain || summarizeTaskCenterBrain)({
    env,
    now,
  });
  const files = [
    { path: 'Index.md', content: buildIndexMarkdown({ day, now }) },
    { path: 'Project/Status.md', content: buildProjectStatusMarkdown({ memoryDir, brain, now }) },
    { path: `Daily/${day}.md`, content: buildDailyMarkdown({ brain, now, day }) },
    { path: 'Runbooks/Incidents.md', content: buildIncidentsMarkdown(memoryDir) },
    { path: 'Runbooks/Notes.md', content: buildRunbookMarkdown(memoryDir) },
  ];

  return {
    day,
    generatedAt: now.toISOString(),
    files,
  };
}

function syncObsidianMemoryVault(options = {}) {
  const env = options.env || process.env;
  const vaultDir = options.vaultDir || env.OBSIDIAN_VAULT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'obsidian-vault');
  const snapshot = buildObsidianMemorySnapshot(options);
  const written = [];
  for (const file of snapshot.files) {
    const target = join(vaultDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
    written.push(target);
  }
  return {
    ...snapshot,
    vaultDir,
    written,
  };
}

module.exports = {
  buildObsidianMemorySnapshot,
  syncObsidianMemoryVault,
};
