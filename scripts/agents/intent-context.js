const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const DEFAULT_CONTEXT_FILE = join(__dirname, '..', '..', 'data', 'memory', 'intent-context.json');
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

const SAFE_METADATA_FIELDS = ['agent', 'action', 'confidence', 'requiresAuth', 'updatedAt', 'source'];
const FOLLOW_UP_PATTERN = /^(继续|接着|然后|再来|继续这个|继续上个|按刚才|就这个|刚才那个|刚刚那个|上个|上一条|这个总共|那个加起来|go on|continue|same as before|as above)/i;
const SAFE_CONTEXT_ACTIONS = {
  'clerk-agent': new Set([
    'token-summary',
    'todo-summary',
    'command-center',
    'task-center-today',
    'task-center-brain',
    'task-center-failed',
    'token-factory-status',
    'daily-pipeline-status',
    'mail-ledger',
    'mailbox-tasks',
    'mailbox-approvals',
    'trend-intel',
  ]),
  'ops-agent': new Set([
    'status',
    'health',
    'watchdog',
    'memory-summary',
    'disk-summary',
    'load-summary',
    'peer-status',
    'peer-health',
    'peer-memory-summary',
    'peer-disk-summary',
    'peer-load-summary',
  ]),
  'browser-agent': new Set([
    'browser-dry-run',
    'protocol-capture-plan',
    'protocol-assets-report',
    'protocol-assets-to-tests',
  ]),
  'qa-agent': new Set([
    'dify-testing-assistant',
    'customer-service-data',
    'agent-eval',
    'ui-matrix',
    'email-playbook',
    'overview',
  ]),
};

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readContextStore(filePath = DEFAULT_CONTEXT_FILE) {
  if (!existsSync(filePath)) return {};
  const parsed = safeParseJson(readFileSync(filePath, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function buildConversationKey(payloadOrKey, explicitKey) {
  if (typeof explicitKey === 'string' && explicitKey.trim()) return explicitKey.trim();
  if (typeof payloadOrKey === 'string' && payloadOrKey.trim()) return payloadOrKey.trim();
  if (!payloadOrKey || typeof payloadOrKey !== 'object') return null;

  const chatId =
    payloadOrKey?.event?.message?.chat_id ||
    payloadOrKey?.message?.chat_id ||
    payloadOrKey?.chat_id ||
    payloadOrKey?.conversation_id;
  const openId =
    payloadOrKey?.event?.sender?.sender_id?.open_id ||
    payloadOrKey?.sender?.sender_id?.open_id ||
    payloadOrKey?.sender?.open_id ||
    payloadOrKey?.open_id;

  if (chatId && openId) return `chat:${chatId}:user:${openId}`;
  if (chatId) return `chat:${chatId}`;
  if (openId) return `user:${openId}`;
  return null;
}

function readIntentContext(conversationKey, options = {}) {
  if (!conversationKey) return null;
  const filePath = options.filePath || DEFAULT_CONTEXT_FILE;
  const store = readContextStore(filePath);
  const entry = store[conversationKey];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const sanitized = {};
  for (const field of SAFE_METADATA_FIELDS) {
    if (entry[field] !== undefined) sanitized[field] = entry[field];
  }
  return sanitized.agent && sanitized.action ? sanitized : null;
}

function writeIntentContext(conversationKey, routeMetadata, options = {}) {
  if (!conversationKey || !routeMetadata || typeof routeMetadata !== 'object') return;
  const filePath = options.filePath || DEFAULT_CONTEXT_FILE;
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const now = new Date(options.now || Date.now()).toISOString();
  const store = readContextStore(filePath);
  const sanitized = {
    agent: routeMetadata.agent,
    action: routeMetadata.action,
    confidence: routeMetadata.confidence,
    requiresAuth: Boolean(routeMetadata.requiresAuth),
    updatedAt: now,
    source: routeMetadata.source || 'unknown',
  };
  if (!sanitized.agent || !sanitized.action) return;
  store[conversationKey] = sanitized;

  const keys = Object.keys(store);
  if (maxEntries > 0 && keys.length > maxEntries) {
    keys
      .sort((a, b) => {
        const ta = Date.parse(store[a]?.updatedAt || 0);
        const tb = Date.parse(store[b]?.updatedAt || 0);
        return ta - tb;
      })
      .slice(0, keys.length - maxEntries)
      .forEach((key) => delete store[key]);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function getFreshIntentHint(conversationKey, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const now = options.now || Date.now();
  const hint = readIntentContext(conversationKey, options);
  if (!hint || !hint.updatedAt) return null;
  const updatedAtMs = Date.parse(hint.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return null;
  if (now - updatedAtMs > ttlMs) return null;
  return hint;
}

function isSafeContextAction(hint) {
  if (!hint) return false;
  const agent = hint.agent;
  const action = hint.action;
  return Boolean(SAFE_CONTEXT_ACTIONS[agent]?.has(action));
}

function routeFromContextHint(text, hint) {
  if (typeof text !== 'string' || !FOLLOW_UP_PATTERN.test(text.trim())) return null;
  if (!isSafeContextAction(hint)) return null;
  return {
    agent: hint.agent,
    action: hint.action,
    confidence: 'medium',
    requiresAuth: Boolean(hint.requiresAuth),
    intentSource: 'context-hint',
  };
}

module.exports = {
  buildConversationKey,
  readIntentContext,
  writeIntentContext,
  getFreshIntentHint,
  routeFromContextHint,
};
