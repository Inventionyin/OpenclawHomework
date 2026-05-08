const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildFeishuResultCard,
  buildFeishuDashboardCard,
  buildFeishuTextMessage,
  buildEmailRunResultMessage,
  buildEmailRunResultSubject,
  resolveClawEmailSenderForAction,
  buildRoutedChatReply,
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
  resolveAgentRoute,
  getDailySummarySnapshotFile,
  readDailySummarySnapshot,
  writeDailySummarySnapshot,
  appendDailySummaryRunSnapshot,
  getDailySummaryStateFile,
  readDailySummaryState,
  writeDailySummaryState,
  appendDailySummaryRun,
  buildWechatMpTextReplyXml,
  getWechatMpConfig,
  parseWechatMpXml,
  isWechatMpBindCommand,
  verifyWechatMpSignature,
} = require('../scripts/feishu-bridge');
const {
  readMailLedgerEntries,
} = require('../scripts/mail-ledger');

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

function buildWechatSignature(token, timestamp, nonce) {
  return createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
}

test('wechat mp helpers verify signature parse xml and build text reply', () => {
  const token = 'wechat-test-token';
  const timestamp = '1710000000';
  const nonce = 'nonce-1';
  const signature = buildWechatSignature(token, timestamp, nonce);

  assert.equal(verifyWechatMpSignature({ signature, timestamp, nonce }, token), true);
  assert.equal(verifyWechatMpSignature({ signature: 'bad', timestamp, nonce }, token), false);
  assert.deepEqual(getWechatMpConfig({
    WECHAT_MP_APP_ID: 'wx-demo',
    WECHAT_MP_TOKEN: token,
    WECHAT_MP_ALLOWED_OPENIDS: 'openid-a, openid-b',
  }).allowedOpenIds, ['openid-a', 'openid-b']);

  const message = parseWechatMpXml([
    '<xml>',
    '<ToUserName><![CDATA[gh_test]]></ToUserName>',
    '<FromUserName><![CDATA[openid-a]]></FromUserName>',
    '<CreateTime>1710000001</CreateTime>',
    '<MsgType><![CDATA[text]]></MsgType>',
    '<Content><![CDATA[服务器状态]]></Content>',
    '<MsgId>42</MsgId>',
    '</xml>',
  ].join(''));

  assert.equal(message.toUserName, 'gh_test');
  assert.equal(message.fromUserName, 'openid-a');
  assert.equal(message.content, '服务器状态');
  assert.match(buildWechatMpTextReplyXml(message, '收到 <ok>'), /&lt;ok&gt;/);
  assert.equal(isWechatMpBindCommand('绑定我 xyz', { bindCode: 'xyz' }), true);
  assert.equal(isWechatMpBindCommand('绑定我 abc', { bindCode: 'xyz' }), false);
});

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
  assert.match(reply, /文件通道/);
  assert.match(reply, /微信 Bridge 计划/);
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

test('buildFeishuTextMessage omits unknown elapsed footer when elapsed is unavailable', () => {
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
  });

  const content = JSON.parse(message.content);
  assert.match(content.text, /状态：完成/);
  assert.doesNotMatch(content.text, /耗时：unknown/);
  assert.doesNotMatch(content.text, /耗时：/);
});

