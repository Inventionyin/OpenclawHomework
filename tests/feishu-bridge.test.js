const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildFeishuResultCard,
  buildFeishuTextMessage,
  buildEmailRunResultMessage,
  buildEmailRunResultSubject,
  createServer,
  extractFeishuText,
  getFeishuDedupKeys,
  getFeishuRouteMode,
  buildRouteEnv,
  handleFeishuWebhook,
  isDuplicateFeishuEvent,
  parseOpenClawCommandOutput,
  parseRunUiTestCommand,
  parseSmallTalkMessage,
  buildRunArtifactsUrl,
  parseOpenClawChatOutput,
  runHermesChat,
  runLocalOpsAction,
  runOpenClawChat,
  sendFeishuTextMessage,
  sendEmailRunResultNotification,
  notifyFeishuRunResult,
  runOpenClawParser,
} = require('../scripts/feishu-bridge');

async function waitForCondition(checker, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 2000);
  const intervalMs = Number(options.intervalMs || 25);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (checker()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Timed out waiting for async condition');
}

test('parseRunUiTestCommand parses branch and run mode', () => {
  assert.deepEqual(parseRunUiTestCommand('/run-ui-test develop smoke'), {
    targetRef: 'develop',
    runMode: 'smoke',
  });
});

test('parseRunUiTestCommand uses safe defaults', () => {
  assert.deepEqual(parseRunUiTestCommand('/run-ui-test'), {
    targetRef: 'main',
    runMode: 'contracts',
  });
});

test('parseRunUiTestCommand allows bot mention before command', () => {
  assert.deepEqual(parseRunUiTestCommand('@OpenClaw UI 自动化助手 /run-ui-test main contracts'), {
    targetRef: 'main',
    runMode: 'contracts',
  });
});

test('parseRunUiTestCommand rejects negated embedded commands', () => {
  assert.equal(parseRunUiTestCommand('不要 /run-ui-test main smoke'), null);
  assert.equal(parseRunUiTestCommand('如何使用 /run-ui-test main smoke'), null);
  assert.equal(parseRunUiTestCommand('请问 /run-ui-test main smoke 怎么用'), null);
});

test('parseOpenClawCommandOutput extracts JSON command from model output', () => {
  const output = [
    'model.run via local',
    'provider: xfyun',
    '{"intent":"run-ui-test","targetRef":"develop","runMode":"smoke"}',
  ].join('\n');

  assert.deepEqual(parseOpenClawCommandOutput(output), {
    targetRef: 'develop',
    runMode: 'smoke',
  });
});

test('parseOpenClawCommandOutput ignores non automation intent', () => {
  assert.equal(parseOpenClawCommandOutput('{"intent":"none"}'), null);
});

test('parseSmallTalkMessage replies to greeting without triggering automation', () => {
  const reply = parseSmallTalkMessage('你好');
  assert.match(reply, /OpenClaw UI 自动化助手/);
  assert.match(reply, /你现在内存多少/);
  assert.match(reply, /重启你自己/);
});

test('parseSmallTalkMessage help includes categorized natural-language examples', () => {
  const reply = parseSmallTalkMessage('帮助');
  assert.match(reply, /看我自己/);
  assert.match(reply, /看对方/);
  assert.match(reply, /修复 OpenClaw/);
});

test('runLocalOpsAction returns summary data for memory and disk views', async () => {
  const result = await runLocalOpsAction('memory-summary', {
    WATCHDOG_SERVICE: 'openclaw-feishu-bridge',
    LOCAL_PROJECT_DIR: '/tmp/project',
    PORT: '8788',
  }, {
    execFile: (command, args, options, callback) => {
      const joined = [command, ...(args || [])].join(' ');
      let stdout = '';
      if (command === 'systemctl') stdout = 'active\n';
      else if (command === 'git') stdout = 'abc1234\n';
      else if (joined.includes('free -h')) stdout = 'Mem: 8G 3.1G 4.9G';
      else if (joined.includes('df -h')) stdout = 'overlay 40G 10G 30G 25% /';
      else if (joined.includes('uptime')) stdout = 'load average: 0.10, 0.20, 0.30';
      callback(null, stdout, '');
    },
    fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
  });

  assert.equal(result.memory.total, '8G');
});

test('runLocalOpsAction restarts local service for restart action', async () => {
  const calls = [];
  const result = await runLocalOpsAction('restart', {
    WATCHDOG_SERVICE: 'openclaw-feishu-bridge',
    LOCAL_PROJECT_DIR: '/tmp/project',
    PORT: '8788',
  }, {
    execFile: (command, args, options, callback) => {
      calls.push([command, args]);
      if (command === 'systemctl') callback(null, args[0] === 'restart' ? '' : 'active\n', '');
      else if (command === 'git') callback(null, 'abc1234\n', '');
      else callback(null, '', '');
    },
    fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
  });

  assert(calls.some(([command, args]) => command === 'systemctl' && args[0] === 'restart'));
  assert.equal(result.operation, 'restart');
  assert.equal(result.active, 'active');
});

test('runLocalOpsAction repairs local service with pull test and restart', async () => {
  const calls = [];
  const result = await runLocalOpsAction('repair', {
    WATCHDOG_SERVICE: 'openclaw-feishu-bridge',
    LOCAL_PROJECT_DIR: '/tmp/project',
    PORT: '8788',
  }, {
    execFile: (command, args, options, callback) => {
      calls.push([command, args, options]);
      if (command === 'systemctl') callback(null, args[0] === 'restart' ? '' : 'active\n', '');
      else if (command === 'git' && args.includes('rev-parse')) callback(null, 'abc1234\n', '');
      else callback(null, '', '');
    },
    fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
  });

  assert(calls.some(([command, args]) => command === 'git' && args.includes('pull')));
  assert(calls.some(([command]) => command === 'npm'));
  assert(calls.some(([command, args]) => command === 'systemctl' && args[0] === 'restart'));
  assert.equal(result.operation, 'repair');
});

