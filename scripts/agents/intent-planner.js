const { buildCapabilityPromptCatalog } = require('./capability-registry');

function buildIntentPlannerPrompt(text, assistantName = 'OpenClaw') {
  return [
    `你是 ${assistantName} 的自然语言总控规划器。`,
    '目标：判断用户是在聊天、要执行工具，还是需要先追问。',
    '只输出 JSON，不要解释。',
    'JSON 格式：{"intent":"chat|tool|clarify","agent":"chat-agent|qa-agent|ops-agent|ui-test-agent|image-agent|memory-agent|doc-agent|capability-agent|planner-agent|clerk-agent|browser-agent","action":"...","confidence":"high|medium|low","reason":"...","missing":[]}',
    '危险操作如重启、修复、执行 shell 必须由明确规则确认；模糊请求用 clarify。',
    '',
    '可用能力：',
    buildCapabilityPromptCatalog(),
    '',
    `用户消息：${text}`,
  ].join('\n');
}

function parseIntentPlannerOutput(output) {
  const text = String(output ?? '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const intent = ['chat', 'tool', 'clarify'].includes(parsed.intent) ? parsed.intent : 'chat';
    return {
      intent,
      agent: String(parsed.agent || (intent === 'clarify' ? 'planner-agent' : 'chat-agent')),
      action: String(parsed.action || (intent === 'clarify' ? 'clarify' : 'chat')),
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      reason: String(parsed.reason || '').slice(0, 200),
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

module.exports = {
  buildIntentPlannerPrompt,
  parseIntentPlannerOutput,
};