test('buildFeishuDashboardCard summarizes dashboard state with links', () => {
  const card = buildFeishuDashboardCard({
    assistant: 'Hermes',
    generatedAt: '2026-05-07T00:00:00.000Z',
    service: {
      streaming: true,
      commit: 'abc1234',
    },
    tasks: {
      counts: {
        today: 3,
        running: 1,
        failed: 1,
        recoverable: 1,
      },
    },
    pipeline: {
      status: 'running',
      completedStages: 2,
      totalStages: 4,
      failedStages: 1,
      nextAction: '查看失败任务',
    },
    usage: {
      totalTokens: 12345,
    },
    mail: {
      todayCount: 2,
    },
    snapshot: {
      latestRun: {
        conclusion: 'success',
        runUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/1',
      },
    },
  }, {
    DASHBOARD_PUBLIC_URL: 'https://hermes.evanshine.me/dashboard',
  });

  const content = JSON.stringify(card);
  assert.match(content, /Hermes 控制台/);
  assert.match(content, /今日任务/);
  assert.match(content, /12,345/);
  assert.match(content, /打开网页看板/);
  assert.match(content, /https:\/\/hermes\.evanshine\.me\/dashboard/);
  assert.match(content, /GitHub Run/);
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

test('resolveAgentRoute keeps explicit command routes ahead of model planner suggestions', async () => {
  let plannerCalled = false;
  const route = await resolveAgentRoute('/exec df -h', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
  }, {
    intentPlanner: async () => {
      plannerCalled = true;
      return '{"intent":"tool","agent":"chat-agent","action":"chat","confidence":"high","reason":"wrong"}';
    },
  });

  assert.equal(plannerCalled, false);
  assert.deepEqual(route, {
    agent: 'ops-agent',
    action: 'exec',
    command: 'df -h',
    requiresAuth: true,
  });
});

test('resolveAgentRoute keeps greetings on local fast path without model planner', async () => {
  let plannerCalled = false;
  const route = await resolveAgentRoute('你好', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
  }, {
    intentPlanner: async () => {
      plannerCalled = true;
      return '{"intent":"tool","agent":"clerk-agent","action":"command-center","confidence":"high"}';
    },
  });

  assert.equal(plannerCalled, false);
  assert.deepEqual(route, {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});

test('resolveAgentRoute can upgrade safe fuzzy chat through model planner', async () => {
  let promptText = '';
  const route = await resolveAgentRoute('我有点乱，先听你判断', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
    FEISHU_ASSISTANT_NAME: 'Hermes',
  }, {
    intentPlanner: async (prompt) => {
      promptText = prompt;
      return JSON.stringify({
        intent: 'tool',
        agent: 'clerk-agent',
        action: 'command-center',
        confidence: 'high',
        reason: '用户要项目总控和下一步计划',
      });
    },
  });

  assert.match(promptText, /Hermes/);
  assert.equal(route.agent, 'clerk-agent');
  assert.equal(route.action, 'command-center');
  assert.equal(route.requiresAuth, true);
  assert.equal(route.intentSource, 'model-planner');
  assert.match(route.reason, /下一步计划/);
});

test('resolveAgentRoute keeps rule fallback when planner suggests auth-required route with medium confidence', async () => {
  const route = await resolveAgentRoute('我有点乱，先听你判断', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
  }, {
    intentPlanner: async () => JSON.stringify({
      intent: 'tool',
      agent: 'clerk-agent',
      action: 'command-center',
      confidence: 'medium',
      reason: '可能需要总览',
    }),
  });

  assert.deepEqual(route, {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});

test('resolveAgentRoute falls back to rule route when model planner fails or is unsafe', async () => {
  const failedRoute = await resolveAgentRoute('我有点乱，先听你判断', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
  }, {
    intentPlanner: async () => {
      throw new Error('planner timeout');
    },
  });

  assert.deepEqual(failedRoute, {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });

  const unsafeRoute = await resolveAgentRoute('我有点乱，先听你判断', {
    FEISHU_INTENT_PLANNER_ENABLED: 'true',
  }, {
    intentPlanner: async () => JSON.stringify({
      intent: 'tool',
      agent: 'ops-agent',
      action: 'restart',
      confidence: 'high',
      reason: 'unsafe escalation',
    }),
  });

  assert.deepEqual(unsafeRoute, {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
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

test('daily summary snapshot helpers keep compatibility and append artifactsUrl with trim', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-snapshot-'));
  const stateFile = join(tempDir, 'daily-summary-state.json');
  const env = {
    DAILY_SUMMARY_STATE_FILE: stateFile,
  };

  try {
    assert.equal(getDailySummarySnapshotFile(env), stateFile);
    assert.equal(getDailySummaryStateFile(env), stateFile);

    writeDailySummarySnapshot(env, {
      runs: Array.from({ length: 19 }, (_, index) => ({
        id: index + 1,
        conclusion: 'success',
        runUrl: `https://github.com/example/repo/actions/runs/${index + 1}`,
        artifactsUrl: `https://github.com/example/repo/actions/runs/${index + 1}#artifacts`,
        targetRef: 'main',
        runMode: 'smoke',
      })),
    });
    assert.equal(readDailySummarySnapshot(env).runs.length, 19);

    const nextRuns = appendDailySummaryRunSnapshot(
      env,
      {
        targetRef: 'develop',
        runMode: 'contracts',
        actionsUrl: 'https://github.com/example/repo/actions/runs/999',
      },
      {
        id: 999,
        conclusion: 'failure',
      },
    );

    assert.equal(nextRuns.length, 20);
    assert.equal(nextRuns[0].id, 1);
    assert.equal(nextRuns[19].id, 999);
    assert.equal(nextRuns[19].runUrl, 'https://github.com/example/repo/actions/runs/999');
    assert.equal(nextRuns[19].artifactsUrl, 'https://github.com/example/repo/actions/runs/999#artifacts');
    assert.equal(nextRuns[19].targetRef, 'develop');
    assert.equal(nextRuns[19].runMode, 'contracts');

    appendDailySummaryRunSnapshot(
      env,
      {
        targetRef: 'release',
        runMode: 'all',
      },
      {
        id: 1000,
        conclusion: 'success',
        html_url: 'https://github.com/example/repo/actions/runs/1000',
      },
    );
    const snapshot = readDailySummarySnapshot(env);
    assert.equal(snapshot.runs.length, 20);
    assert.equal(snapshot.runs[0].id, 2);
    assert.equal(snapshot.runs[19].id, 1000);
    assert.equal(snapshot.runs[19].artifactsUrl, 'https://github.com/example/repo/actions/runs/1000#artifacts');

    writeDailySummaryState(env, { runs: [] });
    assert.deepEqual(readDailySummaryState(env), { runs: [] });

    const legacyRuns = appendDailySummaryRun(
      env,
      {
        targetRef: 'main',
        runMode: 'smoke',
      },
      {
        id: 2000,
        conclusion: 'queued',
        html_url: 'https://github.com/example/repo/actions/runs/2000',
      },
    );
    assert.equal(legacyRuns.length, 1);
    assert.equal(legacyRuns[0].artifactsUrl, 'https://github.com/example/repo/actions/runs/2000#artifacts');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test('resolveClawEmailSenderForAction maps actions to existing primary and sub mailboxes', () => {
  assert.deepEqual(resolveClawEmailSenderForAction('report'), {
    action: 'report',
    primaryFrom: 'watchee@claw.163.com',
    mappedPrimaryFrom: 'watchee@claw.163.com',
    roleMailbox: 'watchee.report@claw.163.com',
  });
  assert.deepEqual(resolveClawEmailSenderForAction('verify'), {
    action: 'verify',
    primaryFrom: 'evasan@claw.163.com',
    mappedPrimaryFrom: 'evasan@claw.163.com',
    roleMailbox: 'evasan.account@claw.163.com',
  });
  assert.deepEqual(resolveClawEmailSenderForAction('files'), {
    action: 'files',
    primaryFrom: 'agent3@claw.163.com',
    mappedPrimaryFrom: 'agent3@claw.163.com',
    roleMailbox: 'agent3.files@claw.163.com',
  });
  assert.deepEqual(resolveClawEmailSenderForAction('daily'), {
    action: 'daily',
    primaryFrom: 'agent4@claw.163.com',
    mappedPrimaryFrom: 'agent4@claw.163.com',
    roleMailbox: 'agent4.daily@claw.163.com',
  });
  assert.deepEqual(resolveClawEmailSenderForAction('monitor'), {
    action: 'monitor',
    primaryFrom: 'hagent@claw.163.com',
    mappedPrimaryFrom: 'hagent@claw.163.com',
    roleMailbox: 'hagent.monitor@claw.163.com',
  });
  assert.deepEqual(resolveClawEmailSenderForAction('support', { EMAIL_FROM: 'shine1@claw.163.com' }), {
    action: 'support',
    primaryFrom: 'shine1@claw.163.com',
    mappedPrimaryFrom: 'agent4@claw.163.com',
    roleMailbox: 'agent4.support@claw.163.com',
  });
});

test('notifyUiMailboxActions can send role mail with current ClawEmail primary identity', async () => {
  const sent = [];

  await notifyUiMailboxActions(
    {
      actionsUrl: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/789',
      targetRef: 'main',
      runMode: 'smoke',
      mailboxAction: 'support',
    },
    {
      conclusion: 'success',
      html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/789',
    },
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      EMAIL_FROM: 'watchee@claw.163.com',
      MAIL_ACTION_PROVIDER_OVERRIDES: 'report=clawemail-role,support=clawemail-role',
    },
    {
      mailCliSender: async (message, profile) => {
        sent.push({ message, profile });
        return { sent: true, provider: profile.name };
      },
    },
  );

  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.action, 'report');
  assert.equal(sent[0].profile.from, 'watchee@claw.163.com');
  assert.equal(sent[0].profile.roleMailbox, 'watchee.report@claw.163.com');
  assert.deepEqual(sent[0].message.to, ['watchee.report@claw.163.com']);
  assert.equal(sent[1].message.action, 'support');
  assert.equal(sent[1].profile.from, 'watchee@claw.163.com');
  assert.equal(sent[1].profile.mappedPrimaryFrom, 'agent4@claw.163.com');
  assert.equal(sent[1].profile.roleMailbox, 'agent4.support@claw.163.com');
  assert.deepEqual(sent[1].message.to, ['agent4.support@claw.163.com']);
});

test('resolveClawEmailSenderForAction can use mapped action primary when explicitly enabled', () => {
  assert.deepEqual(resolveClawEmailSenderForAction('support', {
    EMAIL_FROM: 'shine1@claw.163.com',
    CLAWEMAIL_ROLE_USE_ACTION_PRIMARY: 'true',
  }), {
    action: 'support',
    primaryFrom: 'agent4@claw.163.com',
    mappedPrimaryFrom: 'agent4@claw.163.com',
    roleMailbox: 'agent4.support@claw.163.com',
  });
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

test('sendDailySummaryNotification can send to a user email and keep daily mailbox archived', async () => {
  const sent = [];

  await sendDailySummaryNotification(
    [{ conclusion: 'success', runUrl: 'https://example.com/run' }],
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      DAILY_SUMMARY_EXTERNAL_TO: '1693457391@qq.com',
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
  assert.deepEqual(sent[0].to, ['1693457391@qq.com', 'agent4.daily@claw.163.com']);
});

test('sendDailySummaryNotification prefers explicit recipient over default external recipient', async () => {
  const sent = [];

  await sendDailySummaryNotification(
    [{ conclusion: 'success', runUrl: 'https://example.com/run' }],
    {
      EMAIL_NOTIFY_ENABLED: 'true',
      DAILY_SUMMARY_EXTERNAL_TO: '1693457391@qq.com',
    },
    {
      recipientEmail: '2261823517@qq.com',
      emailSender: async (message) => {
        sent.push(message);
        return { sent: true };
      },
    },
  );

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['2261823517@qq.com', 'agent4.daily@claw.163.com']);
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

test('sendDailySummaryNotification writes mail ledger for real smtp sender path', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-mail-ledger-'));
  const ledgerFile = join(tempDir, 'mail-ledger.jsonl');
  const transports = [];

  try {
    await sendDailySummaryNotification(
      [{ conclusion: 'success', runUrl: 'https://example.com/run' }],
      {
        FEISHU_ASSISTANT_NAME: 'Hermes',
        EMAIL_NOTIFY_ENABLED: 'true',
        DAILY_SUMMARY_EXTERNAL_TO: '1693457391@qq.com',
        SMTP_HOST: 'smtp.default.example.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'default@example.com',
        SMTP_PASS: 'default-password',
        EMAIL_FROM: 'default@example.com',
        MAIL_LEDGER_ENABLED: 'true',
        MAIL_LEDGER_PATH: ledgerFile,
      },
      {
        createTransport: (config) => ({
          sendMail: async (mail) => {
            transports.push({
              host: config.host,
              user: config.auth.user,
              to: mail.to,
            });
            return { messageId: 'daily-ledger-1' };
          },
        }),
      },
    );

    assert.equal(transports.length, 1);
    const entries = readMailLedgerEntries({ MAIL_LEDGER_PATH: ledgerFile });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].assistant, 'Hermes');
    assert.equal(entries[0].action, 'daily');
    assert.equal(entries[0].provider, 'default');
    assert.equal(entries[0].sent, true);
    assert.deepEqual(entries[0].externalTo, ['1693457391@qq.com']);
    assert.deepEqual(entries[0].archiveTo, ['agent4.daily@claw.163.com']);
    assert.doesNotMatch(JSON.stringify(entries[0]), /default-password/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('sendDailySummaryNotification builds a richer daily report from saved state and usage ledger', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-rich-'));
  const ledgerFile = join(tempDir, 'usage.jsonl');
  const stateFile = join(tempDir, 'daily-state.json');
  const multiAgentDir = join(tempDir, 'multi-agent-lab');
  const sent = [];

  try {
    mkdirSync(multiAgentDir, { recursive: true });
    writeFileSync(ledgerFile, [
      JSON.stringify({ assistant: 'Hermes', totalTokens: 120, modelElapsedMs: 2400 }),
      JSON.stringify({ assistant: 'OpenClaw', totalTokens: 80, modelElapsedMs: 1600 }),
    ].join('\n'), 'utf8');

    writeFileSync(stateFile, `${JSON.stringify({
      runs: [
        {
          conclusion: 'success',
          runUrl: 'https://github.com/example/repo/actions/runs/1',
          artifactsUrl: 'https://github.com/example/repo/actions/runs/1#artifacts',
          targetRef: 'main',
          runMode: 'smoke',
        },
        {
          conclusion: 'failure',
          runUrl: 'https://github.com/example/repo/actions/runs/2',
          artifactsUrl: 'https://github.com/example/repo/actions/runs/2#artifacts',
          targetRef: 'develop',
          runMode: 'contracts',
        },
      ],
    }, null, 2)}\n`, 'utf8');

    writeFileSync(join(multiAgentDir, 'summary.json'), `${JSON.stringify({
      totalItems: 6,
      failedJobs: 1,
      winner: 'Hermes',
      totalTokens: 900,
    }, null, 2)}\n`, 'utf8');

    await sendDailySummaryNotification(
      [],
      {
        EMAIL_NOTIFY_ENABLED: 'true',
        FEISHU_USAGE_LEDGER_PATH: ledgerFile,
        DAILY_SUMMARY_STATE_FILE: stateFile,
        MULTI_AGENT_LAB_OUTPUT_DIR: multiAgentDir,
      },
      {
        emailSender: async (message) => {
          sent.push(message);
          return { sent: true };
        },
      },
    );

    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /develop/);
    assert.match(sent[0].text, /contracts/);
    assert.match(sent[0].text, /Hermes：120 tokens/);
    assert.match(sent[0].text, /OpenClaw：80 tokens/);
    assert.match(sent[0].text, /多 Agent 训练场：6 个样本/);
    assert.match(sent[0].text, /赢家：Hermes/);
    assert.match(sent[0].html, /日报看板/);
    assert.match(sent[0].html, /actions\/runs\/2#artifacts/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
      FEISHU_ALLOWED_USER_IDS: 'user-a',
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

test('buildRoutedAgentReply passes browser-agent protocol asset reporter through bridge', async () => {
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-browser-protocol-report',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '最近抓到哪些接口' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-a',
          },
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      protocolAssetReporter: async (request) => {
        assert.equal(request.query, '最近抓到哪些接口');
        return {
          summary: '总数 2；方法 GET:1、POST:1；状态 2xx:2',
          lines: [
            '1. GET /api/session 200 pa-session',
            '2. POST /api/login 200 pa-login',
          ],
        };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.match(reply.replyText, /线索定位/);
  assert.match(reply.replyText, /当前状态/);
  assert.match(reply.replyText, /下一步建议/);
  assert.match(reply.replyText, /协议资产报告/);
  assert.match(reply.replyText, /总数 2/);
  assert.match(reply.replyText, /POST \/api\/login 200 pa-login/);
});

test('buildRoutedAgentReply can turn captured protocol assets into test cases', async () => {
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-browser-protocol-tests',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '把最近抓到的接口整理成测试用例' }),
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
      protocolTestCaseBuilder: async (request) => {
        assert.equal(request.query, '把最近抓到的接口整理成测试用例');
        return {
          totalAssets: 1,
          cases: [
            {
              name: 'POST /api/login should return 200',
              method: 'POST',
              path: '/api/login',
              expectedStatus: 200,
              sourceAssetId: 'pa-login',
            },
          ],
          savedFile: '/tmp/protocol-test-cases.json',
        };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.match(reply.replyText, /协议资产已整理成测试用例/);
  assert.match(reply.replyText, /POST \/api\/login -> 200/);
});

test('buildRoutedAgentReply routes Dify testing assistant through injected runner', async () => {
  let receivedQuery;
  let receivedEnv;
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-dify-test-cases',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '请根据需求文档帮我生成测试用例' }),
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
      DIFY_TESTING_ASSISTANT_ENABLED: 'true',
    },
    {
      difyTestingAssistantRunner: async (query, options) => {
        receivedQuery = query;
        receivedEnv = options.env;
        return {
          ok: true,
          mode: 'remote',
          answer: '测试目标：验证购物车结算；测试用例：登录、加购、下单。',
        };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.equal(receivedQuery, '请根据需求文档帮我生成测试用例');
  assert.equal(receivedEnv.DIFY_TESTING_ASSISTANT_ENABLED, 'true');
  assert.match(reply.replyText, /Dify 测试助理结果/);
  assert.match(reply.replyText, /购物车结算/);
});

test('buildRoutedAgentReply returns structured Dify fallback when runner is unavailable', async () => {
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-dify-fallback',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '帮我做一下线上缺陷分析并给出复现建议' }),
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
      difyTestingAssistantRunner: async () => ({
        ok: false,
        mode: 'fallback',
        reason: 'unconfigured',
        message: 'Dify testing assistant is not configured.',
        config: { apiKey: '[REDACTED]' },
      }),
    },
  );

  assert.equal(reply.handled, true);
  assert.match(reply.replyText, /Dify 测试助理暂不可用/);
  assert.match(reply.replyText, /问题清单/);
  assert.match(reply.replyText, /改进建议/);
  assert.doesNotMatch(reply.replyText, /API_KEY|app-/);
});

test('buildRoutedAgentReply blocks unauthorized Dify testing assistant requests', async () => {
  let called = false;
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-dify-unauthorized',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '请根据需求文档帮我生成测试用例' }),
        },
        sender: {
          sender_id: {
            open_id: 'user-b',
          },
        },
      },
    },
    {
      FEISHU_ALLOWED_USER_IDS: 'user-a',
    },
    {
      difyTestingAssistantRunner: async () => {
        called = true;
        return { ok: true, answer: 'should not run' };
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.equal(called, false);
  assert.match(reply.replyText, /未授权/);
});

test('buildRoutedAgentReply executes safe multi-intent routes and merges replies', async () => {
  const calls = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-multi-intent-execute',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '看看服务器内存硬盘，顺便看今天失败任务，再统计 token 用量' }),
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
      multiIntentExecutor: async (subRoute) => {
        calls.push(`${subRoute.agent}:${subRoute.action}`);
        if (subRoute.action === 'load-summary') return '服务器状态：内存 3G 可用，硬盘 24G 可用';
        if (subRoute.action === 'task-center-failed') return '失败任务：今天 0 个';
        if (subRoute.action === 'token-summary') return 'Token 用量：Hermes 1200，OpenClaw 300';
        return 'unknown';
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(calls, [
    'ops-agent:load-summary',
    'clerk-agent:task-center-failed',
    'clerk-agent:token-summary',
  ]);
  assert.match(reply.replyText, /多意图执行结果/);
  assert.match(reply.replyText, /服务器状态：内存 3G/);
  assert.match(reply.replyText, /失败任务：今天 0 个/);
  assert.match(reply.replyText, /Token 用量：Hermes 1200/);
});

test('buildRoutedAgentReply can send clerk daily summary email to explicit user recipient', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-daily-explicit',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，把今日日报发到 1693457391@qq.com' }),
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
  assert.deepEqual(sent[0].to, ['1693457391@qq.com', 'agent4.daily@claw.163.com']);
  assert.match(reply.replyText, /1693457391@qq\.com/);
});

test('buildRoutedAgentReply warns when clerk daily email recipient is invalid', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-daily-invalid',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，把今日日报发给 1693457391@.com' }),
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
  assert.equal(sent.length, 0);
  assert.match(reply.replyText, /我理解你想发送今日日报到邮箱/);
  assert.match(reply.replyText, /邮箱格式/);
  assert.match(reply.replyText, /1693457391@\.com/);
  assert.match(reply.replyText, /1693457391@qq\.com/);
});

test('buildRoutedAgentReply explains daily report preview is not yet an email send', async () => {
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-daily-preview',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，把今天 UI 自动化结果发到邮箱' }),
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
  );

  assert.equal(reply.handled, true);
  assert.match(reply.replyText, /我理解你想查看日报预览/);
  assert.match(reply.replyText, /先没执行发送/);
  assert.match(reply.replyText, /发送今天日报到邮箱/);
});

test('buildRoutedAgentReply clarifies daily email defaults before sending when no recipient is specified', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-daily-clarify',
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
      DAILY_SUMMARY_EXTERNAL_TO: '1693457391@qq.com',
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
  assert.match(reply.replyText, /默认外发/);
  assert.match(reply.replyText, /1693457391@qq\.com/);
  assert.match(reply.replyText, /指定收件人/);
});

test('buildRoutedChatReply can prepend lightweight diagnosis for free chat', async () => {
  const reply = await buildRoutedChatReply(
    '为什么 OpenClaw 老是回两条消息',
    {
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      chat: async () => '先排查飞书回执和异步重复发送。',
    },
  );

  assert.match(reply, /我理解你是在问问题原因/);
  assert.match(reply, /先排查飞书回执/);
});

test('buildRoutedAgentReply explains why medium-confidence ops request was not executed', async () => {
  let called = false;
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-ops-medium',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '你重起一下' }),
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
      runOpsCheck: async () => {
        called = true;
        return {};
      },
    },
  );

  assert.equal(reply.handled, true);
  assert.equal(called, false);
  assert.match(reply.replyText, /我理解你想做的是：服务器运维操作/);
  assert.match(reply.replyText, /这次我先没执行/);
  assert.match(reply.replyText, /危险操作/);
  assert.match(reply.replyText, /重启你自己/);
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
        await runnerOptions.emailSender({ action: 'archive', mailbox: 'agent4.archive@claw.163.com' });
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
            { action: 'archive', mailbox: 'agent4.archive@claw.163.com' },
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
        await runnerOptions.emailSender({ action: 'archive', mailbox: 'agent4.archive@claw.163.com' });
        await runnerOptions.emailSender({ action: 'eval', mailbox: 'agent4.archive@claw.163.com' });
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

test('buildRoutedAgentReply creates clerk token factory background task without blocking', async () => {
  const calls = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-token-factory',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，开始 token 工厂' }),
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
      tokenFactoryStarter: () => {
        calls.push('starter');
        return {
          task: {
            id: 'tf-test-001',
            status: 'queued',
          },
          promise: Promise.resolve(),
        };
      },
    },
    { agent: 'clerk-agent', action: 'token-factory', requiresAuth: true },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(calls, ['starter']);
  assert.match(reply.replyText, /后台任务/);
  assert.match(reply.replyText, /tf-test-001/);
  assert.match(reply.replyText, /查看 token-factory 状态/);
});

