"use strict";

const { join } = require("node:path");

function parseBrowserAutomationRequest(text) {
  const sourceText = String(text || "").trim();
  const lowered = sourceText.toLowerCase();
  const url = extractFirstUrl(sourceText);

  return {
    rawText: sourceText,
    url,
    intents: {
      inspectPage: hasAny(lowered, ["inspect page", "inspect", "analyze page"]),
      captureScreenshot: hasAny(lowered, ["screenshot", "capture screen", "snapshot"]),
      captureNetworkOrProtocol: hasAny(lowered, ["network", "protocol", "cdp", "har", "接口", "协议", "抓包", "请求", "响应"]),
      debugAuthFlow: hasAny(lowered, [
        "login",
        "register",
        "registration",
        "verification",
        "verify flow",
        "auth flow",
        "sign in",
        "sign up",
      ]),
      collectConsoleErrors: hasAny(lowered, ["console error", "collect console", "console logs"]),
    },
  };
}

function buildBrowserAutomationPlan(request) {
  const normalized = request || {};
  const url = normalized.url || "";
  const intents = normalized.intents || {};
  const safety = evaluateUrlSafety(url);
  const steps = [];

  if (!safety.allowed) {
    return {
      allowed: false,
      blocked: true,
      reason: safety.reason,
      url,
      steps,
    };
  }

  if (url) {
    steps.push({ type: "navigate", url });
  }

  if (intents.inspectPage) {
    steps.push({ type: "inspectPage", detail: "Collect DOM/a11y/basic page metadata" });
  }
  if (intents.captureScreenshot) {
    steps.push({ type: "captureScreenshot", detail: "Capture viewport screenshot" });
  }
  if (intents.captureNetworkOrProtocol) {
    steps.push({ type: "captureNetworkOrProtocol", detail: "Capture network/CDP protocol events" });
  }
  if (intents.debugAuthFlow) {
    steps.push({ type: "debugAuthFlow", detail: "Trace login/register/verification workflow" });
  }
  if (intents.collectConsoleErrors) {
    steps.push({ type: "collectConsoleErrors", detail: "Collect browser console error logs" });
  }

  if (steps.length === 0) {
    steps.push({ type: "inspectPage", detail: "Default inspection fallback" });
  }

  return {
    allowed: true,
    blocked: false,
    reason: null,
    url,
    steps,
  };
}