test('parseOpenClawChatOutput strips OpenClaw CLI prefix', () => {
  assert.equal(
    parseOpenClawChatOutput(['model.run via local', 'provider: xfyun', 'model: astron-code-latest', '你好，我可以帮你触发 UI 自动化。'].join('\n')),
    '你好，我可以帮你触发 UI 自动化。',
  );
});

test('extractFeishuText supports Feishu event message content', () => {
  const payload = {
    event: {
      message: {
        content: JSON.stringify({ text: '/run-ui-test main' }),
      },
    },
  };

  assert.equal(extractFeishuText(payload), '/run-ui-test main');
});

test('buildFeishuTextMessage uses chat id before sender id', () => {
  const payload = {
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        chat_id: 'chat-a',
      },
    },
  };

  assert.deepEqual(buildFeishuTextMessage(payload, '测试完成'), {
    receiveIdType: 'chat_id',
    receiveId: 'chat-a',
    msgType: 'text',
    content: JSON.stringify({ text: '测试完成' }),
  });
});

test('buildFeishuTextMessage prefers current chat id over configured notify id', () => {
  const payload = {
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        chat_id: 'current-chat',
      },
    },
  };

  assert.deepEqual(buildFeishuTextMessage(payload, '测试完成', {
    FEISHU_NOTIFY_RECEIVE_ID_TYPE: 'chat_id',
    FEISHU_NOTIFY_RECEIVE_ID: 'stale-chat',
  }), {
    receiveIdType: 'chat_id',
    receiveId: 'current-chat',
    msgType: 'text',
    content: JSON.stringify({ text: '测试完成' }),
  });
});

test('buildFeishuTextMessage can append elapsed and status footer', () => {
  const payload = {
    event: {
      message: {
        chat_id: 'chat-a',
      },
    },
  };

  const message = buildFeishuTextMessage(payload, '测试完成', {
    FEISHU_REPLY_FOOTER_ELAPSED: 'true',
    FEISHU_REPLY_FOOTER_STATUS: 'true',
  }, {
    elapsedMs: 1234,
    status: '完成',
  });

  const content = JSON.parse(message.content);
  assert.match(content.text, /测试完成/);
  assert.match(content.text, /状态：完成/);
  assert.match(content.text, /耗时：1\.2s/);
});

test('getFeishuRouteMode supports default and named bot routes', () => {
  assert.equal(getFeishuRouteMode('/webhook/feishu'), 'openclaw');
  assert.equal(getFeishuRouteMode('/webhook/feishu/openclaw'), 'openclaw');
  assert.equal(getFeishuRouteMode('/webhook/feishu/hermes'), 'hermes');
  assert.equal(getFeishuRouteMode('/webhook/feishu/hermes?foo=bar'), 'hermes');
  assert.equal(getFeishuRouteMode('/webhook/unknown'), null);
});

test('buildRouteEnv maps Hermes route to Hermes Feishu credentials', () => {
  const routeEnv = buildRouteEnv('hermes', {
    FEISHU_APP_ID: 'openclaw-app-id',
    FEISHU_APP_SECRET: 'openclaw-secret',
    HERMES_FEISHU_APP_ID: 'hermes-app-id',
    HERMES_FEISHU_APP_SECRET: 'hermes-secret',
  });

  assert.equal(routeEnv.FEISHU_APP_ID, 'hermes-app-id');
  assert.equal(routeEnv.FEISHU_APP_SECRET, 'hermes-secret');
});

test('buildRouteEnv maps Hermes route to Hermes allowlist', () => {
  const routeEnv = buildRouteEnv('hermes', {
    FEISHU_ALLOWED_USER_IDS: 'openclaw-user',
    FEISHU_REQUIRE_BINDING: 'true',
    HERMES_FEISHU_ALLOWED_USER_IDS: 'hermes-user',
  });

  assert.equal(routeEnv.FEISHU_ALLOWED_USER_IDS, 'hermes-user');
  assert.equal(routeEnv.FEISHU_ALLOWED_USER_IDS_ENV_KEY, 'HERMES_FEISHU_ALLOWED_USER_IDS');
});

test('buildRouteEnv does not reuse OpenClaw allowlist for Hermes route', () => {
  const routeEnv = buildRouteEnv('hermes', {
    FEISHU_ALLOWED_USER_IDS: 'openclaw-user',
    FEISHU_REQUIRE_BINDING: 'true',
  });

  assert.equal(routeEnv.FEISHU_ALLOWED_USER_IDS, '');
  assert.equal(routeEnv.FEISHU_REQUIRE_BINDING, 'true');
});

test('buildRouteEnv falls back to FEISHU_ENV_FILE peer ssh settings for OpenClaw route', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaw-peer-env-'));
  const envFile = join(tempDir, 'openclaw.env');
  try {
    writeFileSync(envFile, [
      'PEER_SSH_HOST=38.76.188.94',
      'PEER_SSH_USER=root',
      'PEER_SSH_PORT=22',
      'PEER_SSH_KEY=/root/.ssh/openclaw_to_hermes_ed25519',
      'PEER_NAME=Hermes',
    ].join('\n'), 'utf8');

    const routeEnv = buildRouteEnv('openclaw', {
      FEISHU_ENV_FILE: envFile,
    });

    assert.equal(routeEnv.PEER_SSH_HOST, '38.76.188.94');
    assert.equal(routeEnv.PEER_SSH_KEY, '/root/.ssh/openclaw_to_hermes_ed25519');
    assert.equal(routeEnv.PEER_NAME, 'Hermes');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildRouteEnv falls back to FEISHU_ENV_FILE peer ssh settings for Hermes route', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hermes-peer-env-'));
  const envFile = join(tempDir, 'hermes.env');
  try {
    writeFileSync(envFile, [
      'PEER_SSH_HOST=38.76.178.91',
      'PEER_SSH_USER=root',
      'PEER_SSH_PORT=22',
      'PEER_SSH_KEY=/root/.ssh/hermes_to_openclaw_ed25519',
      'PEER_NAME=OpenClaw',
    ].join('\n'), 'utf8');

    const routeEnv = buildRouteEnv('hermes', {
      FEISHU_ENV_FILE: envFile,
      HERMES_FEISHU_APP_ID: 'cli_hermes',
      HERMES_FEISHU_APP_SECRET: 'secret_hermes',
    });

    assert.equal(routeEnv.PEER_SSH_HOST, '38.76.178.91');
    assert.equal(routeEnv.PEER_SSH_KEY, '/root/.ssh/hermes_to_openclaw_ed25519');
    assert.equal(routeEnv.PEER_NAME, 'OpenClaw');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getFeishuDedupKeys prefers Feishu ids when present', () => {
  const keys = getFeishuDedupKeys({
    header: {
      event_id: 'event-a',
    },
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        message_id: 'message-a',
        chat_id: 'chat-a',
        content: JSON.stringify({ text: '你好' }),
      },
    },
  });

  assert.deepEqual(keys, ['event:event-a', 'message:message-a']);
});

