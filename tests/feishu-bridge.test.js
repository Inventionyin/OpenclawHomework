const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractFeishuText,
  handleFeishuWebhook,
  parseOpenClawCommandOutput,
  parseRunUiTestCommand,
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

test('handleFeishuWebhook responds to Feishu challenge', async () => {
  const response = await handleFeishuWebhook({ challenge: 'abc123' }, {}, async () => {
    throw new Error('dispatch should not be called');
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { challenge: 'abc123' });
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
