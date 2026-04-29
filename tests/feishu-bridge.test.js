const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFeishuResultCard,
  buildFeishuTextMessage,
  createServer,
  extractFeishuText,
  handleFeishuWebhook,
  parseOpenClawCommandOutput,
  parseRunUiTestCommand,
  parseSmallTalkMessage,
  buildRunArtifactsUrl,
  parseOpenClawChatOutput,
  runOpenClawChat,
  sendFeishuTextMessage,
  runOpenClawParser,
} = require('../scripts/feishu-bridge');

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
  assert.equal(
    parseSmallTalkMessage('你好'),
    '你好，我是 OpenClaw UI 自动化助手。你可以发：帮我跑一下 main 分支的 UI 自动化冒烟测试',
  );
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

    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.message, '飞书指令已收到，正在后台触发 UI 自动化测试');

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchStarted, true);
    finishDispatch();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(receipt.receiveIdType, 'chat_id');
    assert.equal(receipt.receiveId, 'chat-a');
    assert.match(JSON.parse(receipt.content).text, /已收到/);
    finishDispatch();
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

    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.equal(reply.receiveId, 'chat-a');
    assert.match(JSON.parse(reply.content).text, /OpenClaw UI 自动化助手/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatchCalled, false);
    assert.match(JSON.parse(reply.content).text, /像助手一样回答问题/);
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

    assert.equal(response.status, 202);
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

    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(binderCalled, false);
    assert.equal(env.FEISHU_ALLOWED_USER_IDS, 'user-a');
    assert.match(JSON.parse(reply.content).text, /没有权限覆盖/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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

    assert.equal(response.status, 202);
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