test('getFeishuDedupKeys uses text fallback only when Feishu ids are missing', () => {
  const keys = getFeishuDedupKeys({
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        chat_id: 'chat-a',
        content: JSON.stringify({ text: '你好' }),
      },
    },
  });

  assert.equal(keys.length, 1);
  assert.match(keys[0], /^text:/);
});

test('isDuplicateFeishuEvent detects repeated message content', () => {
  const cache = new Map();
  const payload = {
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        chat_id: 'chat-a',
        content: JSON.stringify({ text: '帮我跑一下 main 分支的 UI 自动化冒烟测试' }),
      },
    },
  };

  assert.equal(isDuplicateFeishuEvent(payload, {}, cache), false);
  assert.equal(isDuplicateFeishuEvent(payload, {}, cache), true);
});

test('buildRunArtifactsUrl creates GitHub artifacts shortcut', () => {
  assert.equal(
    buildRunArtifactsUrl('https://github.com/Inventionyin/OpenclawHomework/actions/runs/123'),
    'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123#artifacts',
  );
});

test('buildFeishuResultCard includes run and Allure report links', () => {
  const card = buildFeishuResultCard(
    {
      targetRef: 'main',
      runMode: 'smoke',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    },
  );

  assert.equal(card.header.template, 'green');
  const content = JSON.stringify(card);
  assert.match(content, /UI 自动化测试成功/);
  assert.match(content, /GitHub Actions/);
  assert.match(content, /Allure 报告/);
  assert.match(content, /#artifacts/);
});

test('buildEmailRunResultSubject and message include run result links', () => {
  const job = {
    actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    targetRef: 'main',
    runMode: 'smoke',
  };
  const run = {
    conclusion: 'success',
    html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
  };

  assert.equal(
    buildEmailRunResultSubject(job, run),
    '[UI 自动化] success - main / smoke',
  );
  const message = buildEmailRunResultMessage(job, run);
  assert.match(message.text, /UI 自动化测试成功/);
  assert.match(message.text, /Allure \/ Playwright/);
  assert.match(message.text, /#artifacts/);
  assert.match(message.html, /UI 自动化测试成功/);
  assert.match(message.html, /actions\/runs\/123#artifacts/);
});

test('sendEmailRunResultNotification sends email when SMTP env is enabled', async () => {
  const sent = [];
  const result = await sendEmailRunResultNotification(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
      targetRef: 'main',
      runMode: 'contracts',
    },
    {
      conclusion: 'failure',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'bot@example.com',
      SMTP_PASS: 'smtp-password',
      EMAIL_FROM: 'bot@example.com',
      EMAIL_TO: 'a@example.com, b@example.com',
    },
    {
      createTransport: (config) => {
        assert.equal(config.host, 'smtp.example.com');
        assert.equal(config.port, 465);
        assert.equal(config.secure, true);
        assert.equal(config.auth.user, 'bot@example.com');
        return {
          sendMail: async (mail) => {
            sent.push(mail);
            return { messageId: 'message-1' };
          },
        };
      },
    },
  );

  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['a@example.com', 'b@example.com']);
  assert.match(sent[0].subject, /failure/);
  assert.match(sent[0].text, /UI 自动化测试失败/);
});

test('notifyFeishuRunResult sends email after completed run notification', async () => {
  const feishuMessages = [];
  const emailJobs = [];
  const completedRun = {
    id: 123,
    conclusion: 'success',
    html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
  };
  const job = {
    actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    config: {
      owner: 'Inventionyin',
      repo: 'OpenclawHomework',
      inputs: {
        target_ref: 'main',
        run_mode: 'smoke',
      },
    },
    message: {
      receiveIdType: 'chat_id',
      receiveId: 'chat-a',
      msgType: 'text',
      content: JSON.stringify({ text: 'started' }),
    },
    run: {
      id: 123,
    },
    runMode: 'smoke',
    targetRef: 'main',
  };

  const result = await notifyFeishuRunResult(job, {
    FEISHU_CARD_ENABLED: 'false',
    EMAIL_NOTIFY_ENABLED: 'true',
  }, async () => {
    throw new Error('fetch should not be used with injected wait function');
  }, {
    waitForCompletion: async () => completedRun,
    feishuSender: async (env, message) => {
      feishuMessages.push(message);
    },
    emailSender: async (scheduledJob, run) => {
      emailJobs.push({ scheduledJob, run });
      return { sent: true };
    },
  });

  assert.equal(result, completedRun);
  assert.equal(feishuMessages.length, 1);
  assert.equal(emailJobs.length, 1);
  assert.equal(emailJobs[0].scheduledJob.targetRef, 'main');
  assert.equal(emailJobs[0].run.conclusion, 'success');
});

test('sendFeishuTextMessage fetches tenant token and sends text message', async () => {
  const calls = [];
  await sendFeishuTextMessage(
    {
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      receiveIdType: 'open_id',
      receiveId: 'user-a',
      msgType: 'text',
      content: JSON.stringify({ text: 'UI 自动化完成' }),
    },
    async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: 'tenant-token',
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          code: 0,
        }),
      };
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    app_id: 'cli_xxx',
    app_secret: 'secret_xxx',
  });
  assert.match(calls[1].url, /receive_id_type=open_id$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token');
});

