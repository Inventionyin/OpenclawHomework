const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBrowserAutomationRequest,
  buildBrowserAutomationPlan,
  runBrowserAutomationTask,
} = require("../scripts/browser-cdp-executor");

test("self-owned projectku/login request builds executable inspect+login-debug plan", () => {
  const request = parseBrowserAutomationRequest(
    "Please inspect https://projectku.local/login and debug the login flow, also collect console errors."
  );

  assert.equal(request.url, "https://projectku.local/login");
  assert.equal(request.intents.inspectPage, true);
  assert.equal(request.intents.debugAuthFlow, true);
  assert.equal(request.intents.collectConsoleErrors, true);

  const plan = buildBrowserAutomationPlan(request);

  assert.equal(plan.allowed, true);
  assert.equal(plan.blocked, false);
  assert.ok(plan.steps.length >= 3);
  assert.equal(plan.steps.some((step) => step.type === "navigate"), true);
  assert.equal(plan.steps.some((step) => step.type === "inspectPage"), true);
  assert.equal(plan.steps.some((step) => step.type === "collectConsoleErrors"), true);
  assert.equal(plan.steps.some((step) => step.type === "debugAuthFlow"), true);
});

test("protocol capture request produces protocol/network capture steps and dry-run execution", async () => {
  const result = await runBrowserAutomationTask({
    text: "Capture protocol and network activity on http://localhost:3000/register in dry run mode.",
    dryRun: true,
  });

  assert.equal(result.executed, false);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.allowed, true);
  assert.equal(
    result.plan.steps.some((step) => step.type === "captureNetworkOrProtocol"),
    true
  );
});

test("unknown external registration platform is blocked with clear reason", () => {
  const request = parseBrowserAutomationRequest(
    "Help me debug registration on https://unknown-social-example.com/register"
  );
  const plan = buildBrowserAutomationPlan(request);

  assert.equal(plan.allowed, false);
  assert.equal(plan.blocked, true);
  assert.match(plan.reason, /blocked/i);
  assert.match(plan.reason, /allowlist|self-owned|localhost|domain/i);
});
