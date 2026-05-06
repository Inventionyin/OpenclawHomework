const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildTriggerArgs,
  parseArgs,
  runScheduledUi,
} = require('../scripts/scheduled-ui-runner');

test('buildTriggerArgs uses scheduled UI defaults and env overrides', () => {
  const args = buildTriggerArgs({}, {
    SCHEDULED_UI_RUN_MODE: 'smoke',
    SCHEDULED_UI_MAILBOX_ACTION: 'support',
    SCHEDULED_UI_TARGET_REPOSITORY: 'Inventionyin/UItest',
    SCHEDULED_UI_TARGET_REF: 'main',
  });

  assert.deepEqual(args.slice(0, 4), ['--run-mode', 'smoke', '--mailbox-action', 'support']);
  assert(args.includes('--target-repository'));
  assert(args.includes('Inventionyin/UItest'));
});

test('parseArgs reads scheduled UI options', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--force', '--run-mode', 'contracts', '--mailbox-action', 'account', '--day', '2026-05-06']), {
    dryRun: true,
    force: true,
    runMode: 'contracts',
    mailboxAction: 'account',
    day: '2026-05-06',
  });
});

test('runScheduledUi dry-run and real dispatch write state', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scheduled-ui-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const dry = await runScheduledUi({
      dryRun: true,
      force: true,
      day: '2026-05-06',
      stateFile,
      env: { GITHUB_TOKEN: 'ghp_example' },
    });
    assert.equal(dry.reason, 'dry_run');
    assert.equal(dry.config.inputs.run_mode, 'contracts');

    const real = await runScheduledUi({
      force: true,
      day: '2026-05-06',
      stateFile,
      env: { GITHUB_TOKEN: 'ghp_example' },
      dispatcher: async (config) => ({
        workflowRunUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/1',
        run: { id: 1, status: 'queued', html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/1' },
        config,
      }),
    });
    assert.equal(real.dispatched, true);
    assert.equal(existsSync(stateFile), true);
    assert.match(readFileSync(stateFile, 'utf8'), /actions\/runs\/1/);

    const skipped = await runScheduledUi({
      day: '2026-05-06',
      stateFile,
      env: { GITHUB_TOKEN: 'ghp_example' },
    });
    assert.equal(skipped.reason, 'already_ran');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runScheduledUi records diagnostics when dispatch fails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scheduled-ui-failure-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    await assert.rejects(
      runScheduledUi({
        force: true,
        day: '2026-05-06',
        stateFile,
        env: { GITHUB_TOKEN: 'ghp_secret_value' },
        dispatcher: async () => {
          throw new Error('GitHub workflow dispatch failed: 403 Forbidden');
        },
      }),
      /403 Forbidden/,
    );

    assert.equal(existsSync(stateFile), true);
    const stateText = readFileSync(stateFile, 'utf8');
    const state = JSON.parse(stateText);
    assert.equal(state.lastRunDay, '2026-05-06');
    assert.equal(state.status, 'dispatch_failed');
    assert.match(state.error, /403 Forbidden/);
    assert.equal(state.runMode, 'contracts');
    assert.equal(stateText.includes('ghp_secret_value'), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runScheduledUi records lookup status when workflow run url is missing', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scheduled-ui-lookup-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const result = await runScheduledUi({
      force: true,
      day: '2026-05-06',
      stateFile,
      env: { GITHUB_TOKEN: 'ghp_secret_value' },
      dispatcher: async () => ({
        actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        run: null,
        workflowRunUrl: '',
        lookup: { status: 'not_found', attempts: 1 },
      }),
    });

    assert.equal(result.dispatched, true);
    assert.equal(result.state.status, 'run_lookup_not_found');
    assert.equal(result.state.lookup.status, 'not_found');
    assert.equal(readFileSync(stateFile, 'utf8').includes('ghp_secret_value'), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
