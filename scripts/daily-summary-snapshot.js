const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

function getDailySummaryStateFile(env = process.env) {
  return env.DAILY_SUMMARY_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'daily-summary-state.json');
}

function readDailySummaryState(env = process.env) {
  const filePath = getDailySummaryStateFile(env);
  if (!filePath || !existsSync(filePath)) {
    return { runs: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      ...parsed,
      runs: Array.isArray(parsed?.runs) ? parsed.runs : [],
    };
  } catch {
    return { runs: [] };
  }
}

function writeDailySummaryState(env = process.env, state = {}) {
  const filePath = getDailySummaryStateFile(env);
  mkdirSync(dirname(filePath), { recursive: true });
  const normalized = {
    ...state,
    runs: Array.isArray(state?.runs) ? state.runs : [],
  };
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function appendDailySummaryRun(env = process.env, run = {}, options = {}) {
  const limit = Number(options.limit || 20);
  const state = readDailySummaryState(env);
  const runs = Array.isArray(state.runs) ? state.runs : [];
  const nextRuns = [...runs, run].slice(-limit);
  const next = {
    ...state,
    runs: nextRuns,
  };
  writeDailySummaryState(env, next);
  return nextRuns;
}

function getDailySummarySnapshotFile(env = process.env) {
  return getDailySummaryStateFile(env);
}

function readDailySummarySnapshot(env = process.env) {
  return readDailySummaryState(env);
}

function writeDailySummarySnapshot(env = process.env, state = {}) {
  return writeDailySummaryState(env, state);
}

function appendDailySummaryRunSnapshot(env = process.env, jobOrRun = {}, runOrOptions = {}) {
  if (arguments.length >= 3) {
    const job = jobOrRun || {};
    const run = runOrOptions || {};
    const runUrl = run.html_url || job.actionsUrl || '';
    const artifactsUrl = runUrl ? `${runUrl}#artifacts` : '';
    return appendDailySummaryRun(env, {
      id: run.id || null,
      conclusion: run.conclusion || run.status || 'unknown',
      runUrl,
      artifactsUrl,
      targetRef: job.targetRef || job.config?.inputs?.target_ref || '',
      runMode: job.runMode || job.config?.inputs?.run_mode || '',
      updatedAt: run.updated_at || new Date().toISOString(),
    });
  }

  return appendDailySummaryRun(env, jobOrRun || {}, runOrOptions || {});
}

module.exports = {
  appendDailySummaryRun,
  appendDailySummaryRunSnapshot,
  getDailySummarySnapshotFile,
  getDailySummaryStateFile,
  readDailySummarySnapshot,
  readDailySummaryState,
  writeDailySummarySnapshot,
  writeDailySummaryState,
};
