const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const scriptPath = join(__dirname, '..', 'scripts', 'consolidate-production-timers.sh');

function readScript() {
  return readFileSync(scriptPath, 'utf8');
}

test('production timer consolidation script exists and supports hermes/openclaw roles', () => {
  assert.equal(existsSync(scriptPath), true);
  const script = readScript();

  assert.match(script, /ROLE=""/);
  assert.match(script, /--role\)/);
  assert.match(script, /hermes\|openclaw/);
  assert.match(script, /DAILY_TIMER="\$\{ROLE\}-daily-agent-pipeline\.timer"/);
  assert.match(script, /WATCHDOG_TIMER="\$\{ROLE\}-homework-watchdog\.timer"/);
});

test('production timer consolidation disables duplicate proactive and token timers', () => {
  const script = readScript();

  for (const unit of [
    '${ROLE}-proactive-daily-digest.timer',
    '${ROLE}-trend-token-factory.timer',
    '${ROLE}-scheduled-token-lab.timer',
    '${ROLE}-scheduled-ui-runner.timer',
    '${ROLE}-token-factory-worker.timer',
  ]) {
    assert.match(script, new RegExp(unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(script, /systemctl disable --now "\$\{unit\}"/);
});

test('production timer consolidation enables only daily pipeline and watchdog by default', () => {
  const script = readScript();

  assert.match(script, /ENABLE_UNITS=\("\$\{DAILY_TIMER\}" "\$\{WATCHDOG_TIMER\}"\)/);
  assert.match(script, /systemctl enable --now "\$\{unit\}"/);
  assert.match(script, /systemctl daemon-reload/);
  assert.match(script, /systemctl list-timers --all \| grep -E/);
});

test('production timer consolidation has dry-run and does not embed secrets', () => {
  const script = readScript();

  assert.match(script, /DRY_RUN="false"/);
  assert.match(script, /--dry-run\)/);
  assert.match(script, /run_systemctl\(\)/);
  assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(script, /password\s*=/i);
  assert.doesNotMatch(script, /authorization\s*:/i);
});
