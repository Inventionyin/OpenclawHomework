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
  notifyUiMailboxActions,
  sendEmailRunResultNotification,
  sendDailySummaryNotification,
  notifyFeishuRunResult,
  runOpenClawParser,
  runWebhookInBackground,
  sendFeishuMessageUpdate,
  downloadFeishuMessageImage,
  extractFeishuImageKeys,
  rememberFeishuImage,
  uploadFeishuImage,
  buildRoutedAgentReply,
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
  assert.match(reply, /哪些东西占硬盘/);
  assert.match(reply, /重启你自己/);
});

test('parseSmallTalkMessage help includes categorized natural-language examples', () => {
  const reply = parseSmallTalkMessage('帮助');
  assert.match(reply, /看我自己/);
  assert.match(reply, /硬盘清理/);
  assert.match(reply, /看对方/);
  assert.match(reply, /修复 OpenClaw/);
});

test('parseSmallTalkMessage supports capability discovery phrases', () => {
  const reply = parseSmallTalkMessage('你会做什么');
  assert.match(reply, /UI 自动化/);
  assert.match(reply, /服务器/);
  assert.match(reply, /记忆/);
  assert.match(reply, /邮箱/);
  assert.match(reply, /GBrain|Obsidian/);
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

test('runLocalOpsAction audits disk cleanup candidates without deleting', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'disk-audit-state-'));
  const calls = [];
  try {
    const result = await runLocalOpsAction('disk-audit', {
      WATCHDOG_SERVICE: 'openclaw-feishu-bridge',
      LOCAL_PROJECT_DIR: '/tmp/project',
      PORT: '8788',
      DISK_AUDIT_STATE_FILE: join(tempDir, 'state.json'),
    }, {
      execFile: (command, args, options, callback) => {
        calls.push([command, args]);
        const joined = [command, ...(args || [])].join(' ');
        let stdout = '';
        if (command === 'systemctl') stdout = 'active\n';
        else if (command === 'git') stdout = 'abc1234\n';
        else if (joined.includes('df -h')) stdout = 'overlay 40G 36G 4G 90% /';
        else if (joined.includes('du -sh')) stdout = [
          '9.5G\t/opt/khoj',
          '1.2G\t/root/.npm',
          '800M\t/var/log',
        ].join('\n');
        callback(null, stdout, '');
      },
      fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
    });

    assert.equal(result.audit.candidates[0].name, 'khoj');
    assert.equal(result.audit.candidates[0].id, 1);
    assert.equal(result.audit.candidates[0].path, '/opt/khoj');
    assert.equal(result.audit.candidates[1].name, 'npm-cache');
    assert.equal(result.audit.candidates[1].id, 2);
    assert.equal(result.audit.candidates[2].id, 3);
    assert.equal(calls.some(([command, args]) => command === 'bash' && args.join(' ').includes('rm -rf')), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runLocalOpsAction cleans only a candidate saved by previous disk audit', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'disk-cleanup-state-'));
  const stateFile = join(tempDir, 'state.json');
  const calls = [];
  const env = {
    WATCHDOG_SERVICE: 'openclaw-feishu-bridge',
    LOCAL_PROJECT_DIR: '/tmp/project',
    PORT: '8788',
    DISK_AUDIT_STATE_FILE: stateFile,
  };

  try {
    await runLocalOpsAction('disk-audit', env, {
      execFile: (command, args, options, callback) => {
        const joined = [command, ...(args || [])].join(' ');
        let stdout = '';
        if (command === 'systemctl') stdout = 'active\n';
        else if (command === 'git') stdout = 'abc1234\n';
        else if (joined.includes('df -h')) stdout = 'overlay 40G 36G 4G 90% /';
        else if (joined.includes('du -sh')) stdout = '9.5G\t/opt/khoj\n';
        callback(null, stdout, '');
      },
      fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
    });

    const result = await runLocalOpsAction('cleanup-confirm', env, {
      route: { selection: 1 },
      execFile: (command, args, options, callback) => {
        calls.push([command, args]);
        const joined = [command, ...(args || [])].join(' ');
        let stdout = '';
        if (command === 'systemctl') stdout = 'active\n';
        else if (command === 'git') stdout = 'abc1234\n';
        else if (joined.includes('df -h') && calls.filter(([cmd, callArgs]) => cmd === 'bash' && callArgs.join(' ').includes('df -h')).length > 1) stdout = 'overlay 40G 27G 13G 68% /';
        else if (joined.includes('df -h')) stdout = 'overlay 40G 36G 4G 90% /';
        else if (joined.includes('rm -rf -- /opt/khoj')) stdout = '';
        callback(null, stdout, '');
      },
      fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
    });

    assert.equal(result.cleaned.name, 'khoj');
    assert.equal(result.cleaned.path, '/opt/khoj');
    assert.equal(result.cleaned.beforeAvailable, '4G');
    assert.equal(result.cleaned.afterAvailable, '13G');
    assert.equal(calls.some(([command, args]) => command === 'bash' && args.join(' ').includes('rm -rf -- /opt/khoj')), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test('extractFeishuImageKeys supports image and post message content', () => {
  assert.deepEqual(extractFeishuImageKeys({
    event: {
      message: {
        msg_type: 'image',
        content: JSON.stringify({ image_key: 'img_v3_photo' }),
      },
    },
  }), ['img_v3_photo']);

  assert.deepEqual(extractFeishuImageKeys({
    event: {
      message: {
        msg_type: 'post',
        content: JSON.stringify({
          content: [[
            { tag: 'text', text: '修复' },
            { tag: 'img', image_key: 'img_v3_post' },
          ]],
        }),
      },
    },
  }), ['img_v3_post']);
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

test('sendEmailRunResultNotification can use evanshine report SMTP profile', async () => {
  const transports = [];

  const result = await sendEmailRunResultNotification(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
      targetRef: 'main',
      runMode: 'contracts',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      SMTP_HOST: 'smtp.default.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'default@example.com',
      SMTP_PASS: 'default-password',
      EMAIL_FROM: 'default@example.com',
      EMAIL_TO: 'a@example.com',
      REPORT_SMTP_HOST: 'smtp.evanshine.me',
      REPORT_SMTP_PORT: '587',
      REPORT_SMTP_SECURE: 'false',
      REPORT_SMTP_USER: 'report@evanshine.me',
      REPORT_SMTP_PASS: 'report-password',
      REPORT_EMAIL_FROM: 'report@evanshine.me',
      MAIL_ACTION_PROVIDER_OVERRIDES: 'report=evanshine',
    },
    {
      createTransport: (config) => ({
        sendMail: async (mail) => {
          transports.push({
            host: config.host,
            port: config.port,
            secure: config.secure,
            user: config.auth.user,
            from: mail.from,
            to: mail.to,
          });
          return { messageId: 'message-2' };
        },
      }),
    },
  );

  assert.equal(result.sent, true);
  assert.equal(transports.length, 1);
  assert.equal(transports[0].host, 'smtp.evanshine.me');
  assert.equal(transports[0].port, 587);
  assert.equal(transports[0].secure, false);
  assert.equal(transports[0].user, 'report@evanshine.me');
  assert.equal(transports[0].from, 'report@evanshine.me');
  assert.deepEqual(transports[0].to, ['a@example.com']);
});

test('notifyUiMailboxActions uses evanshine SMTP profile for report action when configured', async () => {
  const transports = [];

  await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
      targetRef: 'main',
      runMode: 'smoke',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      SMTP_HOST: 'smtp.default.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'default@example.com',
      SMTP_PASS: 'default-password',
      EMAIL_FROM: 'default@example.com',
      REPORT_SMTP_HOST: 'smtp.evanshine.me',
      REPORT_SMTP_PORT: '587',
      REPORT_SMTP_SECURE: 'false',
      REPORT_SMTP_USER: 'report@evanshine.me',
      REPORT_SMTP_PASS: 'report-password',
      REPORT_EMAIL_FROM: 'report@evanshine.me',
      MAIL_ACTION_PROVIDER_OVERRIDES: 'report=evanshine,daily=evanshine',
    },
    {
      createTransport: (config) => ({
        sendMail: async (mail) => {
          transports.push({
            host: config.host,
            port: config.port,
            secure: config.secure,
            user: config.auth.user,
            from: mail.from,
            to: mail.to,
            subject: mail.subject,
          });
          return { messageId: `${config.host}-${mail.subject}` };
        },
      }),
    },
  );

  assert.equal(transports.length, 2);
  assert.equal(transports[0].host, 'smtp.evanshine.me');
  assert.equal(transports[0].port, 587);
  assert.equal(transports[0].secure, false);
  assert.equal(transports[0].user, 'report@evanshine.me');
  assert.equal(transports[0].from, 'report@evanshine.me');
  assert.deepEqual(transports[0].to, ['watchee.report@claw.163.com']);
  assert.equal(transports[1].host, 'smtp.default.example.com');
  assert.equal(transports[1].from, 'default@example.com');
  assert.deepEqual(transports[1].to, ['agent3.files@claw.163.com']);
});

test('notifyUiMailboxActions falls back to default SMTP when evanshine report profile fails', async () => {
  const transports = [];

  await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/456',
      targetRef: 'main',
      runMode: 'contracts',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/456',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      SMTP_HOST: 'smtp.default.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'default@example.com',
      SMTP_PASS: 'default-password',
      EMAIL_FROM: 'default@example.com',
      REPORT_SMTP_HOST: 'smtp.evanshine.me',
      REPORT_SMTP_PORT: '587',
      REPORT_SMTP_SECURE: 'false',
      REPORT_SMTP_USER: 'report@evanshine.me',
      REPORT_SMTP_PASS: 'report-password',
      REPORT_EMAIL_FROM: 'report@evanshine.me',
      MAIL_ACTION_PROVIDER_OVERRIDES: 'report=evanshine',
    },
    {
      createTransport: (config) => ({
        sendMail: async (mail) => {
          transports.push({
            host: config.host,
            user: config.auth.user,
            from: mail.from,
            to: mail.to,
            subject: mail.subject,
          });
          if (config.host === 'smtp.evanshine.me') {
            throw new Error('evanshine down');
          }
          return { messageId: `${config.host}-${mail.subject}` };
        },
      }),
    },
  );

  assert.equal(transports.length, 3);
  assert.equal(transports[0].host, 'smtp.evanshine.me');
  assert.equal(transports[1].host, 'smtp.default.example.com');
  assert.equal(transports[1].from, 'default@example.com');
  assert.deepEqual(transports[1].to, ['watchee.report@claw.163.com']);
  assert.equal(transports[2].host, 'smtp.default.example.com');
  assert.deepEqual(transports[2].to, ['agent3.files@claw.163.com']);
});

test('notifyUiMailboxActions sends report only for successful UI result', async () => {
  const sent = [];

  const messages = await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
      targetRef: 'main',
      runMode: 'smoke',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.deepEqual(messages.map((item) => item.action), ['report', 'files']);
  assert.deepEqual(sent.map((item) => item.action), ['report', 'files']);
  assert.equal(sent[0].to[0], 'watchee.report@claw.163.com');
  assert.equal(sent[1].to[0], 'agent3.files@claw.163.com');
});

test('notifyUiMailboxActions sends report replay and files for failed UI result', async () => {
  const sent = [];

  const messages = await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/456',
      targetRef: 'main',
      runMode: 'contracts',
    },
    {
      conclusion: 'failure',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/456',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.deepEqual(messages.map((item) => item.action), ['report', 'replay', 'files']);
  assert.deepEqual(sent.map((item) => item.action), ['report', 'replay', 'files']);
  assert.equal(sent[1].to[0], 'evasan.replay@claw.163.com');
  assert.equal(sent[2].to[0], 'agent3.files@claw.163.com');
});

test('notifyUiMailboxActions sends explicit account business mailbox when requested', async () => {
  const sent = [];

  const messages = await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/789',
      targetRef: 'main',
      runMode: 'contracts',
      mailboxAction: 'account',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/789',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.deepEqual(messages.map((item) => item.action), ['report', 'files', 'account']);
  assert.equal(sent[2].to[0], 'evasan.account@claw.163.com');
  assert.match(sent[2].subject, /account/i);
});

test('notifyUiMailboxActions sends explicit support business mailbox when requested', async () => {
  const sent = [];

  const messages = await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/790',
      targetRef: 'main',
      runMode: 'smoke',
      config: {
        inputs: {
          mailbox_action: 'support',
        },
      },
    },
    {
      conclusion: 'failure',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/790',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.deepEqual(messages.map((item) => item.action), ['report', 'replay', 'files', 'support']);
  assert.equal(sent[3].to[0], 'agent4.support@claw.163.com');
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
    emailSender: async (message) => {
      emailJobs.push(message);
      return { sent: true };
    },
  });

  assert.equal(result, completedRun);
  assert.equal(feishuMessages.length, 1);
  assert.equal(emailJobs.length, 2);
  assert.equal(emailJobs[0].action, 'report');
  assert.equal(emailJobs[0].to[0], 'watchee.report@claw.163.com');
  assert.equal(emailJobs[1].action, 'files');
  assert.equal(emailJobs[1].to[0], 'agent3.files@claw.163.com');
});

