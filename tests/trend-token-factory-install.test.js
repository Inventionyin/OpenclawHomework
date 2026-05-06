const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const installerPath = join(__dirname, '..', 'scripts', 'install-trend-token-factory.sh');

function readInstaller() {
  return readFileSync(installerPath, 'utf8');
}

test('trend token factory installer writes a systemd service and timer', () => {
  assert.equal(existsSync(installerPath), true);
  const script = readInstaller();

  assert.match(script, /UNIT_NAME="hermes-trend-token-factory"/);
  assert.match(script, /PROJECT_DIR="\/opt\/OpenclawHomework"/);
  assert.match(script, /NODE_BIN="\/usr\/bin\/node"/);
  assert.match(script, /ENV_FILE="\/etc\/hermes-feishu-bridge\.env"/);
  assert.match(script, /STATE_DIR="\/var\/lib\/openclaw-homework\/trend-token-factory"/);
  assert.match(script, /OUTPUT_DIR="\/var\/lib\/openclaw-homework\/trend-token-factory\/output"/);
  assert.match(script, /ON_CALENDAR="\*-\*-\* 02:10:00"/);
  assert.match(script, /BATCH_SIZE="24"/);

  assert.match(script, /if \[\[ "\$\{EUID\}" -ne 0 \]\]/);
  assert.match(script, /scripts\/trend-intel\.js/);
  assert.match(script, /scripts\/trend-token-factory\.js/);
  assert.match(script, /mkdir -p "\$\{STATE_DIR\}" "\$\{OUTPUT_DIR\}"/);
  assert.match(script, /EnvironmentFile=-\$\{ENV_FILE\}/);
  assert.match(script, /Environment=TREND_INTEL_OUTPUT_FILE=\$\{STATE_DIR\}\/latest-trend-intel\.json/);
  assert.match(script, /Environment=TREND_INTEL_INPUT_FILE=\$\{STATE_DIR\}\/latest-trend-intel\.json/);
  assert.match(script, /Environment=TREND_TOKEN_FACTORY_OUTPUT_DIR=\$\{OUTPUT_DIR\}/);
  assert.match(script, /ExecStart=\$\{NODE_BIN\} \$\{PROJECT_DIR\}\/scripts\/trend-intel\.js/);
  assert.match(script, /ExecStart=\$\{NODE_BIN\} \$\{PROJECT_DIR\}\/scripts\/trend-token-factory\.js --batch-size \$\{BATCH_SIZE\} --email/);
  assert.match(script, /OnCalendar=\$\{ON_CALENDAR\}/);
  assert.match(script, /Persistent=true/);
  assert.match(script, /systemctl daemon-reload/);
  assert.match(script, /systemctl enable --now "\$\{UNIT_NAME\}\.timer"/);
});

test('trend token factory installer supports safe overrides without embedding secrets', () => {
  const script = readInstaller();

  for (const option of [
    '--unit-name',
    '--project-dir',
    '--node-bin',
    '--env-file',
    '--state-dir',
    '--output-dir',
    '--on-calendar',
    '--batch-size',
  ]) {
    assert.match(script, new RegExp(option));
  }

  assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(script, /password\s*=/i);
  assert.doesNotMatch(script, /authorization\s*:/i);
});
