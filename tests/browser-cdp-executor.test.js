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

test("live execution uses injected browser factory and captures browser artifacts", async () => {
  const events = { console: [], response: [] };
  const page = {
    on(event, handler) {
      events[event].push(handler);
    },
    async goto(url) {
      this.gotoUrl = url;
      for (const handler of events.response) {
        handler({
          url: () => `${url}/api/session`,
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          request: () => ({
            method: () => "GET",
            url: `${url}/api/session`,
            startedAt: "2026-05-07T00:00:00.000Z",
          }),
          finishedAt: "2026-05-07T00:00:00.050Z",
        });
      }
      for (const handler of events.console) {
        handler({ type: () => "log", text: () => "ready" });
      }
    },
    async screenshot({ path }) {
      this.screenshotPath = path;
      return path;
    },
    async close() {
      this.closed = true;
    },
  };
  const browser = {
    async newPage() {
      this.newPageCalled = true;
      return page;
    },
    async close() {
      this.closed = true;
    },
  };

  const result = await runBrowserAutomationTask({
    text: "Inspect https://localhost:3000/dashboard and capture screenshot, network, and console logs.",
    dryRun: false,
    screenshotPath: "/tmp/browser-cdp-shot.png",
    browserFactory: async () => browser,
  });

  assert.equal(result.executed, true);
  assert.equal(result.mode, "live");
  assert.equal(browser.newPageCalled, true);
  assert.equal(page.gotoUrl, "https://localhost:3000/dashboard");
  assert.equal(page.screenshotPath, "/tmp/browser-cdp-shot.png");
  assert.equal(browser.closed, true);
  assert.equal(page.closed, true);
  assert.equal(result.consoleMessages.length, 1);
  assert.deepEqual(result.consoleMessages[0], {
    type: "log",
    text: "ready",
  });
  assert.equal(result.networkAssets.length, 1);
  assert.equal(result.networkAssets[0].method, "GET");
  assert.equal(result.networkAssets[0].status, 200);
  assert.equal(result.networkAssets[0].request.url, "https://localhost:3000/dashboard/api/session");
  assert.equal(result.artifacts.screenshotPath, "/tmp/browser-cdp-shot.png");
  assert.equal(result.artifacts.protocolAssets.length, 1);
  assert.equal(result.changedFiles.includes("/tmp/browser-cdp-shot.png"), true);
  assert.match(result.summary, /live/i);
});

test("live execution saves captured protocol assets when saver is provided", async () => {
  const events = { console: [], response: [] };
  const saved = [];
  const page = {
    on(event, handler) {
      events[event].push(handler);
    },
    async goto(url) {
      for (const handler of events.response) {
        handler({
          url: () => `${url}/api/login`,
          status: () => 200,
          headers: () => ({ "content-type": "application/json" }),
          request: () => ({
            method: () => "POST",
            url: `${url}/api/login`,
          }),
        });
      }
    },
    async close() {},
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {},
  };

  const result = await runBrowserAutomationTask({
    text: "真实执行 http://localhost:3000/login 并抓登录接口",
    dryRun: false,
    browserFactory: async () => browser,
    protocolAssetSaver: async (asset) => {
      saved.push(asset);
      return {
        id: "pa-1",
        file: "/tmp/protocol-assets/pa-1.json",
        summary: {
          method: asset.method,
          normalizedPath: "/api/login",
          status: asset.status,
        },
      };
    },
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].method, "POST");
  assert.equal(saved[0].url, "http://localhost:3000/login/api/login");
  assert.equal(result.artifacts.savedProtocolAssets.length, 1);
  assert.equal(result.artifacts.savedProtocolAssets[0].id, "pa-1");
  assert.equal(result.changedFiles.includes("/tmp/protocol-assets/pa-1.json"), true);
  assert.match(result.summary, /saved 1 protocol asset/i);
});

test("live execution without injected browser support stays not implemented", async () => {
  const result = await runBrowserAutomationTask({
    text: "Inspect https://localhost:3000/dashboard in live mode.",
    dryRun: false,
    playwrightAdapter: {
      chromium: {
        launch: async () => {
          throw new Error("Executable doesn't exist at /tmp/chromium-headless-shell");
        },
      },
    },
  });

  assert.equal(result.executed, false);
  assert.equal(result.mode, "not-implemented");
  assert.match(result.reason, /not implemented/i);
});

test("live execution surfaces injected browser factory launch errors", async () => {
  await assert.rejects(
    () => runBrowserAutomationTask({
      text: "Inspect https://localhost:3000/dashboard in live mode.",
      dryRun: false,
      browserFactory: async () => {
        throw new Error("custom browser factory failed");
      },
    }),
    /custom browser factory failed/,
  );
});

test("unsafe live request is blocked before browser factory runs", async () => {
  let factoryCalled = false;

  const result = await runBrowserAutomationTask({
    text: "Inspect https://example.com/admin and capture screenshot.",
    dryRun: false,
    browserFactory: async () => {
      factoryCalled = true;
      return {
        async newPage() {
          return {
            on() {},
            async goto() {},
            async screenshot() {},
            async close() {},
          };
        },
        async close() {},
      };
    },
  });

  assert.equal(result.executed, false);
  assert.equal(result.mode, "blocked");
  assert.equal(factoryCalled, false);
  assert.match(result.reason, /blocked/i);
});
