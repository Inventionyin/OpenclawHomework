const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildInboxNotificationText,
  buildNotificationTarget,
  fetchMessagesWithMailCli,
  filterNewMessages,
  parseMailCliJson,
  parseCliArgs,
  runInboxNotifierOnce,
} = require('../scripts/clawemail-inbox-notifier');

test('filterNewMessages skips old messages and advances state', () => {
  const result = filterNewMessages([
    { uid: 9, from: 'old@example.com', subject: 'old' },
    { uid: 10, from: 'seen@example.com', subject: 'seen' },
    { uid: 11, from: 'new@example.com', subject: 'new' },
  ], { lastUid: 10 });

  assert.deepEqual(result.newMessages.map((message) => message.uid), [11]);
  assert.equal(result.nextState.lastUid, 11);
});

test('filterNewMessages bootstraps without notifying existing mailbox history', () => {
  const result = filterNewMessages([
    { uid: 5, from: 'old@example.com', subject: 'old' },
    { uid: 6, from: 'latest@example.com', subject: 'latest' },
  ], {});

  assert.deepEqual(result.newMessages, []);
  assert.equal(result.nextState.lastUid, 6);
});

test('filterNewMessages supports ClawEmail string message ids', () => {
  const first = filterNewMessages([
    { uid: '56:old', from: 'old@example.com', subject: 'old' },
  ], {});

  assert.deepEqual(first.newMessages, []);
  assert.deepEqual(first.nextState.seenMessageIds, ['56:old']);

  const second = filterNewMessages([
    { uid: '57:new', from: 'new@example.com', subject: 'new' },
    { uid: '56:old', from: 'old@example.com', subject: 'old' },
  ], first.nextState);

  assert.deepEqual(second.newMessages.map((message) => message.uid), ['57:new']);
  assert.deepEqual(second.nextState.seenMessageIds, ['57:new', '56:old']);
});

test('buildInboxNotificationText summarizes safe mail fields', () => {
  const text = buildInboxNotificationText({
    mailbox: 'shine1@claw.163.com',
    from: 'student@example.com',
    subject: '应届生求职咨询',
    date: '2026-05-06T12:00:00.000Z',
    text: '你好，我是一名大四应届毕业生，可以应聘测试岗位吗？'.repeat(20),
  }, { assistantName: 'Hermes' });

  assert.match(text, /Hermes 收到新邮件/);
  assert.match(text, /shine1@claw\.163\.com/);
  assert.match(text, /student@example\.com/);
  assert.match(text, /应届生求职咨询/);
  assert.match(text, /可以应聘测试岗位吗/);
  assert.doesNotMatch(text, /password|secret|token/i);
  assert.ok(text.length < 1200);
});

test('buildNotificationTarget uses explicit receive id before allowed user fallback', () => {
  assert.deepEqual(buildNotificationTarget({
    CLAWEMAIL_NOTIFY_RECEIVE_ID: 'chat-a',
    CLAWEMAIL_NOTIFY_RECEIVE_ID_TYPE: 'chat_id',
    FEISHU_ALLOWED_USER_IDS: 'user-a,user-b',
  }), {
    receiveId: 'chat-a',
    receiveIdType: 'chat_id',
  });

  assert.deepEqual(buildNotificationTarget({
    HERMES_FEISHU_ALLOWED_USER_IDS: 'user-a,user-b',
  }), {
    receiveId: 'user-a',
    receiveIdType: 'open_id',
  });
});

test('parseCliArgs supports once mode and env file override', () => {
  const config = parseCliArgs([
    '--once',
    '--env-file',
    '/etc/hermes-feishu-bridge.env',
    '--state-file',
    '/tmp/inbox-state.json',
    '--interval-ms',
    '5000',
  ], {});

  assert.equal(config.once, true);
  assert.equal(config.envFile, '/etc/hermes-feishu-bridge.env');
  assert.equal(config.stateFile, '/tmp/inbox-state.json');
  assert.equal(config.intervalMs, 5000);
});

test('parseMailCliJson reads success data response', () => {
  assert.deepEqual(parseMailCliJson(JSON.stringify({
    success: true,
    data: [
      {
        id: '101',
        from: 'student@example.com',
        subject: '应届生求职咨询',
        date: '2026-05-06T12:00:00.000Z',
        snippet: '可以应聘吗？',
      },
    ],
  })), [
    {
      id: '101',
      from: 'student@example.com',
      subject: '应届生求职咨询',
      date: '2026-05-06T12:00:00.000Z',
      snippet: '可以应聘吗？',
    },
  ]);
});

