const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractFeishuText,
  handleFeishuWebhook,
  parseRunUiTestCommand,
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