test('buildRoutedAgentReply sends token factory receipt before long execution', async () => {
  const sent = [];
  await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-token-factory-receipt',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，开始 token 工厂' }),
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
        return { message_id: 'reply-token-factory' };
      },
      tokenFactoryStarter: () => ({
        task: {
          id: 'tf-test-002',
          status: 'queued',
        },
        promise: Promise.resolve(),
      }),
    },
    { agent: 'clerk-agent', action: 'token-factory', requiresAuth: true },
  );

  assert.match(sent[0], /收到/);
  assert.match(sent[0], /整套 token 工厂/);
});

test('buildRoutedAgentReply runs trend intel collection and writes report', async () => {
  const sent = [];
  const calls = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-trend-intel',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，今天开源热榜和热点新闻' }),
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
      TREND_INTEL_OUTPUT_FILE: '/tmp/trend-intel/latest.json',
    },
    {
      receiptSender: async (message) => {
        sent.push(JSON.parse(message.content).text);
        return { message_id: 'reply-trend-intel' };
      },
      trendIntelCollector: async ({ env }) => {
        calls.push(['collector', env.TREND_INTEL_OUTPUT_FILE]);
        return [{
          id: 'github-trending:microsoft/playwright',
          title: 'microsoft/playwright',
          source: 'GitHub Trending',
          kind: 'github-trending',
          link: 'https://github.com/microsoft/playwright',
          stars: 71000,
        }];
      },
      trendIntelReportWriter: (file, report) => {
        calls.push(['writer', file, report.total]);
      },
    },
    { agent: 'clerk-agent', action: 'trend-intel', requiresAuth: true },
  );

  assert.equal(reply.handled, true);
  assert.match(sent[0], /收到/);
  assert.match(sent[0], /热点/);
  assert.deepEqual(calls, [
    ['collector', '/tmp/trend-intel/latest.json'],
    ['writer', '/tmp/trend-intel/latest.json', 1],
  ]);
  assert.match(reply.replyText, /趋势情报已完成/);
  assert.match(reply.replyText, /1/);
  assert.match(reply.replyText, /microsoft\/playwright/);
  assert.match(reply.replyText, /latest\.json/);
});

