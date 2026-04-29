const http = require('node:http');

const {
  dispatchWorkflow,
  parseCliArgs,
} = require('./trigger-ui-tests');

const VALID_RUN_MODES = new Set(['contracts', 'smoke', 'all']);

function parseJsonContent(content) {
  if (typeof content !== 'string') {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch {
    return { text: content };
  }
}

function extractFeishuText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.text === 'string') {
    return payload.text.trim();
  }

  if (typeof payload.message?.text === 'string') {
    return payload.message.text.trim();
  }

  const eventContent = payload.event?.message?.content;
  const content = parseJsonContent(eventContent);
  if (typeof content?.text === 'string') {
    return content.text.trim();
  }

  return '';
}

function parseRunUiTestCommand(text) {
  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const command = parts[0];
  if (command !== '/run-ui-test' && command !== 'run-ui-test') {
    return null;
  }

  const targetRef = parts[1] || 'main';
  const runMode = parts[2] || 'contracts';
  if (!VALID_RUN_MODES.has(runMode)) {
    throw new Error(`Unsupported run mode: ${runMode}. Use contracts, smoke, or all.`);
  }

  return {
    targetRef,
    runMode,
  };
}

function extractSenderId(payload) {
  const senderId = payload?.event?.sender?.sender_id ?? {};
  return senderId.open_id || senderId.user_id || senderId.union_id || payload?.sender_id || '';
}

function isAuthorized(payload, env) {
  const allowlist = String(env.FEISHU_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowlist.length === 0) {
    return true;
  }

  return allowlist.includes(extractSenderId(payload));
}

function buildDispatchConfig(command, env) {
  const config = parseCliArgs([], env);
  config.inputs.target_ref = command.targetRef;
  config.inputs.run_mode = command.runMode;
  return config;
}

async function handleFeishuWebhook(payload, env = process.env, dispatch = dispatchWorkflow) {
  if (payload?.challenge) {
    return {
      statusCode: 200,
      body: {
        challenge: payload.challenge,
      },
    };
  }

  if (!isAuthorized(payload, env)) {
    return {
      statusCode: 403,
      body: {
        ok: false,
        message: '未授权用户不能触发 UI 自动化测试',
      },
    };
  }

  const text = extractFeishuText(payload);
  let command;
  try {
    command = parseRunUiTestCommand(text);
  } catch (error) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: error.message,
      },
    };
  }

  if (!command) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: '指令不合法，请使用：/run-ui-test main contracts',
      },
    };
  }

  const config = buildDispatchConfig(command, env);
  const result = await dispatch(config);
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: `UI 自动化测试已触发：分支 ${command.targetRef}，模式 ${command.runMode}`,
      actionsUrl: result.actionsUrl,
      targetRepository: config.inputs.target_repository,
      targetRef: config.inputs.target_ref,
      runMode: config.inputs.run_mode,
    },
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function createServer(env = process.env) {
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== 'POST' || request.url !== '/webhook/feishu') {
      sendJson(response, 404, { ok: false, message: 'Not found' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const result = await handleFeishuWebhook(payload, env);
      sendJson(response, result.statusCode, result.body);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message,
      });
    }
  });
}

function main() {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, () => {
    console.log(`Feishu bridge listening on http://127.0.0.1:${port}`);
    console.log('Webhook path: POST /webhook/feishu');
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createServer,
  extractFeishuText,
  handleFeishuWebhook,
  parseRunUiTestCommand,
};

