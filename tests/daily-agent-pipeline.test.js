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
    '--once',
    '--day',
    '2026-05-06',
    '--env-file',
    '/tmp/pipeline.env',
  ]), {
    dryRun: true,
    force: true,
    once: true,
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
    'trend-intel',
    'trend-token-factory',
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
    runTrendIntel: async () => {
      calls.push('trend-intel');
    },
    runTrendTokenFactory: async () => {
      calls.push('trend-token');
    },
    runScheduledTokenLab: async () => {
      calls.push('token');
    },
    runDigest: async () => {
      calls.push('digest');
    },
  });

  assert.equal(result.reason, 'dry_run');
  assert.equal(result.stages.length, 6);
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
      runTrendIntel: async () => ({
        report: { total: 2 },
      }),
      runTrendTokenFactory: async () => ({
        report: { totalJobs: 2, failedJobs: 0, totalTokens: 200 },
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
    assert.equal(result.stages[1].status, 'completed');
    assert.equal(result.stages[2].status, 'completed');
    assert.equal(result.stages[3].status, 'failed');
    assert.equal(result.stages[4].status, 'completed');
    assert.equal(result.stages[5].status, 'completed');

    const tasks = listTasks(result.env);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'daily-pipeline');
    assert.equal(tasks[0].status, 'failed');
    assert.equal(tasks[0].summary.completedStages, 5);
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
      runTrendIntel: async () => ({ report: { total: 2 } }),
      runTrendTokenFactory: async () => ({ report: { totalJobs: 2 } }),
      runScheduledUi: async () => ({ dispatched: true, state: { status: 'queued' } }),
      runScheduledTokenLab: async () => ({ ran: true, state: { totalJobs: 8 } }),
      runDigest: async () => ({ sent: true, reason: '' }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary.failedStages, 0);
    const tasks = listTasks(result.env);
    assert.equal(tasks[0].status, 'completed');
    assert.equal(tasks[0].summary.completedStages, 6);
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
      runTrendIntel: async () => ({ report: { total: 1 } }),
      runTrendTokenFactory: async () => ({ report: { totalJobs: 1 } }),
      runScheduledUi: async () => ({ dispatched: true }),
      runScheduledTokenLab: async () => ({ ran: true }),
      runDigest: async () => ({ sent: true }),
    });

    assert.equal(result.ok, true);
    assert.equal(existsSync(stateFile), true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.lastRunDay, '2026-05-06');
    assert.match(state.runId, /^daily-pipeline-2026-05-06-/);
    assert.equal(state.failedStages, 0);
    assert.equal(state.completedStages, 6);
    const trendIntelStage = state.stageStatuses.find((stage) => stage.id === 'trend-intel');
    const trendTokenStage = state.stageStatuses.find((stage) => stage.id === 'trend-token-factory');
    assert.equal(Boolean(trendIntelStage), true);
    assert.equal(Boolean(trendTokenStage), true);
    assert.equal(typeof trendIntelStage.startedAt, 'string');
    assert.equal(typeof trendIntelStage.endedAt, 'string');
    assert.equal(Number.isFinite(trendIntelStage.durationMs), true);
    const tasks = listTasks(result.env);
    assert.equal(tasks[0].summary.runId, state.runId);
    assert.equal(tasks[0].summary.stageDurations.some((stage) => stage.id === 'trend-intel' && Number.isFinite(stage.durationMs)), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runDailyAgentPipeline runs memory autopilot as final optional stage', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-pipeline-memory-'));
  try {
    const calls = [];
    const result = await runDailyAgentPipeline({
      env: {
        LOCAL_PROJECT_DIR: tempDir,
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
        DAILY_PIPELINE_MEMORY_AUTOPILOT_ENABLED: 'true',
      },
      day: '2026-05-10',
      force: true,
      runNewsDigest: async () => ({ ok: true }),
      runTrendIntel: async () => ({ ok: true }),
      runTrendTokenFactory: async () => ({ ok: true }),
      runScheduledUi: async () => ({ ok: true }),
      runScheduledTokenLab: async () => ({ ok: true }),
      runDigest: async () => ({ ok: true }),
      runMemoryAutopilot: (options) => {
        calls.push(options);
        return { written: true, syncResult: { written: ['Index.md'] } };
      },
    });

    assert.equal(result.summary.totalStages, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event.type, 'daily-pipeline-completed');
    assert.match(calls[0].event.summary, /completed/);
    assert.equal(result.stages.at(-1).id, 'memory-autopilot');
    assert.equal(result.stages.at(-1).status, 'completed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runDailyAgentPipeline returns readable domain summary for trend, token, ui and daily digest', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-agent-pipeline-summary-'));
  const result = await runDailyAgentPipeline({
    force: true,
    day: '2026-05-06',
    env: {
      TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
    },
    runNewsDigest: async () => ({ report: { total: 4 } }),
    runTrendIntel: async () => ({ report: { total: 5 }, reason: 'completed_with_degraded_sources' }),
    runTrendTokenFactory: async () => ({ report: { totalJobs: 3, totalTokens: 456 } }),
    runScheduledUi: async () => ({ dispatched: true, state: { status: 'queued' }, reason: 'queued_dispatch' }),
    runScheduledTokenLab: async () => ({ ran: true, state: { totalJobs: 9, totalTokens: 999 } }),
    runDigest: async () => ({ sent: true, reason: '' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.pipelineStatus, 'completed');
  assert.equal(result.summary.domains.uiAutomation.status, 'completed');
  assert.equal(result.summary.domains.trendIntel.status, 'degraded');
  assert.equal(result.summary.domains.trendIntel.stageId, 'trend-intel');
  assert.equal(result.summary.domains.trendTokenFactory.status, 'completed');
  assert.equal(result.summary.domains.dailyDigest.status, 'completed');
  const tasks = listTasks(result.env);
  assert.equal(tasks[0].summary.domains.trendIntel.status, 'degraded');
  assert.equal(tasks[0].summary.domains.uiAutomation.stageId, 'scheduled-ui');
  rmSync(tempDir, { recursive: true, force: true });
});

test('runDailyAgentPipeline degrades optional ui stage instead of failing pipeline', async () => {
  const result = await runDailyAgentPipeline({
    force: true,
    day: '2026-05-06',
    env: {
      TOKEN_FACTORY_TASK_DIR: join(tmpdir(), 'daily-agent-pipeline-ui-optional-tasks'),
      DAILY_PIPELINE_UI_OPTIONAL: 'true',
    },
    runNewsDigest: async () => ({ report: { total: 2 } }),
    runTrendIntel: async () => ({ report: { total: 2 } }),
    runTrendTokenFactory: async () => ({ report: { totalJobs: 2 } }),
    runScheduledUi: async () => {
      throw new Error('ui runner unavailable');
    },
    runScheduledTokenLab: async () => ({ ran: true }),
    runDigest: async () => ({ sent: true }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.failedStages, 0);
  assert.equal(result.summary.degradedStages, 1);
  const uiStage = result.stages.find((stage) => stage.id === 'scheduled-ui');
  assert.equal(uiStage.status, 'degraded');
  assert.equal(uiStage.reason, 'optional_stage_failed');
  assert.equal(result.summary.domains.uiAutomation.status, 'degraded');
});

test('runDailyAgentPipeline writes ops event when enabled', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-agent-pipeline-ops-events-'));
  try {
    const eventsFile = join(tempDir, 'ops-events.jsonl');
    const result = await runDailyAgentPipeline({
      force: true,
      day: '2026-05-06',
      env: {
        TOKEN_FACTORY_TASK_DIR: join(tempDir, 'tasks'),
        OPS_EVENT_LEDGER_ENABLED: 'true',
        OPS_EVENT_LEDGER_PATH: eventsFile,
      },
      runNewsDigest: async () => ({ report: { total: 2 } }),
      runTrendIntel: async () => ({ report: { total: 2 } }),
      runTrendTokenFactory: async () => ({ report: { totalJobs: 2 } }),
      runScheduledUi: async () => ({ dispatched: true }),
      runScheduledTokenLab: async () => ({ ran: true }),
      runDigest: async () => ({ sent: true }),
    });

    const event = JSON.parse(readFileSync(eventsFile, 'utf8').trim());
    assert.equal(event.module, 'daily-agent-pipeline');
    assert.equal(event.event, 'completed');
    assert.equal(event.runId, result.runId);
    assert.equal(event.status, 'completed');
    assert.equal(Number.isFinite(event.durationMs), true);
    assert.equal(event.metadata.totalStages, 6);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
