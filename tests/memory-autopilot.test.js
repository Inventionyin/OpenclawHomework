const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildMemoryCandidateFromEvent,
  runMemoryAutopilot,
} = require('../scripts/memory-autopilot');

test('buildMemoryCandidateFromEvent creates long-term memory for explicit remember text', () => {
  const candidate = buildMemoryCandidateFromEvent({
    type: 'user-message',
    text: '这个问题以后别再踩坑：UI 自动化失败先看 Allure artifact',
    timestamp: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(candidate.kind, 'incident');
  assert.equal(candidate.shouldWrite, true);
  assert.match(candidate.summary, /UI 自动化失败先看 Allure artifact/);
  assert.equal(candidate.sourceEventType, 'user-message');
});

test('buildMemoryCandidateFromEvent rejects secret-like memory', () => {
  const candidate = buildMemoryCandidateFromEvent({
    type: 'user-message',
    text: '记住 GITHUB_TOKEN=ghp_example',
  });

  assert.equal(candidate.shouldWrite, false);
  assert.equal(candidate.reason, 'secret_like_text');
});

test('runMemoryAutopilot writes safe candidate and triggers sync', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-autopilot-'));
  try {
    const calls = [];
    const result = runMemoryAutopilot({
      event: {
        type: 'task-completed',
        taskType: 'ui-automation',
        summary: 'UI 自动化成功，Allure 报告已生成。',
        timestamp: '2026-05-10T00:00:00.000Z',
      },
      memoryDir: tempDir,
      now: new Date('2026-05-10T00:00:00.000Z'),
      syncObsidian: (options) => {
        calls.push(options);
        return { ok: true, written: ['Index.md'] };
      },
    });

    assert.equal(result.written, true);
    assert.equal(calls.length, 1);
    const notesFile = join(tempDir, 'runbook-notes.md');
    assert.equal(existsSync(notesFile), true);
    assert.match(readFileSync(notesFile, 'utf8'), /UI 自动化成功/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
