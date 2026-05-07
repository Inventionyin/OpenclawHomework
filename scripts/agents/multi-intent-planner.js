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
    matches: (text) => /(失败|failed|异常|报错).{0,12}(任务|task)|(任务|task).{0,12}(失败|failed|异常|报错)/i.test(text),
  },
  {
    action: 'trend-intel',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求趋势情报',
    keywords: ['趋势', '情报', '新闻', '热榜', '开源'],
  },
  {
    action: 'token-summary',
    agent: 'clerk-agent',
    requiresAuth: true,
    reason: '用户请求 token 汇总',
    keywords: ['token', '用量', '汇总'],
    matches: (text) => /(?:统计|汇总|查询|查看|看看|看|谁更费|用了多少).{0,16}(token|额度)|(token|额度).{0,16}(用量|汇总|统计|账本|消耗情况|用了多少)/i.test(text),
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
    const matched = typeof def.matches === 'function'
      ? def.matches(text)
      : includesAny(text, def.keywords);
    if (matched) {
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
  const hasConnector = includesAny(normalized, MULTI_CONNECTORS);
  const isMultiIntent = hasConnector && intents.length > 1;
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
