const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const installer = readFileSync(join(__dirname, '..', 'scripts', 'install-world-news-monitor.sh'), 'utf8');

test('world news monitor installer writes separate OnCalendar lines for systemd', () => {
  assert.match(installer, /ON_CALENDAR="\*-\*-\* 09:10:00,\*-\*-\* 15:10:00,\*-\*-\* 21:10:00"/);
  assert.match(installer, /IFS=',' read -r -a ON_CALENDAR_ENTRIES/);
  assert.match(installer, /ON_CALENDAR_LINES\+="OnCalendar=\$\{ENTRY\}"/);
  assert.doesNotMatch(installer, /OnCalendar=\$\{ON_CALENDAR\}/);
});