async function runBrowserAutomationTask(options) {
  const input = options || {};
  const request =
    input.request || parseBrowserAutomationRequest(input.text || input.prompt || "");
  const plan = buildBrowserAutomationPlan(request);
  const summaryBase = request.url || "current page";

  if (!plan.allowed) {
    return {
      executed: false,
      mode: "blocked",
      request,
      plan,
      reason: plan.reason,
      steps: [],
      summary: `Blocked browser run for ${summaryBase}: ${plan.reason}`,
      changedFiles: [],
    };
  }

  if (input.dryRun !== false) {
    return {
      executed: false,
      mode: "dry-run",
      request,
      plan,
      steps: plan.steps,
      summary: `Dry-run planned ${plan.steps.length} step(s) for ${summaryBase}.`,
      changedFiles: [],
    };
  }

  const launcher = resolveBrowserLauncher(input);
  if (!launcher) {
    return {
      executed: false,
      mode: "not-implemented",
      request,
      plan,
      reason: "Live browser/CDP execution is not implemented in this foundation yet.",
      steps: plan.steps,
      summary: `Live browser execution is not available for ${summaryBase}.`,
      changedFiles: [],
    };
  }

  let browser = null;
  let context = null;
  let page = null;
  const consoleMessages = [];
  const networkAssets = [];
  const changedFiles = [];
  let screenshotPath = resolveScreenshotPath(input, request);

  try {
    browser = await launcher({
      request,
      plan,
      options: input,
    });

    const resolvedBrowser = normalizeBrowserLike(browser);
    const pageResult = await openAutomationPage(resolvedBrowser);
    browser = pageResult.browser;
    context = pageResult.context;
    page = pageResult.page;

    if (typeof page.on === "function") {
      page.on("console", (message) => {
        consoleMessages.push(normalizeConsoleMessage(message));
      });
      page.on("response", (response) => {
        networkAssets.push(normalizeProtocolAsset(response));
      });
    }

    if (plan.url && typeof page.goto === "function") {
      await page.goto(plan.url);
    }

    if (screenshotPath && typeof page.screenshot === "function") {
      await page.screenshot({ path: screenshotPath });
      changedFiles.push(screenshotPath);
    } else {
      screenshotPath = null;
    }

    const protocolAssets = networkAssets.map((asset) => ({ ...asset }));
    const savedProtocolAssets = await saveCapturedProtocolAssets(
      protocolAssets,
      input.protocolAssetSaver,
    );
    for (const saved of savedProtocolAssets) {
      const filePath = saved.file || saved.path || saved.filePath;
      if (filePath && !changedFiles.includes(filePath)) {
        changedFiles.push(filePath);
      }
    }

    return {
      executed: true,
      mode: "live",
      request,
      plan,
      steps: plan.steps,
      consoleMessages,
      networkAssets,
      artifacts: {
        ...(screenshotPath ? { screenshotPath } : {}),
        ...(protocolAssets.length ? { protocolAssets } : {}),
        ...(savedProtocolAssets.length ? { savedProtocolAssets } : {}),
      },
      summary: [
        `Live browser run completed for ${summaryBase}`,
        `with ${consoleMessages.length} console message(s)`,
        `${networkAssets.length} network asset(s)`,
        `saved ${savedProtocolAssets.length} protocol asset(s).`,
      ].join(" "),
      changedFiles,
    };
  } finally {
    await closeQuietly(page);
    await closeQuietly(context);
    await closeQuietly(browser);
  }

  return {
    executed: false,
    mode: "not-implemented",
    request,
    plan,
    reason: "Live browser/CDP execution is not implemented in this foundation yet.",
    steps: plan.steps,
  };
}

async function saveCapturedProtocolAssets(protocolAssets, protocolAssetSaver) {
  if (!protocolAssets.length || typeof protocolAssetSaver !== "function") {
    return [];
  }

  const saved = [];
  for (const asset of protocolAssets) {
    const result = await protocolAssetSaver(asset);
    if (result) {
      saved.push(result);
    }
  }
  return saved;
}

