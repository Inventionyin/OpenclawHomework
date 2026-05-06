const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  runScheduledTokenLab,
} = require('../scripts/scheduled-token-lab');

test('parseArgs reads scheduled token lab options', () => {
  assert.deepEqual(parseArgs([
    '--dry-run',
    '--force',
    '--batch-size',
    '24',
    '--output-dir',
    '/tmp/lab',
    '--day',
    '2026-05-06',
  ]), {
    dryRun: true,
    force: true,
    batchSize: '24',
    outputDir: '/tmp/lab',
    day: '2026-05-06',
  });
});

test('runScheduledTokenLab dry-run returns resolved schedule settings', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scheduled-token-lab-dry-'));
  try {
    const result = await runScheduledTokenLab({
      dryRun: true,
      force: true,
      day: '2026-05-06',
      stateFile: join(tempDir, 'state.json'),
      env: {
        SCHEDULED_TOKEN_LAB_BATCH_SIZE: '18',
        LOCAL_PROJECT_DIR: tempDir,
      },
    });

    assert.equal(result.reason, 'dry_run');
    assert.equal(result.batchSize, 18);
    assert.match(result.outputDir, /qa-token-lab/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runScheduledTokenLab writes state and skips same-day runs', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scheduled-token-lab-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const result = await runScheduledTokenLab({
      force: true,
      day: '2026-05-06',
      stateFile,
      outputDir: join(tempDir, 'output'),
      env: {},
      runner: async (options) => ({
        report: {
          totalJobs: options.batchSize,
          failedJobs: 1,
          totalTokens: 1200,
          estimatedTotalTokens: 1400,
        },
        files: {
          plan: join(tempDir, 'output', 'plan.json'),
          items: join(tempDir, 'output', 'items.json'),
          report: join(tempDir, 'output', 'report.md'),
        },
      }),
    });

    assert.equal(result.ran, true);
    assert.equal(result.state.totalJobs, 12);
    assert.equal(result.state.failedJobs, 1);
    assert.equal(result.state.totalTokens, 1200);
    assert.equal(existsSync(stateFile), true);
    assert.match(readFileSync(stateFile, 'utf8'), /2026-05-06/);

    const skipped = await runScheduledTokenLab({
      day: '2026-05-06',
      stateFile,
      env: {},
    });
    assert.equal(skipped.reason, 'already_ran');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
