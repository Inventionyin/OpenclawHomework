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

function parseImageChannelConfig(text) {
  const raw = String(text || '');
  const url = extractField(raw, ['url', 'base_url', 'baseUrl', '地址']);
  const apiKey = extractField(raw, ['key', 'api_key', 'apikey', 'apiKey', 'token']);
  const model = extractField(raw, ['model', '模型']) || 'auto';
  const size = extractField(raw, ['size', '尺寸']) || '1024x1024';
  const scope = extractField(raw, ['scope', '范围']) || 'both';
  const hasUrlField = /(?:^|[\s,，;；])(?:url|base_url|baseUrl|地址)\s*[:：]/i.test(raw);
  const hasKeyField = /(?:^|[\s,，;；])(?:key|api_key|apikey|apiKey|token)\s*[:：]/i.test(raw);
  const hasExplicitSwitchIntent = /(切换|替换|更新|配置|设置|更换).{0,16}(生图|图片|图像|绘图|画图|image|通道|key|api)/i.test(raw)
    || /(生图|图片|图像|绘图|画图|image).{0,16}(切换|替换|更新|配置|设置|更换)/i.test(raw);

  let confidence = 'none';
  const missing = [];
  if (hasUrlField || hasKeyField) {
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
    size,
    scope,
    confidence,
    missing,
    hasCandidateFields: hasUrlField || hasKeyField,
    hasExplicitSwitchIntent,
  };
}

module.exports = {
  maskApiKey,
  parseImageChannelConfig,
};
