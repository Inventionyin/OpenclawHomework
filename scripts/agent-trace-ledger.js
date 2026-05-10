const { appendFileSync, existsSync, mkdirSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  isSafeMemoryText,
} = require('./agents/memory-store');

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function redactScalar(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (!isSafeMemoryText(text)) {
    return '[redacted secret-like text]';
  }
  return value;
}

function redactObject(value, depth = 0) {
  if (value === undefined || value === null) return undefined;
  if (depth > 2) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/key|token|secret|password|authorization/i.test(key)) {
          return [key, '[redacted]'];
        }
        return [key, redactObject(item, depth + 1)];
      }),
    );
  }
  return redactScalar(value);
}

function buildAgentTraceEntry(input = {}) {
  const route = input.route || {};
  const entry = {
    timestamp: input.timestamp || new Date().toISOString(),
    traceId: input.traceId || input.trace_id,
    channel: input.channel,
    conversationId: input.conversationId,
    userId: input.userId,
    userText: redactScalar(input.userText),
    agent: route.agent || input.agent,
    action: route.action || input.action,
    skillId: route.skillId || input.skillId,
    intentSource: route.intentSource || input.intentSource,
    confidence: route.confidence || input.confidence,
    riskLevel: route.riskLevel || input.riskLevel,
    status: input.status,
    elapsedMs: numberOrUndefined(input.elapsedMs),
    routeElapsedMs: numberOrUndefined(input.routeElapsedMs),
    replyChars: numberOrUndefined(input.replyChars),
    error: redactScalar(input.error),
    metadata: redactObject(input.metadata),
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function getAgentTraceLedgerPath(env = process.env) {
  return String(
    env.AGENT_TRACE_LEDGER_PATH
      || env.FEISHU_AGENT_TRACE_LEDGER_PATH
      || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'agent-traces', 'agent-traces.jsonl'),
  ).trim();
}

function isAgentTraceEnabled(env = process.env) {
  return String(env.AGENT_TRACE_LEDGER_ENABLED || env.FEISHU_AGENT_TRACE_LEDGER_ENABLED || 'false').toLowerCase() === 'true';
}

function appendAgentTrace(env = process.env, input = {}) {
  if (!isAgentTraceEnabled(env)) {
    return false;
  }
  const file = getAgentTraceLedgerPath(env);
  if (!file) {
    return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(buildAgentTraceEntry(input))}\n`, 'utf8');
  return true;
}

function readAgentTraces(env = process.env, limit = 200) {
  const file = getAgentTraceLedgerPath(env);
  if (!file || !existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Number(limit || 200))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  appendAgentTrace,
  buildAgentTraceEntry,
  getAgentTraceLedgerPath,
  isAgentTraceEnabled,
  readAgentTraces,
};