test('buildRoutedAgentReply runs trend token factory and sends receipt before execution', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-trend-token-factory',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，烧 100 万 token 分析今天 GitHub 热门项目' }),
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
      TREND_TOKEN_FACTORY_BATCH_SIZE: '2',
    },
    {
      receiptSender: async (message) => {
        sent.push(JSON.parse(message.content).text);
        return { message_id: 'reply-trend-token-factory' };
      },
      trendTokenFactoryRunner: async (runnerOptions) => {
        assert.equal(runnerOptions.batchSize, '2');
        await runnerOptions.emailSender({ action: 'report', mailbox: 'watchee.report@claw.163.com' });
        sent.push('runner-called');
        return {
          report: {
            totalJobs: 2,
            failedJobs: 0,
            totalTokens: 1200,
            estimatedTotalTokens: 1800,
            followUpProjects: ['microsoft/playwright'],
          },
          files: {
            report: '/tmp/trend-token-factory/report.md',
            items: '/tmp/trend-token-factory/items.json',
            summary: '/tmp/trend-token-factory/summary.json',
          },
          emailMessages: [
            { action: 'report', mailbox: 'watchee.report@claw.163.com' },
          ],
        };
      },
      emailSender: async (message) => {
        sent.push(message.action);
        return { sent: true };
      },
    },
    { agent: 'clerk-agent', action: 'trend-token-factory', requiresAuth: true },
  );

  assert.equal(reply.handled, true);
  assert.match(sent[0], /收到/);
  assert.match(sent[0], /趋势 Token 工厂/);
  assert.deepEqual(sent.slice(1), ['report', 'runner-called']);
  assert.match(reply.replyText, /趋势 Token 工厂已完成/);
  assert.match(reply.replyText, /2/);
  assert.match(reply.replyText, /1200/);
  assert.match(reply.replyText, /1800/);
  assert.match(reply.replyText, /microsoft\/playwright/);
  assert.match(reply.replyText, /report\.md/);
});