test('handleFeishuWebhook responds to Feishu challenge', async () => {
  const response = await handleFeishuWebhook({ challenge: 'abc123' }, {}, async () => {
    throw new Error('dispatch should not be called');
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { challenge: 'abc123' });
});

test('createServer responds to Feishu challenge on Hermes route', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ challenge: 'hermes-challenge' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: 'hermes-challenge' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer accepts OpenClaw route for Feishu challenge', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/openclaw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ challenge: 'openclaw-challenge' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: 'openclaw-challenge' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer acknowledges Feishu webhook before background dispatch completes', async () => {
  let dispatchStarted = false;
  let finishDispatch;
  const dispatchFinished = new Promise((resolve) => {
    finishDispatch = resolve;
  });
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
    },
    {
      dispatch: async () => {
        dispatchStarted = true;
        await dispatchFinished;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/run-ui-test main contracts' }),
          },
        },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.message, '飞书指令已收到，正在后台触发 UI 自动化测试');

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchStarted, true);
    finishDispatch();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores duplicate Feishu webhook events', async () => {
  let dispatchCount = 0;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
    },
    {
      dispatch: async () => {
        dispatchCount += 1;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const payload = {
      header: {
        event_id: 'event-a',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          message_id: 'message-a',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '/run-ui-test main contracts' }),
        },
      },
    };
    const firstResponse = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const secondResponse = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal((await secondResponse.json()).duplicate, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('isDuplicateFeishuEvent allows repeated text when Feishu ids differ', () => {
  const cache = new Map();
  const firstPayload = {
    header: {
      event_id: 'event-a',
    },
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        message_id: 'message-a',
        chat_id: 'chat-a',
        content: JSON.stringify({ text: '你好' }),
      },
    },
  };
  const secondPayload = {
    header: {
      event_id: 'event-b',
    },
    event: {
      sender: {
        sender_id: {
          open_id: 'user-a',
        },
      },
      message: {
        message_id: 'message-b',
        chat_id: 'chat-a',
        content: JSON.stringify({ text: '你好' }),
      },
    },
  };

  assert.equal(isDuplicateFeishuEvent(firstPayload, {}, cache), false);
  assert.equal(isDuplicateFeishuEvent(secondPayload, {}, cache), false);
});

