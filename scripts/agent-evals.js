#!/usr/bin/env node
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  routeAgentIntent,
} = require('./agents/router');

function loadGoldenIntentCases(file = join(process.cwd(), 'data', 'evals', 'golden-intents.json')) {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function scoreRoute(actual = {}, expected = {}) {
  return String(actual.agent || '') === String(expected.agent || '')
    && String(actual.action || '') === String(expected.action || '');
}

function runGoldenIntentEvals(options = {}) {
  const cases = options.cases || loadGoldenIntentCases(options.file);
  const routeIntent = options.routeIntent || ((text) => routeAgentIntent(text));
  const results = cases.map((item) => {
    const actual = routeIntent(item.text);
    const passed = scoreRoute(actual, item.expected);
    return {
      text: item.text,
      passed,
      expected: item.expected,
      actual: {
        agent: actual.agent,
        action: actual.action,
      },
    };
  });
  const failures = results.filter((item) => !item.passed);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  };
}

function main() {
  const result = runGoldenIntentEvals();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  loadGoldenIntentCases,
  runGoldenIntentEvals,
  scoreRoute,
};