test('buildRoutedAgentReply can query latest token factory task status', async () => {
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-clerk-token-factory-status',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '文员，查看 token-factory 状态' }),
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
    {},
    { agent: 'clerk-agent', action: 'token-factory-status', requiresAuth: true },
  );

  assert.equal(reply.handled, true);
  assert.match(reply.replyText, /token-factory|还没有/);
});

test('buildRoutedAgentReply sends dashboard card for Feishu dashboard request', async () => {
  const sent = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-dashboard-card',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '飞书里面打开控制台看板' }),
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
      DASHBOARD_PUBLIC_URL: 'https://openclaw.evanshine.me/dashboard',
    },
    {
      receiptSender: async (message) => {
        sent.push(message);
      },
      dashboardStateBuilder: async () => ({
        assistant: 'OpenClaw',
        generatedAt: '2026-05-07T00:00:00.000Z',
        service: {
          streaming: true,
          commit: 'abc1234',
        },
        tasks: {
          counts: {
            today: 1,
            running: 0,
            failed: 0,
            recoverable: 0,
          },
        },
        pipeline: {},
        usage: {
          totalTokens: 100,
        },
        mail: {
          todayCount: 1,
        },
        snapshot: {},
      }),
    },
    { agent: 'clerk-agent', action: 'dashboard-card', requiresAuth: true },
  );

  assert.equal(reply.handled, true);
  assert.equal(reply.replyText, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msgType, 'interactive');
  const content = JSON.stringify(JSON.parse(sent[0].content));
  assert.match(content, /OpenClaw 控制台/);
  assert.match(content, /打开网页看板/);
  assert.match(content, /https:\/\/openclaw\.evanshine\.me\/dashboard/);
});

