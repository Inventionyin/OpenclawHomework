"use strict";

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

  if (!plan.allowed) {
    return {
      executed: false,
      mode: "blocked",
      request,
      plan,
      reason: plan.reason,
      steps: [],
    };
  }

  if (input.dryRun !== false) {
    return {
      executed: false,
      mode: "dry-run",
      request,
      plan,
      steps: plan.steps,
    };
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
