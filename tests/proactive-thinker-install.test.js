const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const installer = readFileSync(join(__dirname, '..', 'scripts', 'install-proactive-thinker.sh'), 'utf8');

test('proactive thinker installer creates a systemd service and timer', () => {
  assert.match(installer, /UNIT_NAME="hermes-proactive-thinker"/);
  assert.match(installer, /ENV_FILE="\/etc\/hermes-feishu-bridge\.env"/);
  assert.match(installer, /OUTPUT_DIR="\/var\/lib\/openclaw-homework\/proactive-thinker"/);
  assert.match(installer, /ON_CALENDAR="\*-\*-\* 10:30:00,\*-\*-\* 22:30:00"/);
  assert.match(installer, /EMAIL_MODE="--email"/);
  assert.match(installer, /--no-email\) EMAIL_MODE="--no-email"/);
  assert.match(installer, /scripts\/proactive-thinker\.js/);
  assert.match(installer, /ExecStart=\$\{NODE_BIN\} \$\{PROJECT_DIR\}\/scripts\/proactive-thinker\.js \$\{EMAIL_MODE\} --output-dir \$\{OUTPUT_DIR\}/);
  assert.match(installer, /ON_CALENDAR_LINES\+="OnCalendar=\$\{ENTRY\}"/);
  assert.doesNotMatch(installer, /sk-|ak_|ck_live_|App Secret/i);
});
