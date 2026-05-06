const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const installerPath = join(__dirname, '..', 'scripts', 'install-daily-agent-pipeline.sh');

function readInstaller() {
  return readFileSync(installerPath, 'utf8');
}

test('daily agent pipeline installer writes a systemd service and timer', () => {
  assert.equal(existsSync(installerPath), true);
  const script = readInstaller();

  assert.match(script, /UNIT_NAME="openclaw-daily-agent-pipeline"/);
  assert.match(script, /PROJECT_DIR="\/opt\/OpenclawHomework"/);
  assert.match(script, /NODE_BIN="\/usr\/bin\/node"/);
  assert.match(script, /ENV_FILE="\/etc\/openclaw-feishu-bridge\.env"/);
  assert.match(script, /STATE_FILE="\/var\/lib\/openclaw-homework\/daily-agent-pipeline-state\.json"/);
  assert.match(script, /ON_CALENDAR="\*-\*-\* 08:45:00"/);

  assert.match(script, /if \[\[ "\$\{EUID\}" -ne 0 \]\]/);
  assert.match(script, /scripts\/daily-agent-pipeline\.js/);
  assert.match(script, /EnvironmentFile=-\$\{ENV_FILE\}/);
  assert.match(script, /ExecStart=\$\{NODE_BIN\} \$\{PROJECT_DIR\}\/scripts\/daily-agent-pipeline\.js --once --env-file \$\{ENV_FILE\} --state-file \$\{STATE_FILE\}/);
  assert.match(script, /OnCalendar=\$\{ON_CALENDAR\}/);
  assert.match(script, /Persistent=true/);
  assert.match(script, /systemctl enable --now "\$\{UNIT_NAME\}\.timer"/);
});

test('daily agent pipeline installer supports safe overrides without embedding secrets', () => {
  const script = readInstaller();

  for (const option of [
    '--unit-name',
    '--project-dir',
    '--node-bin',
    '--env-file',
    '--state-file',
    '--on-calendar',
  ]) {
    assert.match(script, new RegExp(option));
  }

  assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(script, /password\s*=/i);
  assert.doesNotMatch(script, /authorization\s*:/i);
});
