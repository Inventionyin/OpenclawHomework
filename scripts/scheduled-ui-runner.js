#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const {
  dispatchWorkflow,
  parseCliArgs: parseTriggerCliArgs,
} = require('./trigger-ui-tests');

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
    } else if (arg === '--run-mode') {
      args.runMode = argv[index + 1];
      index += 1;
    } else if (arg === '--mailbox-action') {
      args.mailboxAction = argv[index + 1];
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

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/g, '$1***')
    .slice(0, 1000);
}

function buildTriggerArgs(options = {}, env = process.env) {
  const args = [
    '--run-mode',
    options.runMode || env.SCHEDULED_UI_RUN_MODE || env.UI_TEST_RUN_MODE || 'contracts',
    '--mailbox-action',
    options.mailboxAction || env.SCHEDULED_UI_MAILBOX_ACTION || env.UI_TEST_MAILBOX_ACTION || 'report',
  ];
  if (env.SCHEDULED_UI_TARGET_REPOSITORY || env.UI_TEST_TARGET_REPOSITORY) {
    args.push('--target-repository', env.SCHEDULED_UI_TARGET_REPOSITORY || env.UI_TEST_TARGET_REPOSITORY);
  }
  if (env.SCHEDULED_UI_TARGET_REF || env.UI_TEST_TARGET_REF) {
    args.push('--target-ref', env.SCHEDULED_UI_TARGET_REF || env.UI_TEST_TARGET_REF);
  }
  if (env.SCHEDULED_UI_APP_REPOSITORY || env.UI_TEST_APP_REPOSITORY) {
    args.push('--app-repository', env.SCHEDULED_UI_APP_REPOSITORY || env.UI_TEST_APP_REPOSITORY);
  }
  if (env.SCHEDULED_UI_APP_REF || env.UI_TEST_APP_REF) {
    args.push('--app-ref', env.SCHEDULED_UI_APP_REF || env.UI_TEST_APP_REF);
  }
  if (env.SCHEDULED_UI_BASE_URL || env.UI_TEST_BASE_URL) {
    args.push('--base-url', env.SCHEDULED_UI_BASE_URL || env.UI_TEST_BASE_URL);
  }
  return args;
}

async function runScheduledUi(options = {}) {
  const env = { ...process.env, ...loadEnvFile(options.envFile), ...(options.env || {}) };
  const day = options.day || getDayKey(new Date(), env.SCHEDULED_UI_TZ_OFFSET_MINUTES || 480);
  const stateFile = options.stateFile || env.SCHEDULED_UI_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'scheduled-ui-runner-state.json');
  const state = readState(stateFile);
  if (!options.force && state.lastRunDay === day) {
    return { dispatched: false, reason: 'already_ran', day };
  }

  const triggerArgs = buildTriggerArgs(options, env);
  const config = parseTriggerCliArgs(triggerArgs, env);
  if (options.dryRun) {
    return { dispatched: false, reason: 'dry_run', day, config };
  }

  let result;
  try {
    result = await (options.dispatcher || dispatchWorkflow)(config, options.fetchImpl || fetch);
  } catch (error) {
    const failedState = {
      lastRunDay: day,
      lastRunAt: new Date().toISOString(),
      runMode: config.inputs.run_mode,
      mailboxAction: config.inputs.mailbox_action,
      targetRepository: config.inputs.target_repository,
      targetRef: config.inputs.target_ref,
      appRepository: config.inputs.app_repository,
      appRef: config.inputs.app_ref,
      status: 'dispatch_failed',
      error: sanitizeError(error),
    };
    writeState(stateFile, failedState);
    throw error;
  }
  const nextState = {
    lastRunDay: day,
    lastRunAt: new Date().toISOString(),
    runMode: config.inputs.run_mode,
    mailboxAction: config.inputs.mailbox_action,
    targetRepository: config.inputs.target_repository,
    targetRef: config.inputs.target_ref,
    appRepository: config.inputs.app_repository,
    appRef: config.inputs.app_ref,
    workflowRunUrl: result.workflowRunUrl || result.run?.html_url || '',
    runId: result.run?.id,
    status: result.workflowRunUrl || result.run?.html_url
      ? (result.run?.status || 'dispatched')
      : 'run_lookup_not_found',
    lookup: result.lookup,
    actionsUrl: result.actionsUrl,
  };
  writeState(stateFile, nextState);
  return { dispatched: true, day, config, result, state: nextState };
}

async function main() {
  const options = parseArgs();
  const result = await runScheduledUi(options);
  console.log(JSON.stringify({
    dispatched: result.dispatched,
    reason: result.reason,
    day: result.day,
    runMode: result.config?.inputs?.run_mode,
    workflowRunUrl: result.result?.workflowRunUrl,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildTriggerArgs,
  getDayKey,
  parseArgs,
  runScheduledUi,
};
