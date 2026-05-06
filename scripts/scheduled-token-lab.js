#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const {
  runTokenLab,
} = require('./qa-token-lab');
const {
  sendMailboxActionEmail,
} = require('./feishu-bridge');
const {
  recordTaskEvent,
} = require('./task-center');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dryRun: false, force: false };
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
    } else if (arg === '--batch-size') {
      args.batchSize = argv[index + 1];
      index += 1;
    } else if (arg === '--output-dir') {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === '--job-timeout-ms') {
      args.jobTimeoutMs = argv[index + 1];
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

function readState(file) {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function runScheduledTokenLab(options = {}) {
  const env = { ...process.env, ...loadEnvFile(options.envFile), ...(options.env || {}) };
  const day = options.day || getDayKey(new Date(), env.SCHEDULED_TOKEN_LAB_TZ_OFFSET_MINUTES || 480);
  const now = new Date().toISOString();
  const stateFile = options.stateFile || env.SCHEDULED_TOKEN_LAB_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'scheduled-token-lab-state.json');
  const state = readState(stateFile);
  if (!options.force && state.lastRunDay === day) {
    return { ran: false, reason: 'already_ran', day };
  }

  const batchSize = Number(options.batchSize || env.SCHEDULED_TOKEN_LAB_BATCH_SIZE || env.QA_TOKEN_LAB_BATCH_SIZE || 12);
  const jobTimeoutMs = Number(options.jobTimeoutMs || env.SCHEDULED_TOKEN_LAB_JOB_TIMEOUT_MS || env.QA_TOKEN_LAB_JOB_TIMEOUT_MS || 120000);
  const outputDir = options.outputDir || env.SCHEDULED_TOKEN_LAB_OUTPUT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'qa-token-lab', day);
  if (options.dryRun) {
    return { ran: false, reason: 'dry_run', day, batchSize, jobTimeoutMs, outputDir };
  }

  const task = recordTaskEvent({
    taskId: `token-lab-${day}`,
    type: 'token-lab',
    event: 'scheduled',
    status: 'running',
    now,
    summaryPatch: {
      day,
      batchSize,
      jobTimeoutMs,
    },
    filesPatch: {
      outputDir,
    },
  }, { env, now });

  let result;
  try {
    result = await (options.runner || runTokenLab)({
      batchSize,
      jobTimeoutMs,
      outputDir,
      env,
      assistant: env.PROACTIVE_DIGEST_ASSISTANT_NAME || env.FEISHU_ASSISTANT_NAME || 'Hermes',
      emailSender: options.emailSender || ((message, senderEnv) => sendMailboxActionEmail(message, senderEnv)),
      modelRunner: options.modelRunner,
    });
  } catch (error) {
    recordTaskEvent({
      taskId: task.id,
      type: 'token-lab',
      event: 'failed',
      status: 'failed',
      now: new Date().toISOString(),
      error: String(error?.message || error || 'token lab failed'),
      summaryPatch: {
        day,
        batchSize,
        jobTimeoutMs,
      },
      filesPatch: {
        outputDir,
      },
    }, { env });
    throw error;
  }
  const nextState = {
    lastRunDay: day,
    lastRunAt: new Date().toISOString(),
    batchSize,
    jobTimeoutMs,
    totalJobs: result.report.totalJobs,
    failedJobs: result.report.failedJobs,
    totalTokens: result.report.totalTokens,
    estimatedTotalTokens: result.report.estimatedTotalTokens,
    outputDir,
    files: result.files,
  };
  writeState(stateFile, nextState);
  recordTaskEvent({
    taskId: task.id,
    type: 'token-lab',
    event: 'completed',
    status: 'completed',
    now: new Date().toISOString(),
    summaryPatch: {
      day,
      batchSize,
      jobTimeoutMs,
      totalJobs: result.report.totalJobs,
      failedJobs: result.report.failedJobs,
      totalTokens: result.report.totalTokens,
      estimatedTotalTokens: result.report.estimatedTotalTokens,
    },
    filesPatch: {
      outputDir,
      ...(result.files || {}),
    },
  }, { env });
  return { ran: true, day, result, state: nextState, env };
}

async function main() {
  const options = parseArgs();
  const result = await runScheduledTokenLab(options);
  console.log(JSON.stringify({
    ran: result.ran,
    reason: result.reason,
    day: result.day,
    totalJobs: result.state?.totalJobs,
    totalTokens: result.state?.totalTokens,
    estimatedTotalTokens: result.state?.estimatedTotalTokens,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  getDayKey,
  parseArgs,
  runScheduledTokenLab,
};
