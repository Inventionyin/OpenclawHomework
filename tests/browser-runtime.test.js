const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBrowserRuntimeDryRun,
  evaluateBrowserRuntimeTargetSafety,
} = require('../scripts/browser-runtime');

test('observe returns normalized dry-run steps for self-owned target', () => {
  const result = buildBrowserRuntimeDryRun({
    action: 'browser-observe',
    targetUrl: 'https://shop.evanshine.me/login',
    instruction: '观察登录页结构和可点击元素',
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.blocked, false);
  assert.equal(result.operation, 'observe');
  assert.equal(result.plan.targetUrl, 'https://shop.evanshine.me/login');
  assert.equal(result.steps.some((step) => step.type === 'navigate'), true);
  assert.equal(result.steps.some((step) => step.type === 'observe_dom'), true);
  assert.equal(result.steps.some((step) => step.type === 'summarize_interactive_elements'), true);
});

test('observe extracts target url from natural language when route did not provide one', () => {
  const result = buildBrowserRuntimeDryRun({
    action: 'browser-observe',
    instruction: '打开 https://shop.evanshine.me/login 看看登录页结构',
  });

  assert.equal(result.blocked, false);
  assert.equal(result.plan.targetUrl, 'https://shop.evanshine.me/login');
  assert.equal(result.steps[0].type, 'navigate');
});

test('act requires targetUrl and action text before planning', () => {
  const missingUrl = buildBrowserRuntimeDryRun({
    action: 'browser-act',
    actionText: '点击登录按钮',
  });
  const missingAction = buildBrowserRuntimeDryRun({
    action: 'browser-act',
    targetUrl: 'http://localhost:3000/login',
  });
  const ready = buildBrowserRuntimeDryRun({
    action: 'browser-act',
    targetUrl: 'http://localhost:3000/login',
    actionText: '输入用户名并点击登录',
  });

  assert.equal(missingUrl.blocked, true);
  assert.match(missingUrl.reason, /targetUrl/i);
  assert.equal(missingAction.blocked, true);
  assert.match(missingAction.reason, /action text/i);

  assert.equal(ready.blocked, false);
  assert.equal(ready.operation, 'act');
  assert.equal(ready.steps.some((step) => step.type === 'perform_action'), true);
});

test('extract accepts schema-like fields and returns extraction plan', () => {
  const result = buildBrowserRuntimeDryRun({
    action: 'browser-extract',
    targetUrl: 'https://projectku.local/products',
    schema: {
      fields: {
        title: 'string',
        price: 'number',
        stock: { type: 'boolean' },
      },
    },
  });

  assert.equal(result.blocked, false);
  assert.equal(result.operation, 'extract');
  assert.deepEqual(result.plan.schemaFields, ['title', 'price', 'stock']);
  assert.equal(result.steps.some((step) => step.type === 'extract_schema'), true);
});

test('unsafe external ecommerce target is blocked', () => {
  const safety = evaluateBrowserRuntimeTargetSafety('https://www.jd.com');
  const result = buildBrowserRuntimeDryRun({
    action: 'browser-observe',
    targetUrl: 'https://mobile.yangkeduo.com/goods.html',
  });

  assert.equal(safety.allowed, false);
  assert.match(safety.reason, /external ecommerce|allowlist|self-owned/i);
  assert.equal(result.blocked, true);
  assert.equal(result.steps.length, 0);
  assert.match(result.reason, /external ecommerce|allowlist|self-owned/i);
});