function resolveBrowserLauncher(options = {}) {
  if (typeof options.browserFactory === "function") {
    return options.browserFactory;
  }

  const adapter = options.playwrightAdapter;
  if (adapter) {
    if (typeof adapter.launch === "function") {
      return adapter.launch.bind(adapter);
    }
    if (adapter.chromium && typeof adapter.chromium.launch === "function") {
      return adapter.chromium.launch.bind(adapter.chromium);
    }
    if (adapter.playwright?.chromium && typeof adapter.playwright.chromium.launch === "function") {
      return adapter.playwright.chromium.launch.bind(adapter.playwright.chromium);
    }
  }

  try {
    const playwright = require("playwright");
    if (playwright && playwright.chromium && typeof playwright.chromium.launch === "function") {
      return playwright.chromium.launch.bind(playwright.chromium);
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function normalizeBrowserLike(browser) {
  if (browser && browser.browser) {
    return browser.browser;
  }
  return browser;
}

async function openAutomationPage(browser) {
  if (!browser) {
    throw new Error("A browser instance is required for live browser execution.");
  }

  if (typeof browser.newPage === "function") {
    return {
      browser,
      context: null,
      page: await browser.newPage(),
    };
  }

  if (typeof browser.newContext === "function") {
    const context = await browser.newContext();
    return {
      browser,
      context,
      page: await context.newPage(),
    };
  }

  throw new Error("Injected browser does not expose newPage() or newContext().");
}

function normalizeConsoleMessage(message) {
  const type = typeof message?.type === "function" ? message.type() : message?.type;
  const text = typeof message?.text === "function" ? message.text() : message?.text;
  const location = typeof message?.location === "function" ? message.location() : message?.location;

  return {
    type: type || "log",
    text: String(text || ""),
    ...(location ? { location } : {}),
  };
}

function normalizeProtocolAsset(response) {
  const request = typeof response?.request === "function" ? response.request() : response?.request;
  const requestUrl = readMaybe(request?.url, request?.url);
  const responseUrl = readMaybe(response?.url, response?.url);
  const method = readMaybe(request?.method, request?.method) || "GET";
  const status = Number(readMaybe(response?.status, response?.status) || 0);
  const headers = readMaybe(response?.headers, response?.headers) || {};
  const requestHeaders = readMaybe(request?.headers, request?.headers) || {};
  const startedAt =
    readMaybe(request?.startedAt, request?.startedAt) ||
    readMaybe(response?.startedAt, response?.startedAt) ||
    null;
  const endedAt =
    readMaybe(response?.finishedAt, response?.finishedAt) ||
    readMaybe(response?.endedAt, response?.endedAt) ||
    null;

  return {
    url: responseUrl || requestUrl || "",
    method: String(method).toUpperCase(),
    status: Number.isFinite(status) ? status : 0,
    headers,
    request: {
      url: requestUrl || responseUrl || "",
      method: String(method).toUpperCase(),
      headers: requestHeaders,
      ...(startedAt ? { startedAt } : {}),
    },
    response: {
      status: Number.isFinite(status) ? status : 0,
      headers,
      ...(endedAt ? { endedAt } : {}),
    },
    durationMs: computeDurationMs(startedAt, endedAt),
    tags: ["browser-cdp-executor", "network"],
    source: "browser-cdp-executor",
  };
}

function computeDurationMs(startedAt, endedAt) {
  const started = Date.parse(startedAt || "");
  const ended = Date.parse(endedAt || "");
  if (Number.isFinite(started) && Number.isFinite(ended) && ended >= started) {
    return ended - started;
  }
  return 0;
}

function readMaybe(methodOrValue, fallback) {
  if (typeof methodOrValue === "function") {
    return methodOrValue.call(fallback);
  }
  return methodOrValue;
}

function resolveScreenshotPath(input, request) {
  if (input.screenshotPath) {
    return input.screenshotPath;
  }
  if (request?.intents?.captureScreenshot) {
    return join(process.cwd(), `browser-cdp-${Date.now()}.png`);
  }
  return null;
}

async function closeQuietly(resource) {
  if (!resource || typeof resource.close !== "function") {
    return;
  }
  try {
    await resource.close();
  } catch (_error) {
    // Best effort cleanup.
  }
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

function hasAny(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

function evaluateUrlSafety(url) {
  if (!url) {
    return { allowed: true, reason: null };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return { allowed: false, reason: "Blocked: URL is invalid and cannot be safely executed." };
  }

  const hostname = (parsed.hostname || "").toLowerCase();
  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "projectku.local",
    "projectku.com",
    "www.projectku.com",
  ]);

  const allowBySuffix = [".local", ".internal", ".lan", ".test"];
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const explicitlyAllowed = allowedHosts.has(hostname);
  const suffixAllowed = allowBySuffix.some((suffix) => hostname.endsWith(suffix));

  if (isLoopback || explicitlyAllowed || suffixAllowed) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason:
      "Blocked: target URL is outside allowlist/self-owned/localhost domains. " +
      "Only explicit allowlist or localhost/self-owned domains are permitted.",
  };
}

module.exports = {
  parseBrowserAutomationRequest,
  buildBrowserAutomationPlan,
  runBrowserAutomationTask,
};