test('sendDailySummaryNotification routes message to daily mailbox action', async () => {
  const sent = [];

  await sendDailySummaryNotification(
    [{ conclusion: 'success', runUrl: 'https://example.com/run' }],
    {
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'daily');
  assert.equal(sent[0].to[0], 'agent4.daily@claw.163.com');
  assert.match(sent[0].subject, /Daily Summary/);
});

test('sendDailySummaryNotification can use evanshine SMTP profile for daily action', async () => {
  const transports = [];

  await sendDailySummaryNotification(
    [{ conclusion: 'success', runUrl: 'https://example.com/run' }],
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      SMTP_HOST: 'smtp.default.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'default@example.com',
      SMTP_PASS: 'default-password',
      EMAIL_FROM: 'default@example.com',
      REPORT_SMTP_HOST: 'smtp.evanshine.me',
      REPORT_SMTP_PORT: '587',
      REPORT_SMTP_SECURE: 'false',
      REPORT_SMTP_USER: 'report@evanshine.me',
      REPORT_SMTP_PASS: 'report-password',
      REPORT_EMAIL_FROM: 'report@evanshine.me',
      MAIL_ACTION_PROVIDER_OVERRIDES: 'daily=evanshine',
    },
    {
      createTransport: (config) => ({
        sendMail: async (mail) => {
          transports.push({
            host: config.host,
            user: config.auth.user,
            from: mail.from,
            to: mail.to,
          });
          return { messageId: 'daily-1' };
        },
      }),
    },
  );

  assert.equal(transports.length, 1);
  assert.equal(transports[0].host, 'smtp.evanshine.me');
  assert.equal(transports[0].user, 'report@evanshine.me');
  assert.equal(transports[0].from, 'report@evanshine.me');
  assert.deepEqual(transports[0].to, ['agent4.daily@claw.163.com']);
});