test('createServer sends immediate Feishu receipt in async mode when notification is configured', async () => {
  let receipt;
  let finishDispatch;
  const dispatchFinished = new Promise((resolve) => {
    finishDispatch = resolve;
  });
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      dispatch: async () => {
        await dispatchFinished;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        receipt = message;
      },
      scheduler: async () => {},
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/run-ui-test main contracts' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receipt.receiveIdType, 'chat_id');
    assert.equal(receipt.receiveId, 'chat-a');
    assert.match(JSON.parse(receipt.content).text, /收到了，正在运行 UI 自动化测试/);
    assert.match(JSON.parse(receipt.content).text, /报告生成后我会发给你/);
    finishDispatch();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('scheduleFeishuResultNotification deduplicates repeated report notifications for same chat and command', async () => {
  const {
    scheduleFeishuResultNotification,
  } = require('../scripts/feishu-bridge');
  const cache = new Map();
  const scheduled = [];
  const job = {
    actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    config: {
      owner: 'Inventionyin',
      repo: 'OpenclawHomework',
      inputs: {
        target_ref: 'main',
        run_mode: 'smoke',
      },
    },
    message: {
      receiveIdType: 'chat_id',
      receiveId: 'chat-a',
      msgType: 'text',
      content: JSON.stringify({ text: 'started' }),
    },
    run: {
      id: 123,
    },
    runMode: 'smoke',
    targetRef: 'main',
  };

  scheduleFeishuResultNotification(job, {
    FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS: '300000',
  }, {
    cache,
    notifier: async (scheduledJob) => {
      scheduled.push(scheduledJob);
    },
  });
  scheduleFeishuResultNotification(job, {
    FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS: '300000',
  }, {
    cache,
    notifier: async (scheduledJob) => {
      scheduled.push(scheduledJob);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(scheduled.length, 1);
});

test('createServer can skip immediate automation receipt', async () => {
  let receipt;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_AUTOMATION_RECEIPT_ENABLED: 'false',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        receipt = message;
      },
      scheduler: async () => {},
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/run-ui-test main smoke' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, true);
    assert.equal(receipt, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer replies to greeting without dispatching workflow', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(reply.receiveId, 'chat-a');
    assert.match(JSON.parse(reply.content).text, /OpenClaw UI 自动化助手/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer logs Feishu timing stages for async chat replies', async () => {
  const logs = [];
  const originalLog = console.log;
  let reply;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
      FEISHU_ASSISTANT_NAME: 'Hermes',
      FEISHU_TIMING_LOG_ENABLED: 'true',
    },
    {
      chat: async () => '我是 Hermes，收到。',
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          header: {
            event_type: 'im.message.receive_v1',
          },
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '今天随便聊两句' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reply.receiveId, 'chat-a');

    const timingLogs = logs.filter((line) => line.includes('[Feishu timing]'));
    assert(timingLogs.some((line) => /stage=received\b/.test(line)));
    assert(timingLogs.some((line) => /stage=route\b/.test(line) && /agent=chat-agent\b/.test(line)));
    assert(timingLogs.some((line) => /stage=model:start\b/.test(line)));
    assert(timingLogs.some((line) => /stage=model:finish\b/.test(line)));
    assert(timingLogs.some((line) => /stage=send:start\b/.test(line)));
    assert(timingLogs.some((line) => /stage=send:finish\b/.test(line)));
    assert(timingLogs.some((line) => /stage=finish\b/.test(line)));
  } finally {
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group greeting without mention', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: '你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(reply, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer replies to group greeting when mentioned', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            mentions: [{ id: { open_id: 'bot-a' }, name: 'OpenClaw' }],
            content: JSON.stringify({ text: '@OpenClaw 你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(JSON.parse(reply.content).text, /OpenClaw UI 自动化助手/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer replies to greeting as Hermes on Hermes route', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      HERMES_FEISHU_APP_ID: 'cli_hermes',
      HERMES_FEISHU_APP_SECRET: 'secret_hermes',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = JSON.parse(reply.content).text;
    assert.match(text, /Hermes UI 自动化助手/);
    assert.doesNotMatch(text, /OpenClaw UI 自动化助手/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores Feishu message read events without replying', async () => {
  let reply;
  let chatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      chat: async () => {
        chatCalled = true;
        return '不应该处理已读事件';
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        header: {
          event_type: 'im.message.message_read_v1',
          event_id: 'read-event-a',
        },
        event: {
          reader: {
            reader_id: {
              open_id: 'user-a',
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(chatCalled, false);
    assert.equal(reply, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer prefers Feishu app id over URL route for bot identity', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_openclaw',
      FEISHU_APP_SECRET: 'secret_openclaw',
      HERMES_FEISHU_APP_ID: 'cli_hermes',
      HERMES_FEISHU_APP_SECRET: 'secret_hermes',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        header: {
          app_id: 'cli_openclaw',
        },
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = JSON.parse(reply.content).text;
    assert.match(text, /OpenClaw UI 自动化助手/);
    assert.doesNotMatch(text, /Hermes UI 自动化助手/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('runHermesChat prompts model with Hermes identity', async () => {
  let capturedArgs;
  await runHermesChat(
    '你是谁',
    {
      HERMES_BIN: 'hermes',
      HERMES_MODEL: 'astron-code-latest',
      HERMES_PROVIDER: 'custom',
    },
    (command, args, options, callback) => {
      capturedArgs = args;
      callback(null, '我是 Hermes UI 自动化助手。', '');
    },
  );

  const prompt = capturedArgs.at(-1);
  assert.match(prompt, /你是 Hermes UI 自动化助手/);
  assert.doesNotMatch(prompt, /你是 OpenClaw UI 自动化助手/);
});

test('createServer answers free chat without dispatching workflow', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => '我可以像助手一样回答问题，也可以触发 UI 自动化。',
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '这个项目现在完成到哪一步了' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.match(JSON.parse(reply.content).text, /像助手一样回答问题/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes doc questions without dispatching workflow or chat', async () => {
  let reply;
  let dispatchCalled = false;
  let chatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => {
        chatCalled = true;
        return '不应该走普通聊天';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '老师任务还差哪些' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(chatCalled, false);
    assert.match(JSON.parse(reply.content).text, /已完成/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer blocks unauthorized doc questions that include memory context', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-b',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '老师任务还差哪些' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    const text = JSON.parse(reply.content).text;
    assert.match(text, /未授权|绑定/);
    assert.doesNotMatch(text, /Memory Context|Project State|已完成的主线能力/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer blocks unauthorized ops commands without dispatching workflow or chat', async () => {
  let reply;
  let dispatchCalled = false;
  let chatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-b',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => {
        chatCalled = true;
        return '不应该走普通聊天';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(chatCalled, false);
    assert.match(JSON.parse(reply.content).text, /未授权|绑定/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer free chat prompt omits full memory by default', async () => {
  let capturedPrompt;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      receiptSender: async () => {},
      chat: async (prompt) => {
        capturedPrompt = prompt;
        return '普通聊天回复';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '今天适合先看哪块代码' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(capturedPrompt, /用户消息：今天适合先看哪块代码/);
    assert.doesNotMatch(capturedPrompt, /# Memory Context/);
    assert.doesNotMatch(capturedPrompt, /## User Profile/);
    assert.doesNotMatch(capturedPrompt, /## Project State/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer keeps chat-agent test failure questions out of workflow dispatch', async () => {
  let reply;
  let dispatchCalled = false;
  let chatCalled = false;
  let parserCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      parser: async () => {
        parserCalled = true;
        return { targetRef: 'main', runMode: 'smoke' };
      },
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => {
        chatCalled = true;
        return '先看失败截图和 Allure 报告。';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '测试失败怎么办' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(chatCalled, true);
    assert.equal(parserCalled, false);
    assert.equal(dispatchCalled, false);
    assert.match(JSON.parse(reply.content).text, /失败截图/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not dispatch negated run-ui-test command', async () => {
  let dispatchCalled = false;
  let parserCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      OPENCLAW_CHAT_ENABLED: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      parser: async () => {
        parserCalled = true;
        return { targetRef: 'main', runMode: 'smoke' };
      },
      receiptSender: async () => {},
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '不要 /run-ui-test main smoke' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(parserCalled, false);
    assert.equal(dispatchCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not dispatch trailing how-to run-ui-test command', async () => {
  let dispatchCalled = false;
  let parserCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      OPENCLAW_CHAT_ENABLED: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      parser: async () => {
        parserCalled = true;
        return { targetRef: 'main', runMode: 'smoke' };
      },
      receiptSender: async () => {},
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '请问 /run-ui-test main smoke 怎么用' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(parserCalled, false);
    assert.equal(dispatchCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not dispatch chat-agent messages when chat is disabled', async () => {
  let receiptCalled = false;
  let dispatchCalled = false;
  let parserCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      parser: async () => {
        parserCalled = true;
        return { targetRef: 'main', runMode: 'smoke' };
      },
      receiptSender: async () => {
        receiptCalled = true;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '测试失败怎么办' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receiptCalled, false);
    assert.equal(parserCalled, false);
    assert.equal(dispatchCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes doc questions in synchronous mode without dispatching workflow', async () => {
  let dispatchCalled = false;
  let parserCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      parser: async () => {
        parserCalled = true;
        return { targetRef: 'main', runMode: 'smoke' };
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '老师任务还差哪些' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(dispatchCalled, false);
    assert.equal(parserCalled, false);
    assert.match(body.message, /已完成/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer replies to explicit ops commands in passive group chats', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.match(JSON.parse(reply.content).text, /服务器状态摘要/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer uses local ops runner for direct status command in async mode', async () => {
  let reply;
  let receivedAction;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async (action) => {
        receivedAction = action;
        return {
          service: 'openclaw-feishu-bridge',
          active: 'active',
          health: '{"ok":true}',
          watchdog: 'active',
          commit: 'abc1234',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(receivedAction, 'status');
    assert.match(JSON.parse(reply.content).text, /openclaw-feishu-bridge/);
    assert.doesNotMatch(JSON.parse(reply.content).text, /not configured in local mode/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes natural-language memory query to local ops runner in async mode', async () => {
  let reply;
  let receivedAction;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async (action, route) => {
        receivedAction = `${action}:${route.target}:${route.confidence}`;
        return {
          service: 'openclaw-feishu-bridge',
          active: 'active',
          health: '{"ok":true}',
          watchdog: 'active',
          commit: 'abc1234',
          memory: { total: '8G', used: '3.1G', free: '4.9G' },
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你现在内存多少' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.equal(receivedAction, 'memory-summary:self:high');
    assert.match(JSON.parse(reply.content).text, /内存：8G 总量/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer appends status and elapsed footer to routed replies', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      FEISHU_REPLY_FOOTER_ELAPSED: 'true',
      FEISHU_REPLY_FOOTER_STATUS: 'true',
    },
    {
      runOpsCheck: async () => ({
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234',
        memory: { total: '8G', used: '3.1G', free: '4.9G' },
      }),
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你现在内存多少' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    const text = JSON.parse(reply.content).text;
    assert.match(text, /状态：完成/);
    assert.match(text, /耗时：/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not execute medium-confidence restart requests in async mode', async () => {
  let called = false;
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async () => {
        called = true;
        return {};
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '你重起一下' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.equal(called, false);
    assert.match(JSON.parse(reply.content).text, /你是想让我重启/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer uses built-in local ops runner when no custom ops hook is provided', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.match(JSON.parse(reply.content).text, /服务器状态摘要/);
    assert.doesNotMatch(JSON.parse(reply.content).text, /not configured in local mode/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes /exec commands to local ops runner in async mode', async () => {
  let reply;
  let received;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async (action, route) => {
        received = `${action}:${route.command}`;
        return {
          service: 'root-shell',
          active: 'ok',
          health: 'n/a',
          watchdog: 'manual',
          commit: 'n/a',
          operation: 'exec',
          detail: 'Filesystem      Size  Used Avail Use% Mounted on',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/exec df -h' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.equal(received, 'exec:df -h');
    assert.match(JSON.parse(reply.content).text, /Filesystem/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes /peer-exec commands to peer ops runner in async mode', async () => {
  let reply;
  let received;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async (action, route) => {
        received = `${action}:${route.command}`;
        return {
          service: 'Hermes',
          active: 'ok',
          health: 'n/a',
          watchdog: 'manual',
          commit: 'n/a',
          target: 'Hermes',
          operation: 'peer-exec',
          detail: 'total 8.0G used 3.1G avail 4.9G',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/peer-exec df -h' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.equal(received, 'peer-exec:df -h');
    assert.match(JSON.parse(reply.content).text, /4\.9G/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer maps natural-language peer disk summary to peer status runner', async () => {
  let reply;
  let receivedAction;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      runOpsCheck: async (action, route) => {
        receivedAction = `${action}:${route.action}:${route.target}`;
        return {
          service: 'hermes-feishu-bridge',
          active: 'active',
          health: '{"ok":true}',
          watchdog: 'peer-control',
          commit: 'abc1234',
          target: 'Hermes',
          operation: action,
          detail: 'peer status ok',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: 'Hermes 硬盘还剩多少' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply), { timeoutMs: 2000 });
    assert.equal(receivedAction, 'peer-status:peer-disk-summary:hermes');
    assert.match(JSON.parse(reply.content).text, /hermes-feishu-bridge/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group memory questions without mention', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: '项目状态' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(reply, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group doc automation questions without mention', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: 'GitHub Actions workflow 文档在哪' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(reply, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group how-to run-ui-test questions without mention', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: '请问 /run-ui-test main smoke 怎么用' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(reply, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group memory questions in synchronous mode', async () => {
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: '项目状态' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(dispatchCalled, false);
    assert.equal(body.ignored, true);
    assert.doesNotMatch(body.message, /Memory Context|Project State|当前记忆摘要/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer ignores passive group doc automation questions in synchronous mode', async () => {
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'false',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            chat_type: 'group',
            content: JSON.stringify({ text: 'GitHub Actions workflow 文档在哪' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(dispatchCalled, false);
    assert.equal(body.ignored, true);
    assert.doesNotMatch(body.message, /Memory Context|Project State|已完成的主线能力/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not invoke chat fallback when sending primary chat reply fails', async () => {
  let sendCount = 0;
  let hermesChatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      OPENCLAW_CHAT_ENABLED: 'true',
      HERMES_FALLBACK_ENABLED: 'true',
    },
    {
      receiptSender: async () => {
        sendCount += 1;
        throw new Error('send failed after accept');
      },
      chat: async () => '主模型回复',
      hermesChat: async () => {
        hermesChatCalled = true;
        return '不应该作为发送失败的 fallback';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '今天适合先看哪块代码' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(sendCount, 1);
    assert.equal(hermesChatCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not send duplicate ops fallback when sending ops reply fails', async () => {
  let sendCount = 0;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      receiptSender: async () => {
        sendCount += 1;
        throw new Error('send failed after accept');
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => sendCount === 1, { timeoutMs: 2000 });
    assert.equal(sendCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer falls back to Hermes chat when OpenClaw chat fails', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      OPENCLAW_CHAT_ENABLED: 'true',
      HERMES_FALLBACK_ENABLED: 'true',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => {
        throw new Error('OpenClaw chat unavailable');
      },
      hermesChat: async () => 'Hermes 已接管普通聊天。',
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '今天适合先看哪块代码' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(JSON.parse(reply.content).text, /Hermes 已接管/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer uses Hermes as primary chat on Hermes route', async () => {
  let reply;
  let openClawChatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      OPENCLAW_CHAT_ENABLED: 'true',
      HERMES_FALLBACK_ENABLED: 'true',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
      hermesChat: async () => 'OpenClaw fallback should not run here',
      chat: async () => {
        openClawChatCalled = true;
        return 'Hermes 主机器人回复。';
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '今天适合先看哪块代码' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(openClawChatCalled, true);
    assert.match(JSON.parse(reply.content).text, /Hermes 主机器人/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer binds current sender before enforcing allowlist', async () => {
  let reply;
  const env = {
    GITHUB_TOKEN: 'ghp_example',
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_RESULT_NOTIFY_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_xxx',
    FEISHU_APP_SECRET: 'secret_xxx',
  };
  const server = createServer(
    env,
    {
      receiptSender: async (message) => {
        reply = message;
      },
      allowlistBinder: async (senderId) => {
        env.FEISHU_ALLOWED_USER_IDS = senderId;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '绑定我' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.FEISHU_ALLOWED_USER_IDS, 'user-a');
    assert.match(JSON.parse(reply.content).text, /已绑定/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer does not let a second sender overwrite binding', async () => {
  let reply;
  let binderCalled = false;
  const env = {
    GITHUB_TOKEN: 'ghp_example',
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_RESULT_NOTIFY_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_xxx',
    FEISHU_APP_SECRET: 'secret_xxx',
    FEISHU_ALLOWED_USER_IDS: 'user-a',
  };
  const server = createServer(
    env,
    {
      receiptSender: async (message) => {
        reply = message;
      },
      allowlistBinder: async () => {
        binderCalled = true;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-b',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '绑定我' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(binderCalled, false);
    assert.equal(env.FEISHU_ALLOWED_USER_IDS, 'user-a');
    assert.match(JSON.parse(reply.content).text, /没有权限覆盖/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer binds Hermes sender to separate Hermes allowlist', async () => {
  let reply;
  let boundKey;
  const env = {
    GITHUB_TOKEN: 'ghp_example',
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_RESULT_NOTIFY_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_openclaw',
    FEISHU_APP_SECRET: 'secret_openclaw',
    FEISHU_ALLOWED_USER_IDS: 'openclaw-user',
    HERMES_FEISHU_APP_ID: 'cli_hermes',
    HERMES_FEISHU_APP_SECRET: 'secret_hermes',
  };
  const server = createServer(
    env,
    {
      receiptSender: async (message) => {
        reply = message;
      },
      allowlistBinder: async (senderId, routeEnv, allowlistKey) => {
        boundKey = allowlistKey;
        env[allowlistKey] = senderId;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        header: {
          app_id: 'cli_hermes',
        },
        event: {
          sender: {
            sender_id: {
              open_id: 'hermes-user',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '绑定我' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(boundKey, 'HERMES_FEISHU_ALLOWED_USER_IDS');
    assert.equal(env.HERMES_FEISHU_ALLOWED_USER_IDS, 'hermes-user');
    assert.equal(env.FEISHU_ALLOWED_USER_IDS, 'openclaw-user');
    assert.match(JSON.parse(reply.content).text, /已绑定/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer persists Hermes binding into process env for later requests', async () => {
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    FEISHU_WEBHOOK_ASYNC: process.env.FEISHU_WEBHOOK_ASYNC,
    FEISHU_RESULT_NOTIFY_ENABLED: process.env.FEISHU_RESULT_NOTIFY_ENABLED,
    FEISHU_REQUIRE_BINDING: process.env.FEISHU_REQUIRE_BINDING,
    FEISHU_APP_ID: process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
    FEISHU_ALLOWED_USER_IDS: process.env.FEISHU_ALLOWED_USER_IDS,
    HERMES_FEISHU_APP_ID: process.env.HERMES_FEISHU_APP_ID,
    HERMES_FEISHU_APP_SECRET: process.env.HERMES_FEISHU_APP_SECRET,
    HERMES_FEISHU_ALLOWED_USER_IDS: process.env.HERMES_FEISHU_ALLOWED_USER_IDS,
    FEISHU_ENV_FILE: process.env.FEISHU_ENV_FILE,
  };
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaw-feishu-test-'));
  const envFile = join(tempDir, 'bridge.env');
  writeFileSync(envFile, 'FEISHU_ALLOWED_USER_IDS=openclaw-user\n', 'utf8');

  Object.assign(process.env, {
    GITHUB_TOKEN: 'ghp_example',
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_RESULT_NOTIFY_ENABLED: 'true',
    FEISHU_REQUIRE_BINDING: 'true',
    FEISHU_APP_ID: 'cli_openclaw',
    FEISHU_APP_SECRET: 'secret_openclaw',
    FEISHU_ALLOWED_USER_IDS: 'openclaw-user',
    HERMES_FEISHU_APP_ID: 'cli_hermes',
    HERMES_FEISHU_APP_SECRET: 'secret_hermes',
    FEISHU_ENV_FILE: envFile,
  });
  delete process.env.HERMES_FEISHU_ALLOWED_USER_IDS;

  let bindReply;
  let automationReply;
  let dispatchCalled = false;
  const server = createServer(
    process.env,
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        const text = JSON.parse(message.content).text;
        if (/已绑定/.test(text)) {
          bindReply = message;
        } else {
          automationReply = message;
        }
      },
      scheduler: async () => {},
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const payloadBase = {
      header: {
        app_id: 'cli_hermes',
      },
      event: {
        sender: {
          sender_id: {
            open_id: 'hermes-user',
          },
        },
        message: {
          chat_id: 'chat-a',
        },
      },
    };

    const bindResponse = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payloadBase,
        event: {
          ...payloadBase.event,
          message: {
            ...payloadBase.event.message,
            message_id: 'message-bind',
            content: JSON.stringify({ text: '绑定我' }),
          },
        },
      }),
    });

    assert.equal(bindResponse.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(JSON.parse(bindReply.content).text, /已绑定/);
    assert.equal(process.env.HERMES_FEISHU_ALLOWED_USER_IDS, 'hermes-user');
    assert.match(readFileSync(envFile, 'utf8'), /HERMES_FEISHU_ALLOWED_USER_IDS=hermes-user/);

    const runResponse = await fetch(`http://127.0.0.1:${port}/webhook/feishu/hermes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payloadBase,
        event: {
          ...payloadBase.event,
          message: {
            ...payloadBase.event.message,
            message_id: 'message-run',
            content: JSON.stringify({ text: '/run-ui-test main smoke' }),
          },
        },
      }),
    });

    assert.equal(runResponse.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, true);
    assert.doesNotMatch(JSON.parse(automationReply.content).text, /还没有绑定/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('createServer requires binding before automation when configured', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_REQUIRE_BINDING: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
        return {
          actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
        };
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          sender: {
            sender_id: {
              open_id: 'user-a',
            },
          },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/run-ui-test main smoke' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.match(JSON.parse(reply.content).text, /绑定我/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('handleFeishuWebhook rejects unauthorized sender when allowlist is configured', async () => {
  const response = await handleFeishuWebhook(
    {
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          content: JSON.stringify({ text: '/run-ui-test main' }),
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-b',
      GITHUB_TOKEN: 'ghp_example',
    },
    async () => {
      throw new Error('dispatch should not be called');
    },
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
});

test('handleFeishuWebhook dispatches GitHub workflow for valid command', async () => {
  let dispatchedConfig;
  const response = await handleFeishuWebhook(
    {
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          content: JSON.stringify({ text: '/run-ui-test release smoke' }),
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      GITHUB_TOKEN: 'ghp_example',
    },
    async (config) => {
      dispatchedConfig = config;
      return {
        actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
      };
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(dispatchedConfig.inputs.target_ref, 'release');
  assert.equal(dispatchedConfig.inputs.run_mode, 'smoke');
  assert.match(response.body.message, /UI 自动化测试已触发/);
});

test('handleFeishuWebhook can use OpenClaw parser for natural language command', async () => {
  let parserInput;
  let dispatchedConfig;

  const response = await handleFeishuWebhook(
    {
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          content: JSON.stringify({ text: '帮我跑一下 main 分支的 UI 自动化冒烟测试' }),
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      GITHUB_TOKEN: 'ghp_example',
      OPENCLAW_PARSE_ENABLED: 'true',
    },
    async (config) => {
      dispatchedConfig = config;
      return {
        actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
      };
    },
    async (text) => {
      parserInput = text;
      return {
        targetRef: 'main',
        runMode: 'smoke',
      };
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.commandSource, 'openclaw');
  assert.equal(parserInput, '帮我跑一下 main 分支的 UI 自动化冒烟测试');
  assert.equal(dispatchedConfig.inputs.target_ref, 'main');
  assert.equal(dispatchedConfig.inputs.run_mode, 'smoke');
});

test('handleFeishuWebhook falls back to Hermes parser when OpenClaw parser fails', async () => {
  let dispatchedConfig;

  const response = await handleFeishuWebhook(
    {
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          content: JSON.stringify({ text: '帮我跑一下 main 分支的 UI 自动化冒烟测试' }),
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      GITHUB_TOKEN: 'ghp_example',
      OPENCLAW_PARSE_ENABLED: 'true',
      HERMES_FALLBACK_ENABLED: 'true',
    },
    async (config) => {
      dispatchedConfig = config;
      return {
        actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
      };
    },
    async () => {
      throw new Error('OpenClaw unavailable');
    },
    undefined,
    async () => ({
      targetRef: 'main',
      runMode: 'smoke',
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.commandSource, 'hermes');
  assert.equal(dispatchedConfig.inputs.run_mode, 'smoke');
});

test('handleFeishuWebhook schedules Feishu result notification when configured', async () => {
  let scheduled;
  const response = await handleFeishuWebhook(
    {
      event: {
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
        message: {
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '/run-ui-test main contracts' }),
        },
      },
    },
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
    },
    async () => ({
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml',
      run: {
        id: 123,
        status: 'queued',
        html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
      },
    }),
    undefined,
    async (job) => {
      scheduled = job;
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflowRunUrl, 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123');
  assert.equal(scheduled.run.id, 123);
  assert.equal(scheduled.message.receiveIdType, 'chat_id');
  assert.equal(scheduled.message.receiveId, 'chat-a');
});

test('runOpenClawParser uses OpenClaw node entry on Windows when OPENCLAW_BIN is not set', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  let invokedCommand;
  let invokedArgs;
  const result = await runOpenClawParser(
    '帮我跑一下 main 分支的 UI 自动化冒烟测试',
    {
      APPDATA: process.env.APPDATA,
      OPENCLAW_MODEL: 'xfyun/astron-code-latest',
    },
    (command, args, options, callback) => {
      invokedCommand = command;
      invokedArgs = args;
      callback(null, '{"intent":"run-ui-test","targetRef":"main","runMode":"smoke"}', '');
    },
  );

  assert.equal(invokedCommand, process.execPath);
  assert.match(invokedArgs[0], /openclaw\.mjs$/);
  assert.deepEqual(result, {
    targetRef: 'main',
    runMode: 'smoke',
  });
});

test('runOpenClawChat serializes CLI calls to avoid session lock contention', async () => {
  const started = [];
  const finishers = [];

  const first = runOpenClawChat(
    '第一条消息',
    {
      OPENCLAW_BIN: 'openclaw',
      OPENCLAW_CHAT_TIMEOUT_MS: '1000',
    },
    (command, args, options, callback) => {
      started.push(args.at(-1));
      finishers.push(() => callback(null, '第一条回复', ''));
    },
  );

  const second = runOpenClawChat(
    '第二条消息',
    {
      OPENCLAW_BIN: 'openclaw',
      OPENCLAW_CHAT_TIMEOUT_MS: '1000',
    },
    (command, args, options, callback) => {
      started.push(args.at(-1));
      finishers.push(() => callback(null, '第二条回复', ''));
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started.length, 1);

  finishers[0]();
  assert.equal(await first, '第一条回复');

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started.length, 2);

  finishers[1]();
  assert.equal(await second, '第二条回复');
});

test('createServer ignores async Feishu payloads without a reply target', async () => {
  let receiptCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      receiptSender: async () => {
        receiptCalled = true;
      },
      chat: async () => '不应该回复',
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          message: {
            content: JSON.stringify({ text: '你好' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receiptCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

