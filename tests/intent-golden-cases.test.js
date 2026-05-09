const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const {
  routeAgentIntent,
} = require('../scripts/agents/router');

const cases = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'intent-golden-cases.json'), 'utf8'));

for (const item of cases) {
  test(`golden intent route: ${item.text}`, () => {
    assert.deepEqual(routeAgentIntent(item.text), item.expected);
  });
}