test('buildRoutedAgentReply can send clerk daily summary email when explicitly requested', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-daily',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，发送今天日报到邮箱' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
      },
    },
    {
      FEISHU_AUTHORIZED_OPEN_IDS: 'user-a',
      EMAIL_NOTIFY_ENABLED: 'true',
    },
    {
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'daily');
  assert.match(reply.replyText, /已发送日报/);
  assert.match(reply.replyText, /agent4\.daily@claw\.163\.com/);
});

test('buildRoutedAgentReply can run clerk token lab when explicitly requested', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-token-lab',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，启动高 token 训练场' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
      },
    },
    {
      FEISHU_AUTHORIZED_OPEN_IDS: 'user-a',
      QA_TOKEN_LAB_BATCH_SIZE: '2',
    },
    {
      tokenLabRunner: async (runnerOptions) => {
        await runnerOptions.emailSender({ action: 'archive', mailbox: 'agent3.archive@claw.163.com' });
        sent.push('runner-called');
        return {
          report: {
            totalJobs: 2,
            totalTokens: 300,
            estimatedTotalTokens: 0,
            text: 'QA Token Lab 训练场报告',
          },
          files: {
            report: '/tmp/qa-token-lab/report.md',
            items: '/tmp/qa-token-lab/items.json',
          },
          emailMessages: [
            { action: 'archive', mailbox: 'agent3.archive@claw.163.com' },
          ],
        };
      },
      emailSender: async (message) => {
        sent.push(message.action);
        return { sent: true };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(sent, ['archive', 'runner-called']);
  assert.match(reply.replyText, /高 token 训练场已完成/);
  assert.match(reply.replyText, /2/);
  assert.match(reply.replyText, /300/);
  assert.match(reply.replyText, /report\.md/);
});