test('buildRoutedAgentReply can apply high-confidence image channel switch', async () => {
  const writes = [];
  const restarts = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-image-channel-switch',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '切换生图通道 url: https://img2.suneora.com key: sk-test-secret' }),
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
      FEISHU_ENV_FILE: '/etc/test.env',
      FEISHU_ASSISTANT_NAME: 'OpenClaw',
    },
    {
      envWriter: (file, key, value) => writes.push({ file, key, value }),
      fetchImpl: async () => ({ ok: true, status: 200 }),
      restartService: (service) => restarts.push(service),
    },
    {
      agent: 'image-agent',
      action: 'image-channel-switch',
      confidence: 'high',
      config: {
        url: 'https://img2.suneora.com',
        apiKey: 'sk-test-secret',
        maskedApiKey: 'sk-tes...cret (14)',
        model: 'auto',
        size: '1024x1024',
        scope: 'both',
      },
      missing: [],
      requiresAuth: true,
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(writes.map((item) => item.key), [
    'IMAGE_MODEL_BASE_URL',
    'IMAGE_MODEL_API_KEY',
    'IMAGE_MODEL_ID',
    'IMAGE_MODEL_SIZE',
  ]);
  assert.match(reply.replyText, /配置已写入/);
  assert.match(reply.replyText, /\/v1\/models：通过/);
  assert.deepEqual(restarts, ['openclaw-feishu-bridge']);
  assert.match(reply.replyText, /已安排重启 openclaw-feishu-bridge/);
  assert.doesNotMatch(reply.replyText, /sk-test-secret/);
});

