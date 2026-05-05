const { appendFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pickUsageNumber(usage = {}, ...keys) {
  for (const key of keys) {
    const value = numberOrUndefined(usage?.[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function buildUsageLedgerEntry(input = {}) {
  const usage = input.modelResult?.usage || input.usage || {};
  const route = input.route || {};
  const entry = {
    timestamp: input.timestamp || new Date().toISOString(),
    assistant: input.assistant,
    agent: route.agent || input.agent,
    action: route.action || input.action,
    model: input.modelResult?.model || input.model,
    tier: input.modelResult?.tier || input.tier,
    endpoint: input.modelResult?.endpoint || input.endpoint,
    apiKeyIndex: numberOrUndefined(input.modelResult?.apiKeyIndex ?? input.apiKeyIndex),
    elapsedMs: numberOrUndefined(input.elapsedMs),
    modelElapsedMs: numberOrUndefined(input.modelElapsedMs),
    promptChars: numberOrUndefined(input.promptChars),
    replyChars: numberOrUndefined(input.replyChars),
    promptTokens: pickUsageNumber(usage, 'prompt_tokens', 'input_tokens'),
    completionTokens: pickUsageNumber(usage, 'completion_tokens', 'output_tokens'),
    totalTokens: pickUsageNumber(usage, 'total_tokens'),
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function getUsageLedgerPath(env = process.env) {
  return String(env.FEISHU_USAGE_LEDGER_PATH || env.USAGE_LEDGER_PATH || '').trim();
}

function isUsageLedgerEnabled(env = process.env) {
  return String(env.FEISHU_USAGE_LEDGER_ENABLED || env.USAGE_LEDGER_ENABLED || 'false').toLowerCase() === 'true';
}

function appendUsageLedgerEntry(env = process.env, input = {}) {
  if (!isUsageLedgerEnabled(env)) {
    return false;
  }

  const file = getUsageLedgerPath(env);
  if (!file) {
    return false;
  }

  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(buildUsageLedgerEntry(input))}\n`, 'utf8');
  return true;
}

module.exports = {
  appendUsageLedgerEntry,
  buildUsageLedgerEntry,
  getUsageLedgerPath,
  isUsageLedgerEnabled,
};