test('buildRoutedAgentReply sends a token lab receipt before long execution', async () => {
  const sent = [];
  await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-token-lab-receipt',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，启动高 token 训练场' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
      },
    },
    {
      FEISHU_AUTHORIZED_OPEN_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        sent.push(JSON.parse(message.content).text);
        return { message_id: 'reply-a' };
      },
      tokenLabRunner: async () => ({
        report: { totalJobs: 1, totalTokens: 10, text: 'ok' },
        files: {},
        emailMessages: [],
      }),
    },
  );

  assert.match(sent[0], /收到/);
  assert.match(sent[0], /高 token 训练场/);
});

test('buildRoutedAgentReply can run clerk multi-agent lab when explicitly requested', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-multi-agent-lab',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，启动多 Agent 训练场，用邮箱归档结果' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
      },
    },
    {
      FEISHU_AUTHORIZED_OPEN_IDS: 'user-a',
    },
    {
      multiAgentLabRunner: async (runnerOptions) => {
        await runnerOptions.emailSender({ action: 'archive', mailbox: 'agent3.archive@claw.163.com' });
        await runnerOptions.emailSender({ action: 'eval', mailbox: 'hagent.eval@claw.163.com' });
        sent.push('runner-called');
        return {
          summary: {
            totalRounds: 3,
            totalItems: 9,
            totalTokens: 900,
            estimatedTotalTokens: 1200,
            failedJobs: 1,
            winner: 'Hermes',
          },
          files: {
            report: '/tmp/multi-agent-lab/report.md',
            items: '/tmp/multi-agent-lab/items.json',
            summary: '/tmp/multi-agent-lab/summary.json',
          },
        };
      },
      emailSender: async (message) => {
        sent.push(message.action);
        return { sent: true };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(sent, ['archive', 'eval', 'runner-called']);
  assert.match(reply.replyText, /多 Agent 训练场已完成/);
  assert.match(reply.replyText, /3/);
  assert.match(reply.replyText, /9/);
  assert.match(reply.replyText, /900/);
  assert.match(reply.replyText, /1200/);
  assert.match(reply.replyText, /1/);
  assert.match(reply.replyText, /Hermes/);
  assert.match(reply.replyText, /report\.md/);
  assert.match(reply.replyText, /summary\.json/);
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

test('sendFeishuMessageUpdate patches an existing Feishu message', async () => {
  const calls = [];
  await sendFeishuMessageUpdate(
    {
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    'om_xxx',
    {
      msgType: 'text',
      content: JSON.stringify({ text: '流式内容' }),
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
  assert.match(calls[1].url, /\/im\/v1\/messages\/om_xxx$/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    msg_type: 'text',
    content: JSON.stringify({ text: '流式内容' }),
  });
});

test('uploadFeishuImage uploads generated image and returns image key', async () => {
  const calls = [];
  const imageKey = await uploadFeishuImage(
    {
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    {
      b64Json: Buffer.from('png-data').toString('base64'),
      mimeType: 'image/png',
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
          data: {
            image_key: 'img_v3_xxx',
          },
        }),
      };
    },
  );

  assert.equal(imageKey, 'img_v3_xxx');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/im\/v1\/images$/);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token');
  assert(calls[1].options.body instanceof FormData);
});

test('downloadFeishuMessageImage downloads an image resource from a message', async () => {
  const calls = [];
  const image = await downloadFeishuMessageImage(
    {
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
    },
    'om_photo',
    'img_v3_photo',
    async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: 'tenant-token',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(Buffer.from('jpeg-data'), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/im\/v1\/messages\/om_photo\/resources\/img_v3_photo\?type=image$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token');
  assert.equal(image.mimeType, 'image/jpeg');
  assert.equal(image.filename, 'img_v3_photo.jpg');
  assert.deepEqual(image.buffer, Buffer.from('jpeg-data'));
});

test('runWebhookInBackground edits an image sent with the same message', async () => {
  const sentMessages = [];
  const editedPrompts = [];
  const uploadedImages = [];

  runWebhookInBackground(
    {
      event: {
        sender: { sender_id: { open_id: 'user-a' } },
        message: {
          message_id: 'om_same_photo',
          chat_id: 'chat-a',
          msg_type: 'image',
          content: JSON.stringify({ image_key: 'img_v3_same' }),
        },
      },
      text: '修复这张旧照片',
    },
    {
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_OPEN_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        sentMessages.push(message);
        return { data: { message_id: `om_reply_${sentMessages.length}` } };
      },
      imageDownloader: async (messageId, imageKey) => {
        assert.equal(messageId, 'om_same_photo');
        assert.equal(imageKey, 'img_v3_same');
        return {
          buffer: Buffer.from('old-photo'),
          mimeType: 'image/jpeg',
          filename: 'old-photo.jpg',
        };
      },
      imageEditor: async (prompt, options) => {
        editedPrompts.push(prompt);
        assert.deepEqual(options.image.buffer, Buffer.from('old-photo'));
        return {
          model: 'gpt-image-2',
          type: 'b64_json',
          b64Json: Buffer.from('fixed-photo').toString('base64'),
          mimeType: 'image/png',
        };
      },
      imageUploader: async (imageResult) => {
        uploadedImages.push(imageResult);
        return 'img_v3_result';
      },
    },
  );

  await waitForCondition(() => sentMessages.length >= 2);
  assert.deepEqual(editedPrompts, ['修复这张旧照片']);
  assert.equal(uploadedImages.length, 1);
  assert.match(JSON.stringify(JSON.parse(sentMessages[0].content)), /开始处理图片/);
  assert.equal(sentMessages[1].msgType, 'interactive');
  assert.match(JSON.stringify(JSON.parse(sentMessages[1].content)), /img_v3_result/);
});

test('runWebhookInBackground remembers an image and edits it from a later instruction', async () => {
  const imageMemory = new Map();
  const sentMessages = [];
  const editedPrompts = [];

  rememberFeishuImage(
    {
      event: {
        sender: { sender_id: { open_id: 'user-a' } },
        message: {
          message_id: 'om_previous_photo',
          chat_id: 'chat-a',
          content: JSON.stringify({ image_key: 'img_v3_previous' }),
        },
      },
    },
    imageMemory,
    60_000,
  );

  runWebhookInBackground(
    {
      event: {
        sender: { sender_id: { open_id: 'user-a' } },
        message: {
          message_id: 'om_instruction',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '修复刚才那张旧照片' }),
        },
      },
    },
    {
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_OPEN_IDS: 'user-a',
    },
    {
      imageMemory,
      receiptSender: async (message) => {
        sentMessages.push(message);
        return { data: { message_id: `om_reply_${sentMessages.length}` } };
      },
      imageDownloader: async (messageId, imageKey) => {
        assert.equal(messageId, 'om_previous_photo');
        assert.equal(imageKey, 'img_v3_previous');
        return {
          buffer: Buffer.from('old-photo'),
          mimeType: 'image/jpeg',
          filename: 'old-photo.jpg',
        };
      },
      imageEditor: async (prompt) => {
        editedPrompts.push(prompt);
        return {
          model: 'gpt-image-2',
          type: 'b64_json',
          b64Json: Buffer.from('fixed-photo').toString('base64'),
          mimeType: 'image/png',
        };
      },
      imageUploader: async () => 'img_v3_result',
    },
  );

  await waitForCondition(() => sentMessages.length >= 2);
  assert.deepEqual(editedPrompts, ['修复刚才那张旧照片']);
  assert.match(JSON.stringify(JSON.parse(sentMessages[1].content)), /img_v3_result/);
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

test('createServer streams chat by updating the same Feishu message', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'feishu-usage-ledger-'));
  const ledgerFile = join(tempDir, 'usage.jsonl');
  const replies = [];
  const updates = [];
  let chatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
      FEISHU_CHAT_STREAMING_ENABLED: 'true',
      FEISHU_USAGE_LEDGER_ENABLED: 'true',
      FEISHU_USAGE_LEDGER_PATH: ledgerFile,
      STREAMING_MODEL_BASE_URL: 'https://example.test/v1',
      STREAMING_MODEL_API_KEY: 'secret',
      STREAMING_MODEL_ID: 'model-a',
    },
    {
      chat: async () => {
        chatCalled = true;
        return 'fallback should not run';
      },
      receiptSender: async (message) => {
        replies.push(message);
        return { data: { message_id: 'om_stream' } };
      },
      messageUpdater: async (messageId, message) => {
        updates.push({ messageId, message });
      },
      streamChat: async (prompt, options) => {
        await options.onDelta('你', '你');
        await options.onDelta('好', '你好');
        return {
          text: '你好',
          endpoint: 'chat_completions',
          model: 'model-a',
          tier: 'chat',
          usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
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
            content: JSON.stringify({ text: '今天随便聊两句' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => updates.length >= 2);
    assert.equal(chatCalled, false);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].msgType, 'interactive');
    assert.match(JSON.stringify(JSON.parse(replies[0].content)), /正在思考/);
    assert.deepEqual(updates.map((item) => item.messageId), ['om_stream', 'om_stream']);
    assert.equal(updates.at(-1).message.msgType, 'interactive');
    assert.match(JSON.stringify(JSON.parse(updates.at(-1).message.content)), /你好/);
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8').trim());
    assert.equal(ledger.assistant, 'OpenClaw');
    assert.equal(ledger.agent, 'chat-agent');
    assert.equal(ledger.model, 'model-a');
    assert.equal(ledger.totalTokens, 13);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runWebhookInBackground passes default receipt sender to streaming chat', async () => {
  const originalFetch = global.fetch;
  const sentMessages = [];
  const updates = [];
  let chatCalled = false;

  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/auth/v3/tenant_access_token/internal')) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (requestUrl.includes('/im/v1/messages?')) {
      sentMessages.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_stream_bg' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  try {
    runWebhookInBackground(
      {
        event: {
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
      },
      {
        GITHUB_TOKEN: 'ghp_example',
        FEISHU_WEBHOOK_ASYNC: 'true',
        FEISHU_RESULT_NOTIFY_ENABLED: 'true',
        FEISHU_APP_ID: 'cli_xxx',
        FEISHU_APP_SECRET: 'secret_xxx',
        OPENCLAW_CHAT_ENABLED: 'true',
        FEISHU_CHAT_STREAMING_ENABLED: 'true',
        STREAMING_MODEL_BASE_URL: 'https://example.test/v1',
        STREAMING_MODEL_API_KEY: 'secret',
        STREAMING_MODEL_ID: 'model-a',
      },
      {
        chat: async () => {
          chatCalled = true;
          return 'fallback should not run';
        },
        messageUpdater: async (messageId, message) => {
          updates.push({ messageId, message });
        },
        streamChat: async (prompt, options) => {
          await options.onDelta('你', '你');
          await options.onDelta('好', '你好');
          return { text: '你好', endpoint: 'chat_completions' };
        },
      },
    );

    await waitForCondition(() => updates.length >= 2);
    assert.equal(chatCalled, false);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].msg_type, 'interactive');
    assert.match(JSON.stringify(JSON.parse(sentMessages[0].content)), /正在思考/);
    assert.deepEqual(updates.map((item) => item.messageId), ['om_stream_bg', 'om_stream_bg']);
    assert.equal(updates.at(-1).message.msgType, 'interactive');
    assert.match(JSON.stringify(JSON.parse(updates.at(-1).message.content)), /你好/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('createServer does not block streaming deltas on slow Feishu card updates', async () => {
  let releaseUpdate;
  const slowUpdateStarted = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  let firstDeltaReturned = false;
  let secondDeltaReturned = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
      FEISHU_CHAT_STREAMING_ENABLED: 'true',
      STREAMING_MODEL_BASE_URL: 'https://example.test/v1',
      STREAMING_MODEL_API_KEY: 'secret',
      STREAMING_MODEL_ID: 'model-a',
      FEISHU_STREAM_UPDATE_INTERVAL_MS: '0',
    },
    {
      receiptSender: async () => ({ data: { message_id: 'om_stream_slow' } }),
      messageUpdater: async () => slowUpdateStarted,
      streamChat: async (prompt, options) => {
        await options.onDelta('你', '你');
        firstDeltaReturned = true;
        await options.onDelta('好', '你好');
        secondDeltaReturned = true;
        return { text: '你好', endpoint: 'chat_completions' };
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
            content: JSON.stringify({ text: '今天随便聊两句' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => firstDeltaReturned && secondDeltaReturned, { timeoutMs: 200 });
  } finally {
    releaseUpdate();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes image generation with isolated image generator', async () => {
  const replies = [];
  let imagePrompt = '';
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-a',
      IMAGE_MODEL_BASE_URL: 'https://img.example.test',
      IMAGE_MODEL_API_KEY: 'image-secret',
    },
    {
      receiptSender: async (message) => {
        replies.push(message);
        return { data: { message_id: `om_${replies.length}` } };
      },
      imageGenerator: async (prompt) => {
        imagePrompt = prompt;
        return {
          type: 'b64_json',
          b64Json: 'abc123',
          mimeType: 'image/png',
          model: 'gpt-image-2',
        };
      },
      imageUploader: async () => 'img_v3_generated',
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
            content: JSON.stringify({ text: '生成一张图片：赛博风电商客服机器人海报' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => replies.length >= 2);
    assert.equal(imagePrompt, '赛博风电商客服机器人海报');
    assert.equal(replies[0].msgType, 'text');
    assert.match(JSON.parse(replies[0].content).text, /开始生成图片/);
    assert.equal(replies[1].msgType, 'interactive');
    assert.match(JSON.stringify(JSON.parse(replies[1].content)), /gpt-image-2/);
    assert.match(JSON.stringify(JSON.parse(replies[1].content)), /img_v3_generated/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer falls back to normal chat when streaming fails', async () => {
  let reply;
  let updateCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
      FEISHU_CHAT_STREAMING_ENABLED: 'true',
      STREAMING_MODEL_BASE_URL: 'https://example.test/v1',
      STREAMING_MODEL_API_KEY: 'secret',
      STREAMING_MODEL_ID: 'model-a',
    },
    {
      chat: async () => '普通回复。',
      receiptSender: async (message) => {
        reply = message;
      },
      messageUpdater: async () => {
        updateCalled = true;
      },
      streamChat: async () => {
        throw new Error('stream failed');
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
            content: JSON.stringify({ text: '今天随便聊两句' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await waitForCondition(() => Boolean(reply));
    assert.equal(updateCalled, false);
    assert.match(JSON.parse(reply.content).text, /普通回复/);
  } finally {
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

test('createServer routes natural-language QA data requests without chat fallback', async () => {
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
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
      chat: async () => {
        chatCalled = true;
        return 'should not be used';
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
            content: JSON.stringify({ text: '帮我生成一批电商平台客服训练数据' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(chatCalled, false);
    assert.match(JSON.parse(reply.content).text, /电商客服训练数据/);
    assert.doesNotMatch(JSON.parse(reply.content).text, /\/status/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer routes clerk token summaries without chat fallback', async () => {
  let chatCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_OPEN_IDS: 'user-a',
      FEISHU_USAGE_LEDGER_ENABLED: 'true',
      FEISHU_USAGE_LEDGER_PATH: join(mkdtempSync(join(tmpdir(), 'clerk-ledger-')), 'usage.jsonl'),
    },
    {
      receiptSender: async (message) => {
        const content = JSON.stringify(JSON.parse(message.content));
        assert.match(content, /文员统计/);
        assert.match(content, /token/);
      },
      chat: async () => {
        chatCalled = true;
        return 'chat fallback should not run';
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
            content: JSON.stringify({ text: '文员，统计今天 Hermes 和 OpenClaw 谁更费 token' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(chatCalled, false);
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