test('fetchMessagesWithMailCli uses real mail-cli json list arguments', async () => {
  const calls = [];
  const messages = await fetchMessagesWithMailCli({
    inboxFid: '1',
    limit: 5,
    mailbox: 'shine1@claw.163.com',
  }, {
    CLAWEMAIL_MAIL_CLI_BIN: 'mail-cli',
  }, {
    execFile: (command, args, options, callback) => {
      calls.push({ command, args });
      callback(null, JSON.stringify({
        success: true,
        data: [{
          id: '101',
          from: 'student@example.com',
          subject: '应届生求职咨询',
          receivedAt: '2026-05-06T12:00:00.000Z',
          snippet: '可以应聘吗？',
        }],
      }), '');
    },
  });

  assert.equal(calls[0].command, 'mail-cli');
  assert.deepEqual(calls[0].args, ['--json', 'mail', 'list', '--fid', '1', '--desc', '--limit', '5']);
  assert.deepEqual(messages, [{
    uid: '101',
    mailbox: 'shine1@claw.163.com',
    from: 'student@example.com',
    subject: '应届生求职咨询',
    date: '2026-05-06T12:00:00.000Z',
    text: '可以应聘吗？',
    html: '',
  }]);
});

test('fetchMessagesWithMailCli enriches message body when enabled', async () => {
  const calls = [];
  const messages = await fetchMessagesWithMailCli({
    inboxFid: '1',
    limit: 1,
    readBody: true,
  }, {}, {
    execFile: (command, args, options, callback) => {
      calls.push(args);
      if (args.includes('read')) {
        callback(null, JSON.stringify({
          success: true,
          data: {
            text: {
              content: '你好，我是一名大四应届毕业生，可以应聘吗？',
            },
          },
        }), '');
        return;
      }
      callback(null, JSON.stringify({
        success: true,
        data: [{
          id: '56:abc',
          from: 'student@example.com',
          subject: '应届生求职咨询',
          date: '2026-05-06 13:32:32',
        }],
      }), '');
    },
  });

  assert.deepEqual(calls, [
    ['--json', 'mail', 'list', '--fid', '1', '--desc', '--limit', '1'],
    ['--json', 'read', 'body', '--id', '56:abc'],
  ]);
  assert.equal(messages[0].text, '你好，我是一名大四应届毕业生，可以应聘吗？');
});

test('runInboxNotifierOnce sends Feishu notification for new messages and writes state', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'clawemail-inbox-test-'));
  const stateFile = join(tempDir, 'state.json');
  const sent = [];

  try {
    const summary = await runInboxNotifierOnce({
      stateFile,
      mailbox: 'shine1@claw.163.com',
    }, {
      CLAWEMAIL_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      CLAWEMAIL_NOTIFY_RECEIVE_ID: 'chat-a',
      CLAWEMAIL_NOTIFY_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_ASSISTANT_NAME: 'Hermes',
    }, {
      fetchMessages: async () => [
        {
          uid: 1,
          mailbox: 'shine1@claw.163.com',
          from: 'student@example.com',
          subject: '应届生求职咨询',
          date: '2026-05-06T12:00:00.000Z',
          text: '我是一名大四应届毕业生，可以应聘测试岗位吗？',
        },
      ],
      sendFeishuTextMessage: async (env, message) => {
        sent.push({ env, message });
      },
    });

    assert.equal(summary.status, 'ok');
    assert.equal(summary.fetched, 1);
    assert.equal(summary.notified, 0);
    assert.deepEqual(sent, []);

    const second = await runInboxNotifierOnce({
      stateFile,
      mailbox: 'shine1@claw.163.com',
    }, {
      CLAWEMAIL_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      CLAWEMAIL_NOTIFY_RECEIVE_ID: 'chat-a',
      CLAWEMAIL_NOTIFY_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_ASSISTANT_NAME: 'Hermes',
    }, {
      fetchMessages: async () => [
        {
          uid: 2,
          mailbox: 'shine1@claw.163.com',
          from: 'student@example.com',
          subject: '应届生求职咨询',
          date: '2026-05-06T12:01:00.000Z',
          text: '我补充一下，我会 UI 自动化和 Allure 报告。',
        },
      ],
      sendFeishuTextMessage: async (env, message) => {
        sent.push({ env, message });
      },
    });

    assert.equal(second.notified, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.receiveIdType, 'chat_id');
    assert.equal(sent[0].message.receiveId, 'chat-a');
    assert.match(JSON.parse(sent[0].message.content).text, /Hermes 收到新邮件/);
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).lastUid, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