test('buildRoutedAgentReply clarifies medium-confidence image channel config without writing', async () => {
  const writes = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-image-channel-clarify',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: 'url: https://img2.suneora.com key: sk-test-secret' }),
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
      FEISHU_ENV_FILE: '/etc/test.env',
      FEISHU_ASSISTANT_NAME: 'OpenClaw',
    },
    {
      envWriter: (file, key, value) => writes.push({ file, key, value }),
    },
    {
      agent: 'image-agent',
      action: 'image-channel-clarify',
      confidence: 'medium',
      config: {
        url: 'https://img2.suneora.com',
        apiKey: 'sk-test-secret',
        maskedApiKey: 'sk-tes...cret (14)',
        model: 'auto',
        size: '1024x1024',
        scope: 'both',
      },
      missing: [],
      requiresAuth: true,
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(writes, []);
  assert.match(reply.replyText, /先不替换/);
});

test('buildRoutedAgentReply can apply high-confidence chat model channel switch', async () => {
  const writes = [];
  const restarts = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-model-channel-switch',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: '切换聊天模型通道 url: https://api.longcat.chat/openai/v1 key: ak-test-secret model: LongCat-Flash-Chat' }),
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
      FEISHU_ENV_FILE: '/etc/test.env',
      FEISHU_ASSISTANT_NAME: 'Hermes',
    },
    {
      envWriter: (file, key, value) => writes.push({ file, key, value }),
      fetchImpl: async () => ({ ok: true, status: 200 }),
      restartService: (service) => restarts.push(service),
    },
    {
      agent: 'model-agent',
      action: 'model-channel-switch',
      confidence: 'high',
      config: {
        url: 'https://api.longcat.chat/openai/v1',
        apiKey: 'ak-test-secret',
        maskedApiKey: 'ak-tes...cret (14)',
        model: 'LongCat-Flash-Chat',
        simpleModel: 'LongCat-Flash-Lite',
        thinkingModel: 'LongCat-Flash-Thinking-2601',
        endpointMode: 'chat_completions',
        scope: 'current',
      },
      missing: [],
      requiresAuth: true,
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(writes.map((item) => item.key), [
    'FEISHU_CHAT_STREAMING_ENABLED',
    'STREAMING_MODEL_BASE_URL',
    'STREAMING_MODEL_API_KEY',
    'STREAMING_MODEL_ID',
    'STREAMING_MODEL_SIMPLE_ID',
    'STREAMING_MODEL_THINKING_ID',
    'STREAMING_MODEL_ENDPOINT_MODE',
  ]);
  assert.match(reply.replyText, /聊天模型通道配置已写入/);
  assert.match(reply.replyText, /\/v1\/models：通过/);
  assert.deepEqual(restarts, ['hermes-feishu-bridge']);
  assert.doesNotMatch(reply.replyText, /ak-test-secret/);
});

test('buildRoutedAgentReply clarifies medium-confidence chat model config without writing', async () => {
  const writes = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-model-channel-clarify',
          chat_id: 'chat-a',
          content: JSON.stringify({ text: 'url: https://api.longcat.chat/openai/v1 key: ak-test-secret' }),
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
      FEISHU_ENV_FILE: '/etc/test.env',
      FEISHU_ASSISTANT_NAME: 'Hermes',
    },
    {
      envWriter: (file, key, value) => writes.push({ file, key, value }),
    },
    {
      agent: 'model-agent',
      action: 'model-channel-clarify',
      confidence: 'medium',
      config: {
        url: 'https://api.longcat.chat/openai/v1',
        apiKey: 'ak-test-secret',
        maskedApiKey: 'ak-tes...cret (14)',
        model: '',
        simpleModel: '',
        thinkingModel: '',
        endpointMode: 'chat_completions',
        scope: 'current',
      },
      missing: [],
      requiresAuth: true,
    },
  );

  assert.equal(reply.handled, true);
  assert.deepEqual(writes, []);
  assert.match(reply.replyText, /先不替换/);
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

