function normalizeText(value) {
  return String(value || '').trim();
}

function extractField(text, names = []) {
  const source = String(text || '');
  for (const name of names) {
    const pattern = new RegExp(`(?:^|[\\s,，;；])${name}\\s*[:：]\\s*([^\\s,，;；]+)`, 'i');
    const match = source.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

function maskApiKey(value) {
  const key = normalizeText(value);
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}...${key.length}`;
  return `${key.slice(0, 6)}...${key.slice(-4)} (${key.length})`;
}

function looksLikeModelUrl(value) {
  return /(longcat|openai|xf-yun|xfyun|maas|chat|model|llm|api\.)/i.test(String(value || ''));
}

function parseModelChannelConfig(text) {
  const raw = String(text || '');
  const url = extractField(raw, ['url', 'base_url', 'baseUrl', '地址']);
  const apiKey = extractField(raw, ['key', 'api_key', 'apikey', 'apiKey', 'token']);
  const model = extractField(raw, ['model', '模型']);
  const simpleModel = extractField(raw, ['simple', 'simple_model', '轻量模型', '简单模型']);
  const thinkingModel = extractField(raw, ['thinking', 'thinking_model', '思考模型', '复杂模型']);
  const endpointMode = extractField(raw, ['mode', 'endpoint', 'endpoint_mode', '接口模式']) || 'chat_completions';
  const scope = extractField(raw, ['scope', '范围']) || 'current';
  const hasUrlField = /(?:^|[\s,，;；])(?:url|base_url|baseUrl|地址)\s*[:：]/i.test(raw);
  const hasKeyField = /(?:^|[\s,，;；])(?:key|api_key|apikey|apiKey|token)\s*[:：]/i.test(raw);
  const hasModelField = /(?:^|[\s,，;；])(?:model|模型|simple|simple_model|thinking|thinking_model|轻量模型|简单模型|思考模型|复杂模型)\s*[:：]/i.test(raw);
  const hasExplicitSwitchIntent = /(切换|替换|更新|配置|设置|更换).{0,16}(聊天|文本|模型|llm|longcat|讯飞|qwen|通道|key|api)/i.test(raw)
    || /(聊天|文本|模型|llm|longcat|讯飞|qwen).{0,16}(切换|替换|更新|配置|设置|更换)/i.test(raw);
  const hasExplicitImageIntent = /(生图|图片|图像|绘图|画图|image|img)/i.test(raw);
  const candidate = (hasUrlField || hasKeyField || hasModelField)
    && !hasExplicitImageIntent
    && (hasExplicitSwitchIntent || hasModelField || looksLikeModelUrl(url));

  let confidence = 'none';
  const missing = [];
  if (candidate) {
    if (!url) missing.push('url');
    if (!apiKey) missing.push('key');
    if (url && apiKey && hasExplicitSwitchIntent) {
      confidence = 'high';
    } else if (url && apiKey) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
  }

  return {
    url,
    apiKey,
    maskedApiKey: maskApiKey(apiKey),
    model,
    simpleModel,
    thinkingModel,
    endpointMode,
    scope,
    confidence,
    missing,
    hasCandidateFields: candidate,
    hasExplicitSwitchIntent,
  };
}

module.exports = {
  maskApiKey,
  parseModelChannelConfig,
};
