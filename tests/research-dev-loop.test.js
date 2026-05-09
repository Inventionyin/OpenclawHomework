const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildResearchDevLoopPlan,
  formatResearchDevLoopReply,
  runResearchDevLoop,
} = require('../scripts/research-dev-loop');
const {
  readTask,
} = require('../scripts/background-task-store');

test('buildResearchDevLoopPlan creates RD-Agent style loop fields', () => {
  const plan = buildResearchDevLoopPlan('优化电商 UI 自动化测试');

  assert.equal(plan.goal, '优化电商 UI 自动化测试');
  assert.equal(plan.loop.length, 6);
  assert.deepEqual(plan.loop.map((step) => step.id), ['idea', 'plan', 'execute', 'evaluate', 'learn', 'next']);
  assert.match(plan.hypothesis, /UI 自动化|测试/);
  assert(plan.metrics.some((metric) => metric.id === 'pass-rate'));
  assert(plan.nextActions.some((action) => /smoke|冒烟|UI/.test(action)));
});

test('runResearchDevLoop records a task-center experiment task', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'research-dev-loop-'));
  const env = { TOKEN_FACTORY_TASK_DIR: tempDir };
  try {
    const result = await runResearchDevLoop({
      goal: '让热点雷达更准确',
      env,
      now: new Date('2026-05-09T12:00:00.000Z'),
    });

    assert.equal(result.status, 'planned');
    assert.equal(result.task.type, 'research-dev-loop');
    assert.equal(result.task.status, 'queued');
    assert.equal(result.task.summary.goal, '让热点雷达更准确');
    assert.equal(result.task.summary.loop.length, 6);

    const saved = readTask(result.task.id, env);
    assert.equal(saved.summary.hypothesis, result.plan.hypothesis);
    assert.deepEqual(saved.summary.metrics.map((metric) => metric.id), result.plan.metrics.map((metric) => metric.id));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('formatResearchDevLoopReply explains the next executable steps', () => {
  const reply = formatResearchDevLoopReply({
    plan: buildResearchDevLoopPlan('提升邮箱审批闭环'),
    task: { id: 'rd-1' },
  });

  assert.match(reply, /RD-Agent-lite/);
  assert.match(reply, /rd-1/);
  assert.match(reply, /Research/);
  assert.match(reply, /Development/);
  assert.match(reply, /下一步/);
});
