const http = require('node:http');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  buildFileChannelNotice,
  registerIncomingFile,
} = require('./file-channel');

function readJsonFile(filePath, fallback = {}) {
  if (!filePath || !existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getWechatBridgeConfig(env = process.env) {
  const projectDir = env.LOCAL_PROJECT_DIR || process.cwd();
  return {
    port: Number(env.WECHAT_BRIDGE_PORT || 8789),
    sessionFile: env.WECHAT_BRIDGE_SESSION_FILE || join(projectDir, 'data', 'wechat-bridge', 'session.json'),
    qrcodeFile: env.WECHAT_BRIDGE_QRCODE_FILE || join(projectDir, 'data', 'wechat-bridge', 'qrcode.txt'),
    fileChannelRoot: env.FILE_CHANNEL_ROOT || join(projectDir, 'data', 'file-channel'),
    openclawWebhookUrl: env.WECHAT_BRIDGE_OPENCLAW_WEBHOOK_URL || 'http://127.0.0.1:8788/webhook/feishu',
  };
}

function getBridgeStatus(config = getWechatBridgeConfig()) {
  const session = readJsonFile(config.sessionFile, {});
  return {
    ok: true,
    channel: 'wechat-web-bridge',
    loggedIn: Boolean(session.loggedIn),
    wxid: session.wxid || '',
    sessionFile: config.sessionFile,
    fileChannelRoot: config.fileChannelRoot,
  };
}

function buildSendResult(input = {}) {
  const to = String(input.to || '').trim();
  const text = String(input.text || '').trim();
  if (!to) {
    return { ok: false, error: 'missing_to' };
  }
  if (!text) {
    return { ok: false, error: 'missing_text' };
  }
  return {
    ok: true,
    mode: 'dry-run',
    message: '微信 Web Bridge 发送接口已接收。真实发送需要后续启用 Playwright 登录会话。',
    to,
    text,
  };
}

function buildSendFileResult(input = {}, env = process.env) {
  const to = String(input.to || '').trim();
  if (!to) {
    return { ok: false, error: 'missing_to' };
  }
  const file = registerIncomingFile({
    id: input.id,
    path: input.path || input.filePath || input.relativePath,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    source: input.source || 'wechat-web-bridge',
    metadata: {
      to,
      note: input.note || '',
      ...input.metadata,
    },
  }, env);
  return {
    ok: true,
    mode: 'dry-run',
    to,
    file,
    notice: buildFileChannelNotice(file),
  };
}

function buildQrCodeResult(config = getWechatBridgeConfig()) {
  const qrcode = existsSync(config.qrcodeFile)
    ? readFileSync(config.qrcodeFile, 'utf8').trim()
    : '';
  return {
    ok: true,
    loggedIn: getBridgeStatus(config).loggedIn,
    qrcode,
    message: qrcode
      ? '请用微信扫码登录网页微信通道。'
      : '暂未生成二维码。后续启用 Playwright runner 后会写入二维码链接或截图路径。',
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function createWechatBridgeServer(env = process.env, options = {}) {
  const config = options.config || getWechatBridgeConfig(env);
  return http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, getBridgeStatus(config));
        return;
      }
      if (request.method === 'GET' && request.url === '/qrcode') {
        sendJson(response, 200, buildQrCodeResult(config));
        return;
      }
      if (request.method === 'POST' && request.url === '/send') {
        const raw = await readRequestBody(request);
        sendJson(response, 200, buildSendResult(raw ? JSON.parse(raw) : {}));
        return;
      }
      if (request.method === 'POST' && request.url === '/send_file') {
        const raw = await readRequestBody(request);
        sendJson(response, 200, buildSendFileResult(raw ? JSON.parse(raw) : {}, env));
        return;
      }
      sendJson(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

function main() {
  const config = getWechatBridgeConfig();
  const server = createWechatBridgeServer(process.env, { config });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`WeChat Web Bridge listening on http://127.0.0.1:${config.port}`);
    console.log('Endpoints: GET /health, GET /qrcode, POST /send, POST /send_file');
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildQrCodeResult,
  buildSendFileResult,
  buildSendResult,
  createWechatBridgeServer,
  getBridgeStatus,
  getWechatBridgeConfig,
  readJsonFile,
  writeJsonFile,
};
