'use strict';

const { createTask: defaultCreateTask } = require('./background-task-store');
const { normalizeSkillExecutionPlan } = require('./skill-runtime');
const {
  buildBrowserRuntimeDryRun,
  normalizeBrowserRuntimeAction,
} = require('./browser-runtime');

const SECRET_KEY_PATTERN = /(key|token|password|secret|credential|authorization|cookie)/i;
const SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]+|ak_[A-Za-z0-9_-]+|ck_live_[A-Za-z0-9_-]+)\b/g;

function buildRouteTaskRecord(route = {}, options = {}) {
  const safeRoute = route && typeof route === 'object' ? route : {};
  const now = normalizeNow(options.now);
  const kind = classifyRoute(safeRoute);

  if (kind === 'skill') {
    return buildSkillRouteTaskRecord(safeRoute, now);
  }
  if (kind === 'browser') {
    return buildBrowserRouteTaskRecord(safeRoute, now);
  }
  return buildUnknownRouteTaskRecord(safeRoute, now);
}

function recordRouteTask(route = {}, options = {}) {
  const createTask = options.createTask || defaultCreateTask;
  const record = buildRouteTaskRecord(route, options);
  return createTask(record, options.env || process.env);
}

function classifyRoute(route = {}) {
  const action = String(route.action || '').trim();
  if (route.skillId || route.sourceSkillId || action === 'skill-flow') {
    return 'skill';
  }
  const plan = normalizeSkillExecutionPlan(route);
  if (plan.status !== 'unsupported') {
    return 'skill';
  }
  if (['browser-observe', 'browser-act', 'browser-extract', 'browser-dry-run', 'observe', 'act', 'extract'].includes(action)) {
    return 'browser';
  }
  return 'unknown';
}

function buildSkillRouteTaskRecord(route, now) {
  const plan = normalizeSkillExecutionPlan(route);
  const status = plan.status === 'unsupported' ? 'degraded' : 'queued';
  const skillId = plan.skillId || route.sourceSkillId || route.skillId || 'unknown';

  return {
    type: `skill:${skillId}`,
    status,
    now,
    summary: {
      title: plan.name || 'Skill route task',
      routeAction: route.action || plan.action || '',
      nextStep: plan.nextStep || 'manual_triage',
      routeStatus: plan.status,
    },
    metadata: redactSecrets({
      routeKind: 'skill',
      skillId,
      sourceSkillId: route.sourceSkillId || '',
      agent: plan.agent || route.agent || '',
      action: plan.action || route.action || '',
      riskLevel: plan.riskLevel || 'unknown',
      autoRun: Boolean(plan.autoRun),
      originalRoute: route,
    }),
    error: status === 'degraded' ? 'unsupported_skill_route' : '',
  };
}

function buildBrowserRouteTaskRecord(route, now) {
  const runtimeRoute = normalizeBrowserRouteForPlan(route);
  const operation = normalizeBrowserRuntimeAction(runtimeRoute.action || runtimeRoute.operation);
  const dryRun = buildBrowserRuntimeDryRun(runtimeRoute);
  const status = dryRun.blocked ? 'degraded' : 'queued';

  return {
    type: 'browser-verify',
    status,
    now,
    summary: {
      title: 'Browser runtime verification',
      routeAction: route.action || operation,
      nextStep: `browser_${operation}`,
      routeStatus: dryRun.blocked ? 'blocked' : 'planned',
    },
    metadata: redactSecrets({
      routeKind: 'browser',
      runtime: 'browser-runtime',
      browser: {
        operation,
        targetUrl: dryRun.plan?.targetUrl || '',
        allowed: Boolean(dryRun.allowed),
        blocked: Boolean(dryRun.blocked),
        reason: dryRun.reason || '',
        expectedOutputs: dryRun.artifacts?.expectedOutputs || [],
      },
      originalRoute: route,
    }),
    error: dryRun.blocked ? String(dryRun.reason || 'browser_route_blocked') : '',
  };
}

function normalizeBrowserRouteForPlan(route = {}) {
  if (String(route.action || '').trim().toLowerCase() !== 'browser-dry-run') {
    return route;
  }
  return {
    ...route,
    action: 'browser-observe',
    operation: 'observe',
    instruction: route.instruction || route.rawText || route.text || '',
  };
}

function buildUnknownRouteTaskRecord(route, now) {
  return {
    type: 'route:unknown',
    status: 'degraded',
    now,
    summary: {
      title: 'Unsupported route task',
      routeAction: route.action || '',
      nextStep: 'manual_triage',
      routeStatus: 'unsupported',
    },
    metadata: redactSecrets({
      routeKind: 'unknown',
      reason: 'unsupported_route',
      agent: route.agent || '',
      action: route.action || '',
      originalRoute: route,
    }),
    error: 'unsupported_route',
  };
}

function redactSecrets(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE_PATTERN, '[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSecrets(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function normalizeNow(now) {
  if (!now) {
    return new Date().toISOString();
  }
  if (now instanceof Date) {
    return now.toISOString();
  }
  return String(now);
}

module.exports = {
  buildRouteTaskRecord,
  recordRouteTask,
};