test('sendFeishuTextMessage reuses cached tenant token for the same app', async () => {
  const calls = [];
  const env = {
    FEISHU_APP_ID: `cli_cache_${Date.now()}`,
    FEISHU_APP_SECRET: 'secret_xxx',
  };
  const message = {
    receiveIdType: 'open_id',
    receiveId: 'user-a',
    msgType: 'text',
    content: JSON.stringify({ text: 'hello' }),
  };

  await sendFeishuTextMessage(env, message, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
      return {
        ok: true,
        json: async () => ({
          code: 0,
          tenant_access_token: 'cached-tenant-token',
          expire: 7200,
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({ code: 0 }),
    };
  });

  await sendFeishuTextMessage(env, message, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v3/tenant_access_token/internal')) {
      throw new Error('token endpoint should not be called when cached token is fresh');
    }

    return {
      ok: true,
      json: async () => ({ code: 0 }),
    };
  });

  assert.equal(calls.filter((call) => call.url.endsWith('/auth/v3/tenant_access_token/internal')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/im/v1/messages?')).length, 2);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer cached-tenant-token');
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

test('createServer handles wechat mp verification and text reply', async () => {
  const token = 'wechat-test-token';
  const timestamp = '1710000000';
  const nonce = 'nonce-1';
  const signature = buildWechatSignature(token, timestamp, nonce);
  const server = createServer({
    WECHAT_MP_TOKEN: token,
    WECHAT_MP_ALLOWED_OPENIDS: 'openid-a',
    WECHAT_MP_REPLY_TIMEOUT_MS: '1000',
  }, {
    buildRoutedAgentReply: async () => ({
      handled: true,
      replyText: '服务器状态：正常',
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const verifyResponse = await fetch(`http://127.0.0.1:${port}/webhook/wechat/mp?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=hello`, {
      method: 'GET',
    });

    assert.equal(verifyResponse.status, 200);
    assert.equal(await verifyResponse.text(), 'hello');

    const postResponse = await fetch(`http://127.0.0.1:${port}/webhook/wechat/mp?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: [
        '<xml>',
        '<ToUserName><![CDATA[gh_test]]></ToUserName>',
        '<FromUserName><![CDATA[openid-a]]></FromUserName>',
        '<CreateTime>1710000001</CreateTime>',
        '<MsgType><![CDATA[text]]></MsgType>',
        '<Content><![CDATA[服务器状态]]></Content>',
        '<MsgId>42</MsgId>',
        '</xml>',
      ].join(''),
    });

    assert.equal(postResponse.status, 200);
    const body = await postResponse.text();
    assert.match(body, /服务器状态：正常/);
    assert.match(body, /<!\[CDATA\[text\]\]>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer binds wechat mp openid with bind code', async () => {
  const token = 'wechat-test-token';
  const timestamp = '1710000000';
  const nonce = 'nonce-2';
  const signature = buildWechatSignature(token, timestamp, nonce);
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-mp-env-'));
  const envFile = join(tempDir, 'hermes.env');
  writeFileSync(envFile, 'WECHAT_MP_ALLOWED_OPENIDS=\n', 'utf8');
  const server = createServer({
    WECHAT_MP_TOKEN: token,
    WECHAT_MP_BIND_CODE: 'bind-123',
    WECHAT_MP_ENV_FILE: envFile,
    FEISHU_ENV_FILE: envFile,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const postResponse = await fetch(`http://127.0.0.1:${port}/webhook/wechat/mp?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: [
        '<xml>',
        '<ToUserName><![CDATA[gh_test]]></ToUserName>',
        '<FromUserName><![CDATA[openid-owner]]></FromUserName>',
        '<CreateTime>1710000001</CreateTime>',
        '<MsgType><![CDATA[text]]></MsgType>',
        '<Content><![CDATA[绑定我 bind-123]]></Content>',
        '<MsgId>43</MsgId>',
        '</xml>',
      ].join(''),
    });

    assert.equal(postResponse.status, 200);
    assert.match(await postResponse.text(), /已绑定当前公众号用户/);
    assert.match(readFileSync(envFile, 'utf8'), /WECHAT_MP_ALLOWED_OPENIDS=openid-owner/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
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

test('createServer serves lightweight dashboard HTML', async () => {
  const server = createServer({
    ASSISTANT_NAME: 'Hermes',
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/dashboard`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /OpenClaw\/Hermes 控制台/);
    assert.match(html, /\/api\/dashboard/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer serves dashboard JSON without touching webhook routes', async () => {
  const server = createServer({
    ASSISTANT_NAME: 'Hermes',
    FEISHU_WEBHOOK_ASYNC: 'true',
  }, {
    dashboardState: async () => ({
      ok: true,
      generatedAt: '2026-05-07T00:00:00.000Z',
      assistant: 'Hermes',
      health: { ok: true },
      tasks: {
        counts: { total: 3, today: 2, failed: 1, running: 0, queued: 0, completed: 1, recoverable: 1 },
        byType: [{ type: 'ui-automation', label: 'UI 自动化', today: 1, failed: 1 }],
        latest: { id: 'task-1', type: 'ui-automation', status: 'failed', summary: { text: 'UI smoke failed' } },
      },
      usage: { entries: [{ assistant: 'Hermes', model: 'LongCat-Flash-Chat', totalTokens: 120 }], totalTokens: 120 },
      mail: { todayEntries: [{ action: 'daily', subject: '日报' }], entries: [] },
      pipeline: { status: 'failed', completedStages: 2, totalStages: 4, failedStages: 1 },
      snapshot: { latestRun: { conclusion: 'failure', runUrl: 'https://github.com/example/run' } },
      warnings: [],
    }),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.assistant, 'Hermes');
    assert.equal(body.tasks.counts.total, 3);
    assert.equal(body.usage.totalTokens, 120);
    assert.equal(body.mail.todayEntries.length, 1);
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
    const text = JSON.parse(reply.content).text;
    assert.match(text, /这次我先没执行/);
    assert.match(text, /危险操作/);
    assert.match(text, /重启你自己/);
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

