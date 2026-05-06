#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const {
  runNewsDigest,
} = require('./news-digest');
const {
  runScheduledUi,
} = require('./scheduled-ui-runner');
const {
  runScheduledTokenLab,
} = require('./scheduled-token-lab');
const {
  runDigest,
} = require('./proactive-daily-digest');
const {
  recordTaskEvent,
} = require('./task-center');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--env-file') {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === '--state-file') {
      args.stateFile = argv[index + 1];
      index += 1;
    } else if (arg === '--day') {
      args.day = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function getDayKey(now = new Date(), offsetMinutes = 480) {
  return new Date(now.getTime() + Number(offsetMinutes || 0) * 60 * 1000).toISOString().slice(0, 10);
}

function buildPipelinePlan(options = {}) {
  return {
    day: options.day || '',
    stages: [
      { id: 'news-digest', label: '新闻摘要' },
      { id: 'scheduled-ui', label: 'UI 自动化' },
      { id: 'scheduled-token-lab', label: 'Token 训练场' },
      { id: 'proactive-daily-digest', label: '主动日报' },
    ],
  };
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/g, '$1***')
    .replace(/\b(sk|ak)_[A-Za-z0-9._-]{8,}\b/g, '$1_***')
    .slice(0, 1000);
}

function writeState(filePath, state) {
  if (!filePath) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function runPipelineStage(stage, context) {
  try {
    const result = await stage.run();
    return {
      id: stage.id,
      label: stage.label,
      status: 'completed',
      reason: result?.reason || '',
      result,
    };
  } catch (error) {
    return {
      id: stage.id,
      label: stage.label,
      status: 'failed',
      reason: 'runner_failed',
      error: sanitizeError(error),
    };
  }
}

async function runDailyAgentPipeline(options = {}) {
  const env = {
    ...process.env,
    ...loadEnvFile(options.envFile),
    ...(options.env || {}),
  };
  const day = options.day || getDayKey(new Date(), env.PROACTIVE_DIGEST_TZ_OFFSET_MINUTES || 480);
  const plan = buildPipelinePlan({ day });
  const stateFile = options.stateFile || env.DAILY_AGENT_PIPELINE_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'daily-agent-pipeline-state.json');
  if (options.dryRun) {
    return {
      ok: true,
      reason: 'dry_run',
      day,
      env,
      stages: plan.stages.map((stage) => ({ ...stage, status: 'planned' })),
      summary: {
        totalStages: plan.stages.length,
        completedStages: 0,
        failedStages: 0,
      },
    };
  }

  const now = new Date().toISOString();
  const task = recordTaskEvent({
    taskId: `daily-pipeline-${day}`,
    type: 'daily-pipeline',
    event: 'scheduled',
    status: 'running',
    now,
    summaryPatch: {
      day,
      totalStages: plan.stages.length,
    },
  }, { env, now });

  const stageDefs = [
    {
      id: 'news-digest',
      label: '新闻摘要',
      run: () => (options.runNewsDigest || runNewsDigest)({ day, force: options.force, env }),
    },
    {
      id: 'scheduled-ui',
      label: 'UI 自动化',
      run: () => (options.runScheduledUi || runScheduledUi)({ day, force: options.force, env }),
    },
    {
      id: 'scheduled-token-lab',
      label: 'Token 训练场',
      run: () => (options.runScheduledTokenLab || runScheduledTokenLab)({ day, force: options.force, env }),
    },
    {
      id: 'proactive-daily-digest',
      label: '主动日报',
      run: () => (options.runDigest || runDigest)({ day, force: options.force, env }),
    },
  ];

  const stages = [];
  for (const stage of stageDefs) {
    stages.push(await runPipelineStage(stage, { day, env }));
  }

  const failedStages = stages.filter((stage) => stage.status === 'failed');
  const completedStages = stages.filter((stage) => stage.status === 'completed');
  const ok = failedStages.length === 0;
  const finalEvent = ok ? 'completed' : 'completed_with_failures';
  writeState(stateFile, {
    lastRunDay: day,
    lastRunAt: new Date().toISOString(),
    totalStages: stages.length,
    completedStages: completedStages.length,
    failedStages: failedStages.length,
    stageStatuses: stages.map((stage) => ({
      id: stage.id,
      status: stage.status,
      reason: stage.reason || '',
    })),
  });
  recordTaskEvent({
    taskId: task.id,
    type: 'daily-pipeline',
    event: finalEvent,
    status: ok ? 'completed' : 'failed',
    now: new Date().toISOString(),
    summaryPatch: {
      day,
      totalStages: stages.length,
      completedStages: completedStages.length,
      failedStages: failedStages.length,
      failedStageIds: failedStages.map((stage) => stage.id).join(','),
    },
    error: failedStages.length ? failedStages.map((stage) => `${stage.id}: ${stage.error || stage.reason}`).join(' | ') : '',
  }, { env });

  return {
    ok,
    day,
    env,
    stages,
    summary: {
      totalStages: stages.length,
      completedStages: completedStages.length,
      failedStages: failedStages.length,
    },
  };
}

async function main() {
  const options = parseArgs();
  const result = await runDailyAgentPipeline(options);
  console.log(JSON.stringify({
    ok: result.ok,
    reason: result.reason,
    day: result.day,
    summary: result.summary,
    stages: result.stages?.map((stage) => ({
      id: stage.id,
      status: stage.status,
      reason: stage.reason || '',
    })),
  }, null, 2));
  if (!result.ok && result.reason !== 'dry_run') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildPipelinePlan,
  parseArgs,
  runDailyAgentPipeline,
};
