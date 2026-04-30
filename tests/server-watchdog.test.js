const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  detectFeishuStorm,
  markAlert,
  parseCliArgs,
  parseEnvFile,
  parseNginxAccessLine,
  parseNginxTimestamp,
  runWatchdog,
  scanFeishuAccessLog,
  shouldAlert,
} = require('../scripts/server-watchdog');

test('parseNginxTimestamp parses nginx local timestamp with timezone', () => {
  assert.equal(
    parseNginxTimestamp('30/Apr/2026:00:05:10 +0800').toISOString(),
    '2026-04-29T16:05:10.000Z',
  );
});

test('parseNginxAccessLine extracts Feishu POST path and status', () => {
  const entry = parseNginxAccessLine(
    '127.0.0.1 - - [30/Apr/2026:00:05:10 +0800] "POST /webhook/feishu/openclaw HTTP/1.1" 202 42 "-" "Feishu"',
  );

  assert.equal(entry.method, 'POST');
  assert.equal(entry.path, '/webhook/feishu/openclaw');
  assert.equal(entry.status, 202);
  assert.equal(entry.timestamp.toISOString(), '2026-04-29T16:05:10.000Z');
});

test('scanFeishuAccessLog only counts recent Feishu webhook POSTs', () => {
  const content = [
    '127.0.0.1 - - [30/Apr/2026:00:01:00 +0800] "POST /webhook/feishu/openclaw HTTP/1.1" 200 2 "-" "Feishu"',
    '127.0.0.1 - - [30/Apr/2026:00:02:00 +0800] "POST /webhook/feishu/openclaw HTTP/1.1" 202 2 "-" "Feishu"',
    '127.0.0.1 - - [29/Apr/2026:23:30:00 +0800] "POST /webhook/feishu/openclaw HTTP/1.1" 202 2 "-" "Feishu"',
    '127.0.0.1 - - [30/Apr/2026:00:03:00 +0800] "GET /health HTTP/1.1" 200 2 "-" "curl"',
  ].join('\n');

  const scan = scanFeishuAccessLog(content, {
    now: new Date('2026-04-29T16:06:00.000Z'),
    windowMinutes: 10,
  });

  assert.deepEqual(scan, {
    total: 2,
    non200: 1,
    statusCounts: {
      200: 1,
      202: 1,
    },
  });
});

test('detectFeishuStorm reports high post count and non-200 callbacks', () => {
  assert.deepEqual(
    detectFeishuStorm({ total: 31, non200: 2, statusCounts: { 202: 2 } }, {
      postThreshold: 30,
      non200Threshold: 1,
    }),
    {
      storm: true,
      reasons: ['feishu_post_count_31', 'feishu_non_200_2'],
    },
  );
});

test('shouldAlert respects cooldown and markAlert records timestamp', () => {
  const now = new Date('2026-04-30T00:00:00.000Z');
  const state = markAlert({}, 'feishu_non_200_1', now);

  assert.equal(shouldAlert(state, 'feishu_non_200_1', new Date('2026-04-30T00:30:00.000Z'), 60), false);
  assert.equal(shouldAlert(state, 'feishu_non_200_1', new Date('2026-04-30T01:01:00.000Z'), 60), true);
});

test('parseEnvFile reads simple key value env files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaw-watchdog-test-'));
  const envFile = join(tempDir, 'bridge.env');
  writeFileSync(envFile, 'FEISHU_APP_ID=cli_xxx\n# comment\nWATCHDOG_FEISHU_NOTIFY_ENABLED=false\n', 'utf8');

  try {
    assert.deepEqual(parseEnvFile(envFile), {
      FEISHU_APP_ID: 'cli_xxx',
      WATCHDOG_FEISHU_NOTIFY_ENABLED: 'false',
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
test('parseCliArgs uses watchdog defaults and overrides', () => {
  const config = parseCliArgs([
    '--service',
    'hermes-feishu-bridge',
    '--health-url',
    'http://127.0.0.1:8788/health',
    '--window-minutes',
    '5',
  ], {});

  assert.equal(config.service, 'hermes-feishu-bridge');
  assert.equal(config.healthUrl, 'http://127.0.0.1:8788/health');
  assert.equal(config.windowMinutes, 5);
  assert.equal(config.postThreshold, 30);
});

test('runWatchdog restarts service on health failure and reports Feishu callback storm', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaw-watchdog-test-'));
  const accessLog = join(tempDir, 'access.log');
  const envFile = join(tempDir, 'bridge.env');
  const stateFile = join(tempDir, 'state.json');
  const restarted = [];

  writeFileSync(envFile, 'WATCHDOG_FEISHU_NOTIFY_ENABLED=false\n', 'utf8');
  writeFileSync(accessLog, [
    '127.0.0.1 - - [30/Apr/2026:00:01:00 +0800] "POST /webhook/feishu HTTP/1.1" 202 2 "-" "Feishu"',
    '127.0.0.1 - - [30/Apr/2026:00:02:00 +0800] "POST /webhook/feishu HTTP/1.1" 202 2 "-" "Feishu"',
  ].join('\n'), 'utf8');

  try {
    const summary = await runWatchdog({
      service: 'hermes-feishu-bridge',
      healthUrl: 'http://127.0.0.1:8788/health',
      envFile,
      accessLog,
      stateFile,
      windowMinutes: 10,
      postThreshold: 30,
      non200Threshold: 1,
      alertCooldownMinutes: 60,
    }, {}, {
      now: new Date('2026-04-29T16:06:00.000Z'),
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'bad',
      }),
      restartService: async (service) => {
        restarted.push(service);
      },
    });

    assert.deepEqual(restarted, ['hermes-feishu-bridge']);
    assert.equal(summary.status, 'restarted');
    assert.equal(summary.healthOk, false);
    assert.equal(summary.feishu.total, 2);
    assert.equal(summary.feishu.non200, 2);
    assert.deepEqual(summary.reasons, ['health_check_failed', 'feishu_non_200_2']);
    assert.deepEqual(summary.alert, { sent: false, reason: 'disabled' });
    assert.equal(existsSync(stateFile), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
