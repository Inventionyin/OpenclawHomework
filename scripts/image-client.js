function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildImageConfig(env = process.env) {
  return {
    baseUrl: normalizeBaseUrl(env.IMAGE_MODEL_BASE_URL || env.IMAGE_BASE_URL || ''),
    apiKey: String(env.IMAGE_MODEL_API_KEY || env.IMAGE_API_KEY || '').trim(),
    model: String(env.IMAGE_MODEL_ID || env.IMAGE_MODEL || 'auto').trim(),
    size: String(env.IMAGE_MODEL_SIZE || env.IMAGE_SIZE || '1024x1024').trim(),
  };
}

function extractModelIds(body) {
  if (!body || !Array.isArray(body.data)) {
    return [];
  }
  return body.data
    .map((item) => String(item?.id || item?.root || '').trim())
    .filter(Boolean);
}

function chooseImageModel(modelIds = []) {
  const ids = modelIds.map(String).filter(Boolean);
  const preferred = [
    /^gpt-image-2$/i,
    /^codex-gpt-image-2$/i,
    /^gpt-image-1$/i,
    /image/i,
    /dall-?e/i,
    /flux/i,
    /sdxl/i,
  ];

  for (const pattern of preferred) {
    const match = ids.find((id) => pattern.test(id));
    if (match) {
      return match;
    }
  }
  return ids[0] || 'gpt-image-2';
}

async function resolveImageModel(config, fetchImpl = fetch) {
  if (config.model && config.model !== 'auto') {
    return config.model;
  }

  const response = await fetchImpl(`${config.baseUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  if (!response.ok) {
    return 'gpt-image-2';
  }

  const body = await response.json();
  return chooseImageModel(extractModelIds(body));
}

function extractImageResult(body) {
  const item = body?.data?.[0] || {};
  if (item.url) {
    return {
      type: 'url',
      url: String(item.url),
      revisedPrompt: item.revised_prompt || '',
    };
  }
  if (item.b64_json) {
    return {
      type: 'b64_json',
      b64Json: String(item.b64_json),
      mimeType: item.mime_type || 'image/png',
      revisedPrompt: item.revised_prompt || '',
    };
  }
  throw new Error('Image generation response did not include url or b64_json.');
}

async function generateImage(prompt, options = {}) {
  const envConfig = buildImageConfig(options.env || process.env);
  const config = {
    ...envConfig,
    ...Object.fromEntries(Object.entries(options).filter(([key]) => ['baseUrl', 'apiKey', 'model', 'size'].includes(key))),
  };
  config.baseUrl = normalizeBaseUrl(config.baseUrl);

  if (!config.baseUrl || !config.apiKey) {
    throw new Error('Missing image model config.');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const model = await resolveImageModel(config, fetchImpl);
  const response = await fetchImpl(`${config.baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size: config.size,
      n: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Image generation failed: ${response.status} ${response.statusText} ${body}`.trim());
  }

  const body = await response.json();
  return {
    model,
    ...extractImageResult(body),
  };
}

module.exports = {
  buildImageConfig,
  chooseImageModel,
  extractImageResult,
  extractModelIds,
  generateImage,
  resolveImageModel,
};
