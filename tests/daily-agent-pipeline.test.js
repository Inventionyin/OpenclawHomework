const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildPipelinePlan,
  parseArgs,
  runDailyAgentPipeline,
} = require('../scripts/daily-agent-pipeline');
const {
  listTasks,
} = require('../scripts/background-task-store');

test('parseArgs reads daily pipeline options', () => {
  assert.deepEqual(parseArgs([
    '--dry-run',
    '--force',
    '--day',
    '2026-05-06',
    '--env-file',
    '/tmp/pipeline.env',
  ]), {
    dryRun: true,
    force: true,
    day: '2026-05-06',
    envFile: '/tmp/pipeline.env',
  });
});

test('buildPipelinePlan returns ordered stages', () => {
  const plan = buildPipelinePlan({
    day: '2026-05-06',
  });

  assert.equal(plan.day, '2026-05-06');
  assert.deepEqual(plan.stages.map((stage) => stage.id), [
    'news-digest',
    'scheduled-ui',
    'scheduled-token-lab',
    'proactive-daily-digest',
  ]);
});

test('runDailyAgentPipeline dry-run returns stage plan without executing runners', async () => {
  const calls = [];
  const result = await runDailyAgentPipeline({
    dryRun: true,
    force: true,
    day: '2026-05-06',
    runNewsDigest: async () => {
      calls.push('news');
    },
    runScheduledUi: async () => {
      calls.push('ui');
    },
    runScheduledTokenLab: async () => {
      calls.push('token');
    },
    runDigest: async () => {
      calls.push('digest');
    },
  });

  assert.equal(result.reason, 'dry_run');
  assert.equal(result.stages.length, 4);
  assert.deepEqual(calls, []);
  assert(result.stages.every((stage) => stage.status === 'planned'));
});

test('runDailyAgentPipeline executes all stages and keeps going after failure', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-agent-pipeline-'));
  try {
    const result = await runDailyAgentPipeline({
      force: true,
      day: '2026-05-06',
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
      },
      runNewsDigest: async () => ({
        report: { total: 3 },
      }),
      runScheduledUi: async () => {
        throw new Error('ui dispatch timeout');
      },
      runScheduledTokenLab: async () => ({
        state: { totalJobs: 12, totalTokens: 1200 },
      }),
      runDigest: async () => ({
        sent: true,
        reason: '',
        message: { subject: '[Daily] ok' },
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.summary.failedStages, 1);
    assert.equal(result.stages[0].status, 'completed');
    assert.equal(result.stages[1].status, 'failed');
    assert.equal(result.stages[2].status, 'completed');
    assert.equal(result.stages[3].status, 'completed');

    const tasks = listTasks(result.env);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'daily-pipeline');
    assert.equal(tasks[0].status, 'failed');
    assert.equal(tasks[0].summary.completedStages, 3);
    assert.equal(tasks[0].summary.failedStages, 1);
    assert(tasks[0].events.some((event) => event.event === 'scheduled'));
    assert(tasks[0].events.some((event) => event.event === 'completed_with_failures'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runDailyAgentPipeline marks completed when all stages succeed', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-agent-pipeline-ok-'));
  try {
    const result = await runDailyAgentPipeline({
      force: true,
      day: '2026-05-06',
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
      },
      runNewsDigest: async () => ({ report: { total: 2 } }),
      runScheduledUi: async () => ({ dispatched: true, state: { status: 'queued' } }),
      runScheduledTokenLab: async () => ({ ran: true, state: { totalJobs: 8 } }),
      runDigest: async () => ({ sent: true, reason: '' }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary.failedStages, 0);
    const tasks = listTasks(result.env);
    assert.equal(tasks[0].status, 'completed');
    assert.equal(tasks[0].summary.completedStages, 4);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runDailyAgentPipeline writes state file when provided', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-agent-pipeline-state-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const result = await runDailyAgentPipeline({
      force: true,
      day: '2026-05-06',
      stateFile,
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
      },
      runNewsDigest: async () => ({ report: { total: 1 } }),
      runScheduledUi: async () => ({ dispatched: true }),
      runScheduledTokenLab: async () => ({ ran: true }),
      runDigest: async () => ({ sent: true }),
    });

    assert.equal(result.ok, true);
    assert.equal(existsSync(stateFile), true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.lastRunDay, '2026-05-06');
    assert.equal(state.failedStages, 0);
    assert.equal(state.completedStages, 4);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
