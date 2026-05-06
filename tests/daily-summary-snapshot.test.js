const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  appendDailySummaryRun,
  getDailySummaryStateFile,
  readDailySummaryState,
  writeDailySummaryState,
} = require('../scripts/daily-summary-snapshot');

test('daily summary snapshot resolves state file path from env and default project dir', () => {
  const custom = getDailySummaryStateFile({ DAILY_SUMMARY_STATE_FILE: '/tmp/custom-state.json' });
  assert.equal(custom, '/tmp/custom-state.json');

  const fromProject = getDailySummaryStateFile({ LOCAL_PROJECT_DIR: '/tmp/project-a' });
  assert.equal(fromProject, join('/tmp/project-a', 'data', 'memory', 'daily-summary-state.json'));
});

test('daily summary snapshot reads missing and broken state as empty runs', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-snapshot-read-'));
  const stateFile = join(tempDir, 'daily-summary-state.json');
  const env = { DAILY_SUMMARY_STATE_FILE: stateFile };
  try {
    assert.deepEqual(readDailySummaryState(env), { runs: [] });

    writeFileSync(stateFile, '{not-valid-json', 'utf8');
    assert.deepEqual(readDailySummaryState(env), { runs: [] });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('daily summary snapshot writes normalized state and appends runs with limit', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-snapshot-write-'));
  const stateFile = join(tempDir, 'nested', 'daily-summary-state.json');
  const env = { DAILY_SUMMARY_STATE_FILE: stateFile };
  try {
    const saved = writeDailySummaryState(env, { hello: 'world', runs: 'bad' });
    assert.equal(existsSync(stateFile), true);
    assert.equal(saved.hello, 'world');
    assert.deepEqual(saved.runs, []);

    const run1 = { id: 1, conclusion: 'success' };
    const run2 = { id: 2, conclusion: 'failure' };
    const run3 = { id: 3, conclusion: 'success' };
    appendDailySummaryRun(env, run1, { limit: 2 });
    appendDailySummaryRun(env, run2, { limit: 2 });
    const latest = appendDailySummaryRun(env, run3, { limit: 2 });

    assert.deepEqual(latest, [run2, run3]);
    assert.deepEqual(readDailySummaryState(env).runs, [run2, run3]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

