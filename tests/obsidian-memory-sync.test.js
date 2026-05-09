const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildObsidianMemorySnapshot,
  syncObsidianMemoryVault,
} = require('../scripts/obsidian-memory-sync');

test('buildObsidianMemorySnapshot creates safe Obsidian markdown from memory and task brain', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'obsidian-memory-snapshot-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN","style":"直接"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"repository":"OpenclawHomework","capabilities":["UI 自动化"]}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\n飞书重复消息已修复', 'utf8');
    writeFileSync(join(tempDir, 'runbook-notes.md'), 'GITHUB_TOKEN=ghp_example', 'utf8');

    const snapshot = buildObsidianMemorySnapshot({
      memoryDir: tempDir,
      now: new Date('2026-05-10T08:00:00.000Z'),
      summarizeTaskCenterBrain: () => ({
        today: { day: '2026-05-10', summaryText: '今天完成 UI 自动化诊断卡。' },
        failureReview: {
          summaryText: '最近失败 1 个，主要是 workflow lookup。',
          recommendations: ['补跑 UI 自动化 smoke'],
        },
        nextPlan: {
          items: ['同步 Obsidian 记忆', '整理明日计划'],
          quickCommands: ['文员，同步 Obsidian 记忆'],
        },
        meta: { generatedAt: '2026-05-10T08:00:00.000Z' },
      }),
    });

    assert.equal(snapshot.day, '2026-05-10');
    assert.equal(snapshot.files.length, 5);
    assert.match(snapshot.files.find((file) => file.path === 'Project/Status.md').content, /OpenclawHomework/);
    assert.match(snapshot.files.find((file) => file.path === 'Daily/2026-05-10.md').content, /今天完成 UI 自动化诊断卡/);
    assert.match(snapshot.files.find((file) => file.path === 'Runbooks/Incidents.md').content, /飞书重复消息已修复/);
    assert.doesNotMatch(JSON.stringify(snapshot), /ghp_example|GITHUB_TOKEN/);
    assert.match(JSON.stringify(snapshot), /redacted secret-like memory content/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('syncObsidianMemoryVault writes vault files and index', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'obsidian-memory-sync-'));
  try {
    const memoryDir = join(tempDir, 'memory');
    const vaultDir = join(tempDir, 'vault');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'user-profile.json'), '{"language":"zh-CN"}', { encoding: 'utf8', flag: 'w' });
    writeFileSync(join(memoryDir, 'project-state.json'), '{"repository":"OpenclawHomework"}', 'utf8');

    const result = syncObsidianMemoryVault({
      memoryDir,
      vaultDir,
      now: new Date('2026-05-10T08:00:00.000Z'),
      summarizeTaskCenterBrain: () => ({
        today: { day: '2026-05-10', summaryText: '今日任务 2 个。' },
        failureReview: { summaryText: '暂无失败。' },
        nextPlan: { items: ['继续优化总控脑'] },
        meta: { generatedAt: '2026-05-10T08:00:00.000Z' },
      }),
    });

    assert.equal(result.written.length, 5);
    assert.equal(existsSync(join(vaultDir, 'Project', 'Status.md')), true);
    assert.equal(existsSync(join(vaultDir, 'Daily', '2026-05-10.md')), true);
    assert.equal(existsSync(join(vaultDir, 'Runbooks', 'Notes.md')), true);
    assert.match(readFileSync(join(vaultDir, 'Index.md'), 'utf8'), /Obsidian 记忆库索引/);
    assert.match(readFileSync(join(vaultDir, 'Daily', '2026-05-10.md'), 'utf8'), /今日任务 2 个/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
