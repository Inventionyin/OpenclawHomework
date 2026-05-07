const SAFE_INTENT_DEFS = [
  {
    action: 'load-summary',
    agent: 'ops-agent',
    requiresAuth: true,
    reason: '用户请求服务器内存/硬盘资源概览',
    keywords: ['服务器', '内存', '硬盘', '磁盘', '资源'],
  },
  {
    action: 'task-center-failed',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求任务中心今天失败任务',
    keywords: ['今天', '失败', '任务'],
  },
  {
    action: 'trend-intel',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求趋势情报',
    keywords: ['趋势', '情报', '新闻', '热榜', '开源'],
  },
  {
    action: 'daily-email',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求日报/邮件发送',
    keywords: ['邮箱', '邮件', '日报', '报告', '发我'],
  },
  {
    action: 'token-summary',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求 token 汇总',
    keywords: ['token', '用量', '汇总'],
  },
  {
    action: 'training-data',
    agent: 'qa-agent',
    requiresAuth: true,
    reason: '用户请求 QA 训练数据',
    keywords: ['qa', '训练数据', '训练集'],
  },
];

const DANGEROUS_KEYWORDS = ['重启', '修复', '维修', '清理', 'cleanup', 'restart', 'repair', '执行', 'exec'];
const MULTI_CONNECTORS = ['并', '并且', '并行', '同时', '顺便', '再', '然后', '和', '及', '、', '，', ',', ';', '；'];

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function findSafeIntents(text) {
  const found = [];
  for (const def of SAFE_INTENT_DEFS) {
    if (includesAny(text, def.keywords)) {
      found.push({
        agent: def.agent,
        action: def.action,
        requiresAuth: def.requiresAuth,
        reason: def.reason,
      });
    }
  }
  return found;
}

function planMultiIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      isMultiIntent: false,
      confidence: 'low',
      intents: [],
      blocked: [],
      summary: 'empty input',
    };
  }

  const hasDanger = includesAny(normalized, DANGEROUS_KEYWORDS);
  if (hasDanger) {
    const blocked = ['dangerous_operation_detected'];
    const hasConnector = includesAny(normalized, MULTI_CONNECTORS);
    return {
      isMultiIntent: false,
      confidence: hasConnector ? 'high' : 'medium',
      intents: [],
      blocked,
      summary: hasConnector
        ? 'blocked: dangerous operations cannot be mixed with other intents'
        : 'blocked: dangerous operation needs separate confirmation',
    };
  }

  const intents = findSafeIntents(normalized);
  const isMultiIntent = intents.length > 1;
  return {
    isMultiIntent,
    confidence: isMultiIntent ? 'high' : intents.length === 1 ? 'medium' : 'low',
    intents,
    blocked: [],
    summary: isMultiIntent
      ? `split into ${intents.length} safe intents`
      : intents.length === 1
        ? 'single safe intent'
        : 'no safe multi-intent detected',
  };
}

function hasMultipleSafeIntents(text) {
  const plan = planMultiIntent(text);
  return plan.isMultiIntent && plan.blocked.length === 0;
}

module.exports = {
  planMultiIntent,
  hasMultipleSafeIntents,
};
