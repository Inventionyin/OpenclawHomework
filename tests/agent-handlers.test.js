const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildChatAgentPrompt,
  buildClerkAgentReply,
  buildClerkFileChannelReply,
  buildImageChannelReply,
  buildModelChannelReply,
  buildBrowserAgentReply,
  buildMultiIntentPlanReply,
  buildCapabilityGuideReply,
  buildBrainGuideReply,
  buildDocAgentReply,
  buildEcosystemAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildPlannerClarifyReply,
  buildDifyTestingAssistantReply,
  buildQaAgentReply,
  sanitizeReplyField,
} = require('../scripts/agents/agent-handlers');

test('buildCapabilityGuideReply explains practical agent playbook', () => {
  const reply = buildCapabilityGuideReply('OpenClaw');
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /大神版玩法菜单/);
  assert.match(reply, /日常体检/);
  assert.match(reply, /你现在卡不卡/);
  assert.match(reply, /UI 自动化/);
  assert.match(reply, /邮箱\/日报/);
  assert.match(reply, /token 工厂/);
  assert.match(reply, /知识库/);
  assert.match(reply, /互修/);
  assert.match(reply, /测试资产/);
  assert.match(reply, /把报告和截图走文件通道/);
  assert.match(reply, /微信 Bridge 计划/);
  assert.match(reply, /画一张商品主图/);
  assert.match(reply, /电商客服训练数据/);
  assert.match(reply, /日常体检与互修/);
  assert.match(reply, /知识库与长期记忆/);
  assert.match(reply, /邮箱与日报/);
  assert.match(reply, /测试资产工坊/);
});

test('buildBrainGuideReply explains Obsidian and GBrain memory upgrade', () => {
  const reply = buildBrainGuideReply('Hermes');
  assert.match(reply, /Hermes/);
  assert.match(reply, /Obsidian/);
  assert.match(reply, /GBrain/);
  assert.match(reply, /知识库/);
});

test('buildEcosystemAgentReply explains safe plugin installation status', () => {
  const reply = buildEcosystemAgentReply({
    action: 'install-safe',
    target: 'hermes',
  });

  assert.match(reply, /Hermes/);
  assert.match(reply, /GBrain/);
  assert.match(reply, /Hermes WebUI/);
  assert.match(reply, /自检/);
  assert.match(reply, /不会自动执行来路不明脚本/);
});

test('buildPlannerClarifyReply turns vague requests into natural choices', () => {
  const reply = buildPlannerClarifyReply('帮我把项目优化一下');
  assert.match(reply, /我可以继续/);
  assert.match(reply, /自然语言/);
  assert.match(reply, /服务器/);
  assert.match(reply, /UI 自动化/);
});

test('buildMultiIntentPlanReply explains ordered safe sub-intents', () => {
  const reply = buildMultiIntentPlanReply({
    plan: {
      confidence: 'high',
      intents: [
        { agent: 'ops-agent', action: 'load-summary', reason: '看服务器资源' },
        { agent: 'clerk-agent', action: 'task-center-failed', reason: '看失败任务' },
        { agent: 'clerk-agent', action: 'daily-email', reason: '发日报邮件' },
      ],
      blocked: [],
    },
  });

  assert.match(reply, /多意图计划/);
  assert.match(reply, /服务器资源/);
  assert.match(reply, /失败任务/);
  assert.match(reply, /日报邮件/);
  assert.match(reply, /高风险操作/);
});

test('buildBrowserAgentReply renders browser automation dry-run plan', async () => {
  const reply = await buildBrowserAgentReply({
    action: 'protocol-capture-plan',
    rawText: '抓一下 http://localhost:3000/register 登录流程接口，生成接口测试用例',
  });

  assert.match(reply, /浏览器自动化计划/);
  assert.match(reply, /定位结果/);
  assert.match(reply, /当前状态/);
  assert.match(reply, /下一步/);
  assert.match(reply, /localhost:3000/);
  assert.match(reply, /captureNetworkOrProtocol/);
  assert.match(reply, /dry-run/);
});

test('buildBrowserAgentReply renders blocked state naturally', async () => {
  const reply = await buildBrowserAgentReply({
    action: 'browser-dry-run',
    rawText: '打开 https://forbidden.local 看看页面',
  }, {
    browserAutomationRunner: async () => ({
      mode: 'blocked',
      reason: '目标不在允许列表',
      plan: {
        url: 'https://forbidden.local',
        blocked: true,
      },
    }),
  });

  assert.match(reply, /已拦截/);
  assert.match(reply, /定位结果/);
  assert.match(reply, /目标不在允许列表/);
  assert.match(reply, /CTF 靶场地址|自有域名/);
});

test('buildBrowserAgentReply renders live-run mode with injected runner', async () => {
  let received;
  const reply = await buildBrowserAgentReply({
    action: 'browser-live-run',
    rawText: '真的打开浏览器去跑一遍页面检查 https://projectku.local/login',
  }, {
    browserAutomationRunner: async (request) => {
      received = request;
      return {
        mode: 'live-run',
        plan: { url: 'https://projectku.local/login' },
        steps: [
          { type: 'openPage', detail: '打开目标页面' },
          { type: 'captureConsole', detail: '采集 console 错误' },
        ],
      };
    },
  });

  assert.equal(received.dryRun, false);
  assert.match(reply, /live-run/);
  assert.match(reply, /打开目标页面/);
  assert.match(reply, /采集 console 错误/);
});

test('buildBrowserAgentReply forwards live browser dependencies to default runner', async () => {
  const events = { console: [], response: [] };
  const page = {
    on(event, handler) {
      events[event].push(handler);
    },
    async goto(url) {
      for (const handler of events.response) {
        handler({
          url: () => `${url}/api/session`,
          status: () => 200,
          headers: () => ({ 'content-type': 'application/json' }),
          request: () => ({
            method: () => 'GET',
            url: `${url}/api/session`,
          }),
        });
      }
    },
    async screenshot({ path }) {
      this.screenshotPath = path;
    },
    async close() {},
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {},
  };
  const saved = [];

  const reply = await buildBrowserAgentReply({
    action: 'browser-live-run',
    rawText: '真实执行 http://localhost:3000 并截图抓接口',
  }, {
    browserFactory: async () => browser,
    screenshotPath: '/tmp/agent-browser.png',
    protocolAssetSaver: async (asset) => {
      saved.push(asset);
      return { id: 'asset-1', file: '/tmp/protocol-assets/asset-1.json' };
    },
  });

  assert.equal(page.screenshotPath, '/tmp/agent-browser.png');
  assert.equal(saved.length, 1);
  assert.match(reply, /live/);
  assert.match(reply, /接口入库：1/);
  assert.match(reply, /截图：\/tmp\/agent-browser\.png/);
});

test('buildBrowserAgentReply renders protocol asset report with injected reporter', async () => {
  const reply = await buildBrowserAgentReply({
    action: 'protocol-assets-report',
    rawText: '最近抓到哪些接口',
  }, {
    protocolAssetReporter: async (request) => {
      assert.equal(request.query, '最近抓到哪些接口');
      return {
        summary: '最近资产：3 条（登录 2，注册 1）',
        lines: [
          '1. POST /api/login 200',
          '2. GET /api/login/captcha 200',
          '3. POST /api/register 201',
        ],
      };
    },
  });

  assert.match(reply, /协议资产/);
  assert.match(reply, /线索定位/);
  assert.match(reply, /下一步/);
  assert.match(reply, /可直接回复/);
  assert.match(reply, /最近资产：3 条/);
  assert.match(reply, /POST \/api\/login 200/);
});

test('buildBrowserAgentReply renders grouped protocol report from stored assets', async () => {
  const assetDir = mkdtempSync(join(tmpdir(), 'agent-protocol-assets-'));
  try {
    writeFileSync(join(assetDir, 'asset-login.json'), JSON.stringify({
      id: 'asset-login',
      createdAt: '2026-05-07T10:03:00.000Z',
      method: 'POST',
      url: 'https://shop.evanshine.me/api/login',
      status: 401,
      tags: ['auth', 'login'],
      summaryText: 'Login failed',
    }));
    writeFileSync(join(assetDir, 'asset-order.json'), JSON.stringify({
      id: 'asset-order',
      createdAt: '2026-05-07T10:02:00.000Z',
      method: 'POST',
      url: 'https://api.evanshine.me/api/order',
      status: 500,
      tags: ['order'],
      summaryText: 'Create order failed',
    }));

    const reply = await buildBrowserAgentReply({
      action: 'protocol-assets-report',
      rawText: '最近抓到哪些接口',
    }, {
      env: { PROTOCOL_ASSET_DIR: assetDir },
    });

    assert.match(reply, /按域名/);
    assert.match(reply, /shop\.evanshine\.me=1/);
    assert.match(reply, /api\.evanshine\.me=1/);
    assert.match(reply, /异常优先排查/);
    assert.match(reply, /POST shop\.evanshine\.me\/api\/login 401/);
    assert.match(reply, /POST api\.evanshine\.me\/api\/order 500/);
    assert.match(reply, /可直接回复：把最近抓到的接口整理成测试用例/);
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test('buildBrowserAgentReply renders protocol assets as reusable test cases', async () => {
  const reply = await buildBrowserAgentReply({
    action: 'protocol-assets-to-tests',
    rawText: '把最近抓到的接口整理成测试用例',
  }, {
    protocolTestCaseBuilder: async (request) => {
      assert.equal(request.query, '把最近抓到的接口整理成测试用例');
      return {
        totalAssets: 2,
        cases: [
          {
            name: 'POST /api/login should return 200',
            method: 'POST',
            path: '/api/login',
            expectedStatus: 200,
            sourceAssetId: 'pa-login',
          },
          {
            name: 'GET /api/session should return 200',
            method: 'GET',
            path: '/api/session',
            expectedStatus: 200,
            sourceAssetId: 'pa-session',
          },
        ],
        savedFile: '/tmp/protocol-test-cases.json',
      };
    },
  });

  assert.match(reply, /协议资产已整理成测试用例/);
  assert.match(reply, /共生成 2 条/);
  assert.match(reply, /POST \/api\/login -> 200/);
  assert.match(reply, /保存：\/tmp\/protocol-test-cases\.json/);
});

test('buildClerkAgentReply summarizes token usage from ledger lines', () => {
  const reply = buildClerkAgentReply({
    action: 'token-summary',
  }, {
    readUsageLedger: () => [
      {
        assistant: 'Hermes',
        model: 'LongCat-Flash-Chat',
        totalTokens: 30,
        modelElapsedMs: 1000,
      },
      {
        assistant: 'OpenClaw',
        model: 'astron-code-latest',
        totalTokens: 20,
        modelElapsedMs: 2000,
      },
      {
        assistant: 'Hermes',
        model: 'LongCat-Flash-Lite',
        usageMissing: true,
        tokenSource: 'estimated_chars',
        estimatedTotalTokens: 42,
        modelElapsedMs: 3000,
      },
    ],
  });

  assert.match(reply, /文员统计/);
  assert.match(reply, /Hermes/);
  assert.match(reply, /30/);
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /20/);
  assert.match(reply, /未返回 token/);
  assert.match(reply, /约 42 tokens/);
});

test('buildClerkAgentReply does not claim token winner when every entry lacks usage', () => {
  const reply = buildClerkAgentReply({
    action: 'token-summary',
  }, {
    readUsageLedger: () => [
      {
        assistant: 'Hermes',
        model: 'LongCat-Flash-Lite',
        usageMissing: true,
        tokenSource: 'estimated_chars',
        estimatedTotalTokens: 42,
        modelElapsedMs: 3000,
      },
    ],
  });

  assert.match(reply, /未返回 token/);
  assert.match(reply, /字符估算/);
  assert.doesNotMatch(reply, /token 用量最高/);
});

test('buildClerkAgentReply filters token summary by yesterday range', () => {
  const reply = buildClerkAgentReply({
    action: 'token-summary',
    dayRange: 'yesterday',
  }, {
    now: new Date('2026-05-09T01:00:00.000Z'),
    env: { MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES: '480' },
    readUsageLedger: () => [
      {
        timestamp: '2026-05-08T02:00:00.000Z',
        assistant: 'Hermes',
        model: 'LongCat-Flash-Chat',
        totalTokens: 88,
        modelElapsedMs: 1000,
      },
      {
        timestamp: '2026-05-09T02:00:00.000Z',
        assistant: 'OpenClaw',
        model: 'astron-code-latest',
        totalTokens: 20,
        modelElapsedMs: 1000,
      },
    ],
  });

  assert.match(reply, /昨天/);
  assert.match(reply, /1 次/);
  assert.match(reply, /Hermes/);
  assert.match(reply, /88 tokens/);
  assert.doesNotMatch(reply, /OpenClaw/);
});

test('buildClerkAgentReply keeps todo summary behavior in the handler', () => {
  const todoReply = buildClerkAgentReply({ action: 'todo-summary' }, {
    summarizeDailyPlan: () => ({
      todaySummaryText: '今天任务 5 个，完成 2 个，失败 1 个，运行中 2 个。',
      tomorrowPlan: [
        '优先复盘失败任务：新闻摘要 news-1。',
        '恢复中断或超时任务：token 工厂 tf-1。',
      ],
    }),
  });
  assert.match(todoReply, /待办/);
  assert.match(todoReply, /今天任务 5 个/);
  assert.match(todoReply, /优先复盘失败任务/);
  assert.match(todoReply, /不会重启/);
});

test('buildClerkAgentReply delegates command center requests to clerk command center module', () => {
  const route = { action: 'command-center', rawText: '文员，打开任务中枢' };
  const options = {
    clerkCommandCenter: {
      buildClerkCommandCenterReply: (receivedRoute, receivedOptions) => {
        assert.equal(receivedRoute, route);
        assert.equal(receivedOptions, options);
        return 'command center delegated';
      },
    },
  };

  assert.equal(buildClerkAgentReply(route, options), 'command center delegated');
});

test('buildClerkAgentReply delegates daily report requests to clerk command center module', () => {
  const route = { action: 'daily-report', rawText: '文员，生成今日日报' };
  const options = {
    clerkCommandCenter: {
      buildClerkDailyReportReply: (receivedRoute, receivedOptions) => {
        assert.equal(receivedRoute, route);
        assert.equal(receivedOptions, options);
        return 'daily report delegated';
      },
    },
  };

  assert.equal(buildClerkAgentReply(route, options), 'daily report delegated');
});

test('buildClerkAgentReply passes daily report artifacts options to delegated module', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'clerk-daily-preview-'));
  const ledgerFile = join(tempDir, 'usage.jsonl');
  const stateFile = join(tempDir, 'daily-state.json');
  const multiAgentDir = join(tempDir, 'multi-agent-lab');

  try {
    mkdirSync(multiAgentDir, { recursive: true });
    writeFileSync(ledgerFile, [
      JSON.stringify({ assistant: 'Hermes', totalTokens: 66, modelElapsedMs: 3000 }),
      JSON.stringify({ assistant: 'OpenClaw', totalTokens: 33, modelElapsedMs: 1500 }),
    ].join('\n'), 'utf8');

    writeFileSync(stateFile, `${JSON.stringify({
      runs: [
        {
          conclusion: 'success',
          runUrl: 'https://example.com/run-1',
          artifactsUrl: 'https://example.com/run-1#artifacts',
          targetRef: 'main',
          runMode: 'smoke',
        },
      ],
    }, null, 2)}\n`, 'utf8');

    writeFileSync(join(multiAgentDir, 'summary.json'), `${JSON.stringify({
      totalItems: 3,
      failedJobs: 0,
      winner: 'OpenClaw',
      totalTokens: 300,
    }, null, 2)}\n`, 'utf8');

    const route = { action: 'daily-report' };
    const options = {
      env: {
        FEISHU_USAGE_LEDGER_PATH: ledgerFile,
        DAILY_SUMMARY_STATE_FILE: stateFile,
        MULTI_AGENT_LAB_OUTPUT_DIR: multiAgentDir,
      },
      readDailySummarySnapshot: () => ({
        runs: [
          {
            conclusion: 'success',
            runUrl: 'https://example.com/run-1',
            artifactsUrl: 'https://example.com/run-1#artifacts',
            targetRef: 'main',
            runMode: 'smoke',
          },
        ],
      }),
      clerkCommandCenter: {
        buildClerkDailyReportReply: (receivedRoute, receivedOptions) => {
          assert.equal(receivedRoute, route);
          assert.equal(receivedOptions.env.FEISHU_USAGE_LEDGER_PATH, ledgerFile);
          assert.equal(receivedOptions.env.DAILY_SUMMARY_STATE_FILE, stateFile);
          assert.equal(receivedOptions.env.MULTI_AGENT_LAB_OUTPUT_DIR, multiAgentDir);
          assert.equal(typeof receivedOptions.readDailySummarySnapshot, 'function');
          return 'daily report delegated with artifacts';
        },
      },
    };

    const reportReply = buildClerkAgentReply(route, options);

    assert.equal(reportReply, 'daily report delegated with artifacts');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildClerkAgentReply leaves snapshot handling to delegated daily report module', () => {
  const route = { action: 'daily-report' };
  const options = {
    readDailySummarySnapshot: () => {
      throw new Error('broken snapshot');
    },
    summarizeDailyPlan: () => ({
      todaySummaryText: '今天任务 3 个，完成 1 个，失败 1 个，运行中 1 个。',
      tomorrowPlan: [
        '优先复盘失败任务：token 工厂 tf-x。',
      ],
    }),
    readUsageLedger: () => [],
    clerkCommandCenter: {
      buildClerkDailyReportReply: (receivedRoute, receivedOptions) => {
        assert.equal(receivedRoute, route);
        assert.equal(receivedOptions, options);
        return 'daily report delegated after snapshot setup';
      },
    },
  };

  assert.equal(buildClerkAgentReply(route, options), 'daily report delegated after snapshot setup');
});

test('buildClerkAgentReply shows practical workbench with mailbox and qa assets', () => {
  const reply = buildClerkAgentReply({ action: 'workbench' }, {
    readUsageLedger: () => [
      { assistant: 'Hermes', model: 'LongCat', totalTokens: 100, modelElapsedMs: 500 },
    ],
  });

  assert.match(reply, /文员工作台/);
  assert.match(reply, /agent4\.daily@claw\.163\.com/);
  assert.match(reply, /电商客服训练数据/);
  assert.match(reply, /token/);
});

test('buildClerkAgentReply explains real mailbox workbench bindings', () => {
  const reply = buildClerkAgentReply({ action: 'mailbox-workbench' }, {
    readInboxMessages: () => [
      {
        uid: 'm-1',
        from: 'student@example.com',
        subject: '应届生求职咨询',
        text: '我是大四应届毕业生，可以应聘吗？',
      },
    ],
    readMailLedger: () => [],
    now: new Date('2026-05-07T12:00:00.000Z'),
  });
  assert.match(reply, /邮箱工作台/);
  assert.match(reply, /ClawEmail/);
  assert.match(reply, /待审批 1 封/);
  assert.match(reply, /watchee\.ui@claw\.163\.com/);
  assert.match(reply, /evasan\.account@claw\.163\.com/);
  assert.match(reply, /agent4\.archive@claw\.163\.com/);
  assert.match(reply, /子邮箱/);
  assert.match(reply, /注册验证码测试/);
});

test('buildClerkAgentReply lists mailbox approvals from workbench state', () => {
  const reply = buildClerkAgentReply({ action: 'mailbox-approvals' }, {
    readInboxMessages: () => [
      {
        uid: 'm-1',
        from: 'buyer@example.com',
        subject: '退款处理',
        text: '我要退款',
      },
    ],
    readMailLedger: () => [],
    now: new Date('2026-05-07T12:00:00.000Z'),
  });

  assert.match(reply, /待审批邮件/);
  assert.match(reply, /退款处理/);
  assert.match(reply, /审批第 1 封/);
  assert.match(reply, /默认不会自动批准/);
});

test('buildClerkAgentReply handles mailbox approval action', () => {
  const reply = buildClerkAgentReply({
    action: 'mailbox-approval-action',
    approvalAction: 'approve',
    index: 1,
  }, {
    readInboxMessages: () => [
      {
        uid: 'm-1',
        from: 'buyer@example.com',
        subject: '退款处理',
        text: '我要退款',
      },
    ],
    readMailLedger: () => [],
    now: new Date('2026-05-07T12:00:00.000Z'),
    env: {
      LOCAL_PROJECT_DIR: '/tmp/openclaw-homework-test',
      MAIL_APPROVAL_QUEUE_FILE: '/tmp/openclaw-homework-test/mail-approval-queue.json',
    },
  });

  assert.match(reply, /已审批第 1 封/);
  assert.match(reply, /不会自动对外发信/);
});

test('buildClerkAgentReply renders ClawEmail daily report preview', () => {
  const reply = buildClerkAgentReply({ action: 'mailbox-daily-report' }, {
    readInboxMessages: () => [
      {
        uid: 'm-1',
        from: 'partner@example.com',
        subject: '商务合作咨询',
        text: '想和你们合作做测试平台。',
      },
    ],
    readMailLedger: () => [
      {
        timestamp: '2026-05-07T01:00:00.000Z',
        assistant: 'Hermes',
        action: 'daily',
        sent: true,
        externalTo: ['1693457391@qq.com'],
      },
    ],
    env: { FEISHU_ASSISTANT_NAME: 'Hermes' },
    now: new Date('2026-05-07T12:00:00.000Z'),
  });

  assert.match(reply, /ClawEmail 每日报告/);
  assert.match(reply, /收信 1 封/);
  assert.match(reply, /成功发信 1 封/);
  assert.match(reply, /发送今天日报到邮箱/);
});

test('buildClerkAgentReply explains file channel workbench', () => {
  const reply = buildClerkAgentReply({ action: 'file-channel-workbench' }, {
    env: { FILE_CHANNEL_ROOT: '/tmp/file-channel' },
    listFiles: () => [
      {
        id: 'file-1',
        name: 'allure.zip',
        relativePath: 'reports/allure.zip',
        source: 'wechat-bridge',
      },
    ],
  });

  assert.match(reply, /文件通道工作台/);
  assert.match(reply, /\/tmp\/file-channel/);
  assert.match(reply, /微信 Bridge/);
  assert.match(reply, /allure\.zip/);
});

test('buildClerkFileChannelReply handles empty file channel', () => {
  const reply = buildClerkFileChannelReply({ FILE_CHANNEL_ROOT: '/tmp/file-channel' }, {
    listFiles: () => [],
  });

  assert.match(reply, /文件通道工作台/);
  assert.match(reply, /暂无登记/);
});

test('buildClerkAgentReply explains safe submailbox registration playbook', () => {
  const reply = buildClerkAgentReply({ action: 'mailbox-registration-playbook' });
  assert.match(reply, /子邮箱注册测试/);
  assert.match(reply, /测试账号池/);
  assert.match(reply, /evasan\.account@claw\.163\.com/);
  assert.match(reply, /不要批量注册/);
  assert.match(reply, /真实平台/);
});

test('buildClerkAgentReply creates verification test plan from mailbox bindings', () => {
  const reply = buildClerkAgentReply({ action: 'verification-test-plan' });
  assert.match(reply, /注册验证码测试计划/);
  assert.match(reply, /evasan\.account@claw\.163\.com/);
  assert.match(reply, /验证码有效期/);
  assert.match(reply, /错误验证码/);
  assert.match(reply, /Playwright|Cypress/);
});

test('buildClerkAgentReply returns platform registration dry-run plan', () => {
  const reply = buildClerkAgentReply({
    action: 'platform-registration-runner',
    rawText: '文员，用 verify 邮箱给 projectku-web 跑一轮注册验证码测试',
  });
  assert.match(reply, /projectku-web/);
  assert.match(reply, /dry-run/);
  assert.match(reply, /evasan\.account@claw\.163\.com/);
  assert.match(reply, /打开 projectku-web 注册页/);
});

test('buildClerkAgentReply lists today mailbox tasks without sending mail', () => {
  const reply = buildClerkAgentReply({ action: 'mailbox-tasks' });
  assert.match(reply, /今天邮箱任务队列/);
  assert.match(reply, /待执行/);
  assert.match(reply, /不自动发送/);
  assert.match(reply, /agent4\.daily@claw\.163\.com/);
});

test('buildClerkAgentReply summarizes recent mail ledger entries', () => {
  const reply = buildClerkAgentReply({ action: 'mail-ledger' }, {
    now: new Date('2026-05-06T12:00:00.000Z'),
    readMailLedger: () => [
      {
        timestamp: '2026-05-06T00:02:03.000Z',
        assistant: 'Hermes',
        action: 'daily',
        provider: 'evanshine',
        sent: true,
        subject: '[Daily Summary] 自动化测试日报',
        externalTo: ['1693457391@qq.com'],
        archiveTo: ['agent4.daily@claw.163.com'],
      },
    ],
  });

  assert.match(reply, /邮件发送账本/);
  assert.match(reply, /Hermes/);
  assert.match(reply, /daily/);
  assert.match(reply, /1693457391@qq.com/);
});

test('buildClerkAgentReply turns training data into a clerk workflow', () => {
  const reply = buildClerkAgentReply({ action: 'training-data' });
  assert.match(reply, /电商客服训练数据/);
  assert.match(reply, /144/);
  assert.match(reply, /agent4\.archive@claw\.163\.com/);
});

test('buildClerkAgentReply explains token lab before execution', () => {
  const reply = buildClerkAgentReply({ action: 'token-lab' });
  assert.match(reply, /高 token 训练场/);
  assert.match(reply, /LongCat/);
  assert.match(reply, /archive/);
  assert.match(reply, /eval/);
});

test('buildClerkAgentReply explains trend intel and token factory', () => {
  const intelReply = buildClerkAgentReply({ action: 'trend-intel' });
  assert.match(intelReply, /开源热榜/);
  assert.match(intelReply, /GitHub/);
  assert.match(intelReply, /Hacker News/);
  assert.match(intelReply, /我来给你盯今天的开源热榜/);

  const factoryReply = buildClerkAgentReply({ action: 'trend-token-factory' });
  assert.match(factoryReply, /趋势 token 工厂/);
  assert.match(factoryReply, /热门项目/);
  assert.match(factoryReply, /UI 自动化/);
  assert.match(factoryReply, /客服训练数据/);
  assert.match(factoryReply, /研究助理/);
});

test('buildClerkAgentReply explains token factory full workflow naturally', () => {
  const reply = buildClerkAgentReply({ action: 'token-factory' });
  assert.match(reply, /token/);
  assert.match(reply, /训练数据/);
  assert.match(reply, /token lab/i);
  assert.match(reply, /多 Agent 评审/);
  assert.match(reply, /邮箱归档/);
  assert.match(reply, /日报沉淀/);
});

test('buildClerkAgentReply summarizes token factory task center status', () => {
  const reply = buildClerkAgentReply({ action: 'token-factory-status' }, {
    summarizeTasks: () => ({
      counts: { total: 6, today: 2, running: 1, failed: 1, recoverable: 2 },
      latest: { id: 'tf-1', status: 'running' },
    }),
  });
  assert.match(reply, /任务中枢/);
  assert.match(reply, /总任务：6/);
  assert.match(reply, /可恢复：2/);
  assert.match(reply, /tf-1/);
});

test('buildClerkAgentReply supports today and failed task center views', () => {
  const todayReply = buildClerkAgentReply({ action: 'task-center-today' }, {
    listTodayTasks: () => [
      { id: 'tf-a', status: 'queued', updatedAt: '2026-05-06T01:00:00.000Z' },
    ],
  });
  assert.match(todayReply, /任务中枢（今天/);
  assert.match(todayReply, /tf-a/);

  const failedReply = buildClerkAgentReply({ action: 'task-center-failed' }, {
    listFailedTasks: () => [
      { id: 'tf-fail', updatedAt: '2026-05-06T02:00:00.000Z', error: 'quota exhausted' },
    ],
  });
  assert.match(failedReply, /失败任务/);
  assert.match(failedReply, /tf-fail/);
  assert.match(failedReply, /quota exhausted/);
});

test('buildClerkAgentReply delegates daily pipeline starts to injected runner', () => {
  const route = { action: 'daily-pipeline', rawText: '文员，启动今天的自动流水线' };
  const reply = buildClerkAgentReply(route, {
    runDailyPipeline: (request) => {
      assert.equal(request.route, route);
      assert.equal(request.dryRun, false);
      return {
        accepted: true,
        taskId: 'dp-1',
        mode: 'run',
        steps: ['整理任务中枢', '生成日报草稿'],
      };
    },
  });

  assert.match(reply, /每日流水线/);
  assert.match(reply, /已委托/);
  assert.match(reply, /dp-1/);
  assert.match(reply, /整理任务中枢/);
});

test('buildClerkAgentReply passes dry-run mode to daily pipeline runner', () => {
  const reply = buildClerkAgentReply({
    action: 'daily-pipeline',
    dryRun: true,
    rawText: '文员，试跑今天的自动流水线',
  }, {
    runDailyPipeline: (request) => {
      assert.equal(request.dryRun, true);
      return {
        accepted: true,
        taskId: 'dp-dry',
        mode: 'dry-run',
        steps: ['检查触发条件'],
      };
    },
  });

  assert.match(reply, /试跑|dry-run/i);
  assert.match(reply, /dp-dry/);
  assert.match(reply, /检查触发条件/);
});

test('buildClerkAgentReply summarizes daily pipeline status from injected helper', () => {
  const reply = buildClerkAgentReply({ action: 'daily-pipeline-status' }, {
    summarizeDailyPipeline: (request) => {
      assert.equal(request.type, 'daily-pipeline');
      return {
        day: '2026-05-06',
        counts: { total: 4, today: 2, running: 1, failed: 1, recoverable: 1 },
        latest: { id: 'dp-latest', status: 'running' },
        totalStages: 4,
        completedStages: 3,
        failedStages: 1,
        failedStageIds: ['scheduled-ui'],
        stageStatuses: [
          { id: 'news-digest', status: 'completed' },
          { id: 'scheduled-ui', status: 'failed', reason: 'runner_failed' },
        ],
        failureDiagnosis: 'scheduled-ui 失败：runner_failed。',
        nextAction: '先修复 scheduled-ui，再说：文员，启动今天的自动流水线。',
      };
    },
  });

  assert.match(reply, /每日流水线状态/);
  assert.match(reply, /总任务：4/);
  assert.match(reply, /今天任务：2/);
  assert.match(reply, /失败：1/);
  assert.match(reply, /dp-latest/);
  assert.match(reply, /阶段进度/);
  assert.match(reply, /scheduled-ui/);
  assert.match(reply, /失败诊断/);
  assert.match(reply, /下一步/);
});

test('buildClerkAgentReply delegates WeChat MP article publishing', async () => {
  const reply = await buildClerkAgentReply({
    action: 'wechat-mp-direct-publish',
    idea: '今天白嫖福利和 API 中转站推荐',
  }, {
    publishWechatMpArticle: async (request) => {
      assert.equal(request.mode, 'direct');
      assert.equal(request.idea, '今天白嫖福利和 API 中转站推荐');
      return {
        ok: true,
        mode: 'direct',
        title: '今日 API 中转站和白嫖福利观察',
        mediaId: 'draft-media-1',
        publishId: 'publish-1',
      };
    },
  });

  assert.match(reply, /公众号文章/);
  assert.match(reply, /已提交发布/);
  assert.match(reply, /publish-1/);
});

test('buildClerkAgentReply explains WeChat MP publisher failures', async () => {
  const reply = await buildClerkAgentReply({
    action: 'wechat-mp-draft',
    idea: '测试文章',
  }, {
    publishWechatMpArticle: async () => {
      throw new Error('wechat api failed: invalid credential');
    },
  });

  assert.match(reply, /公众号文章处理失败/);
  assert.match(reply, /invalid credential/);
});

test('buildClerkAgentReply keeps summarizeTasks fallback for daily pipeline status', () => {
  const reply = buildClerkAgentReply({ action: 'daily-pipeline-status' }, {
    summarizeTasks: (request) => {
      assert.equal(request.type, 'daily-pipeline');
      return {
        counts: { total: 1, today: 1, running: 0, failed: 0, recoverable: 0 },
        latest: { id: 'legacy-dp', status: 'completed' },
      };
    },
  });

  assert.match(reply, /每日流水线状态/);
  assert.match(reply, /总任务：1/);
  assert.match(reply, /legacy-dp/);
});

test('buildClerkAgentReply supports continue yesterday suggestion', () => {
  const reply = buildClerkAgentReply({ action: 'task-center-continue-yesterday' }, {
    summarizeTasks: () => ({
      counts: { recoverable: 1, failed: 2 },
      latest: { id: 'tf-z', status: 'interrupted' },
    }),
  });
  assert.match(reply, /继续昨天任务建议/);
  assert.match(reply, /可恢复任务：1/);
  assert.match(reply, /tf-z/);
});

test('buildClerkAgentReply continues from task center context and trend radar', () => {
  const reply = buildClerkAgentReply({ action: 'continue-context', rawText: '文员，继续吧' }, {
    summarizeTaskCenterBrain: () => ({
      today: { summaryText: '今天任务 4 个，完成 2 个，失败 1 个。' },
      failureReview: { summaryText: '最近失败任务 1 个：scheduled-ui。' },
      nextPlan: {
        items: ['先修 scheduled-ui', '再跑趋势 token 工厂'],
        quickCommands: ['文员，查看失败任务', '文员，烧 token 分析今天 GitHub 热门项目'],
      },
    }),
    readTrendIntelReport: () => ({
      learningRadar: {
        items: [
          {
            projectName: 'microsoft/playwright',
            usefulFor: 'UI 自动化',
            nextStep: '看 README / 跑 demo / 借鉴测试用例',
          },
        ],
      },
    }),
  });

  assert.match(reply, /我按最近上下文继续/);
  assert.match(reply, /今天任务 4 个/);
  assert.match(reply, /scheduled-ui/);
  assert.match(reply, /microsoft\/playwright/);
  assert.match(reply, /先修 scheduled-ui/);
  assert.match(reply, /文员，查看失败任务/);
});

test('buildClerkAgentReply redacts secret-like trend radar fields while continuing context', () => {
  const reply = buildClerkAgentReply({ action: 'continue-context' }, {
    summarizeTaskCenterBrain: () => ({
      today: { summaryText: '今天任务 1 个。' },
      failureReview: { summaryText: '暂无失败任务。' },
      nextPlan: { items: [], quickCommands: [] },
    }),
    readTrendIntelReport: () => ({
      learningRadar: {
        items: [
          {
            projectName: 'sk-proj-secret123456789',
            usefulFor: 'UI 自动化',
            nextStep: '把 Authorization: Bearer abc.def.secret 写进报告',
          },
        ],
      },
    }),
  });

  assert.match(reply, /\[redacted secret-like output\]/);
  assert.doesNotMatch(reply, /sk-proj-secret123456789/);
  assert.doesNotMatch(reply, /abc\.def\.secret/);
});

test('buildClerkAgentReply renders task center brain summary', () => {
  const reply = buildClerkAgentReply({ action: 'task-center-brain' }, {
    summarizeTaskCenterBrain: () => ({
      today: { summaryText: '今天任务 4 个，完成 2 个，失败 1 个。' },
      history: { summaryText: '近 7 天历史任务 18 个。' },
      failureReview: { summaryText: '最近失败任务 2 个。' },
      nextPlan: {
        items: ['先复盘失败任务', '再补一轮 UI 自动化'],
        quickCommands: ['文员，查看失败任务', '文员，启动今天的自动流水线'],
      },
    }),
  });

  assert.match(reply, /任务中枢主控脑/);
  assert.match(reply, /今日/);
  assert.match(reply, /历史/);
  assert.match(reply, /失败复盘/);
  assert.match(reply, /下一步计划/);
});

test('buildClerkAgentReply renders task center brain with pipeline and safe fallback', () => {
  const reply = buildClerkAgentReply({ action: 'task-center-brain' }, {
    summarizeTaskCenterBrain: () => ({
      today: { summaryText: '今日 UI 任务 1 个。' },
      history: { summaryText: '近 7 天历史任务 8 个。' },
      failureReview: {
        summaryText: '最近失败集中在 scheduled-ui。',
        items: [{ id: 'ui-fail', type: 'ui-automation', error: 'runner_failed' }],
      },
      nextPlan: {
        items: ['先修复 scheduled-ui。'],
        quickCommands: ['文员，启动今天的自动流水线'],
      },
    }),
    summarizeDailyPipeline: () => ({
      day: '2026-05-07',
      totalStages: 4,
      completedStages: 3,
      failedStages: 1,
      failedStageIds: ['scheduled-ui'],
      nextAction: '先修复 scheduled-ui，再重跑每日流水线。',
    }),
  });

  assert.match(reply, /当前卡点/);
  assert.match(reply, /ui-fail/);
  assert.match(reply, /每日流水线：2026-05-07，3\/4 阶段完成，失败 1/);
  assert.match(reply, /先修复 scheduled-ui，再重跑每日流水线/);
});

test('buildClerkAgentReply task center brain degrades invalid data safely', () => {
  const reply = buildClerkAgentReply({ action: 'task-center-brain' }, {
    summarizeTaskCenterBrain: () => {
      throw new Error('brain broken');
    },
    summarizeDailyPipeline: () => 'bad pipeline',
  });

  assert.match(reply, /任务中枢主控脑/);
  assert.match(reply, /暂无/);
  assert.match(reply, /降级提示：task_center_brain_unavailable/);
});

test('buildClerkAgentReply explains multi-agent lab before execution', () => {
  const reply = buildClerkAgentReply({ action: 'multi-agent-lab' });
  assert.match(reply, /多 Agent 训练场/);
  assert.match(reply, /生成/);
  assert.match(reply, /评审/);
  assert.match(reply, /总结/);
  assert.match(reply, /archive/);
  assert.match(reply, /eval/);
  assert.match(reply, /report/);
});

test('buildImageChannelReply redacts key and explains confidence', () => {
  const switchReply = buildImageChannelReply({
    action: 'image-channel-switch',
    confidence: 'high',
    config: {
      url: 'https://img2.suneora.com',
      maskedApiKey: 'sk-ep1...BxKP (35)',
      model: 'auto',
      size: '1024x1024',
      scope: 'both',
    },
  });
  assert.match(switchReply, /切换生图通道/);
  assert.match(switchReply, /sk-ep1\.\.\.BxKP/);
  assert.doesNotMatch(switchReply, /sk-ep1cS_k4u0Jw/);

  const clarifyReply = buildImageChannelReply({
    action: 'image-channel-clarify',
    confidence: 'low',
    missing: ['url'],
    config: {
      maskedApiKey: 'sk...7',
    },
  });
  assert.match(clarifyReply, /先不替换/);
  assert.match(clarifyReply, /缺少字段：url/);
});

test('buildModelChannelReply redacts key and explains confidence', () => {
  const switchReply = buildModelChannelReply({
    action: 'model-channel-switch',
    confidence: 'high',
    config: {
      url: 'https://api.longcat.chat/openai/v1',
      maskedApiKey: 'ak_20x...j57V (36)',
      model: 'LongCat-Flash-Chat',
      simpleModel: 'LongCat-Flash-Lite',
      thinkingModel: 'LongCat-Flash-Thinking-2601',
      endpointMode: 'chat_completions',
    },
  });
  assert.match(switchReply, /切换聊天模型通道/);
  assert.match(switchReply, /LongCat-Flash-Chat/);
  assert.match(switchReply, /ak_20x\.\.\.j57V/);
  assert.doesNotMatch(switchReply, /ak_20x19J9ZP74X02t1yW9tp4bJ3j57V/);

  const clarifyReply = buildModelChannelReply({
    action: 'model-channel-clarify',
    confidence: 'low',
    missing: ['url'],
    config: {
      maskedApiKey: 'ak...7',
    },
  });
  assert.match(clarifyReply, /先不替换/);
  assert.match(clarifyReply, /缺少字段：url/);
});

test('buildDocAgentReply answers project progress from memory', () => {
  const memoryContext = [
    '# Memory Context',
    'GitHub Actions workflow_dispatch triggers UI automation',
    'Watchdog timers check bridge health',
  ].join('\n');

  const reply = buildDocAgentReply('老师任务还差哪些', memoryContext);
  assert.match(reply, /已完成/);
  assert.match(reply, /GitHub Actions/);
  assert.match(reply, /watchdog/i);
});

test('buildMemoryAgentReply shows memory context', () => {
  const reply = buildMemoryAgentReply({ action: 'show' }, '# Memory Context\nOpenClaw 已部署');
  assert.match(reply, /当前记忆摘要/);
  assert.match(reply, /OpenClaw/);
});

test('buildMemoryAgentReply explains brain-guide action', () => {
  const reply = buildMemoryAgentReply({ action: 'brain-guide' }, '', {
    assistantName: 'OpenClaw',
  });
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /Obsidian/);
  assert.match(reply, /GBrain/);
});

test('buildMemoryAgentReply supports keyword search', () => {
  const reply = buildMemoryAgentReply({ action: 'search', query: 'session lock' }, '', {
    searchMemoryContext: () => '# 记忆检索结果\n\n- session lock 已修复',
  });
  assert.match(reply, /记忆检索结果/);
  assert.match(reply, /session lock/);
});

test('buildMemoryAgentReply supports GBrain search action', async () => {
  const reply = await buildMemoryAgentReply({ action: 'brain-search', query: 'LongCat 模型分工' }, '', {
    brainSearch: async (query) => [
      '# GBrain 检索结果',
      '',
      `- docs/openclawhermesgbrain ${query}：OpenClaw 使用讯飞，Hermes 使用 LongCat。`,
    ].join('\n'),
  });

  assert.match(reply, /GBrain 检索结果/);
  assert.match(reply, /LongCat/);
});

test('buildMemoryAgentReply falls back when GBrain search is unavailable', async () => {
  const reply = await buildMemoryAgentReply({ action: 'brain-search', query: 'session lock' }, '', {
    brainSearch: async () => {
      throw new Error('gbrain missing');
    },
    searchMemoryContext: () => '# 记忆检索结果\n\n- runbook-notes.md session lock 已修复',
  });

  assert.match(reply, /GBrain 暂时不可用/);
  assert.match(reply, /记忆检索结果/);
});

test('buildMemoryAgentReply stores safe note', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-handler-test-'));
  try {
    const file = join(tempDir, 'runbook-notes.md');
    writeFileSync(file, '# Runbook Notes\n', 'utf8');
    const reply = buildMemoryAgentReply({ action: 'remember', note: 'OpenClaw 已加串行队列' }, '', {
      noteFile: file,
    });
    assert.match(reply, /已记住/);
    assert.match(readFileSync(file, 'utf8'), /OpenClaw 已加串行队列/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryAgentReply rejects secret-like notes', () => {
  assert.match(
    buildMemoryAgentReply({ action: 'remember', note: 'GITHUB_TOKEN=ghp_example' }, ''),
    /不能保存疑似密钥/,
  );
});

test('buildQaAgentReply answers customer service training requests naturally', () => {
  const reply = buildQaAgentReply({
    action: 'customer-service-data',
  });

  assert.match(reply, /电商客服训练数据/);
  assert.match(reply, /144/);
  assert.match(reply, /customer-service-cases\.json/);
  assert.doesNotMatch(reply, /\/status/);
});

test('buildDifyTestingAssistantReply formats remote answer', () => {
  const reply = buildDifyTestingAssistantReply(
    { action: 'dify-testing-assistant', query: '请根据需求生成测试用例' },
    { ok: true, mode: 'remote', answer: '测试目标：验证登录。' },
  );

  assert.match(reply, /Dify 测试助理结果/);
  assert.match(reply, /测试目标：验证登录/);
  assert.match(reply, /OpenClaw/);
});

test('buildDifyTestingAssistantReply formats fallback without leaking secrets', () => {
  const reply = buildDifyTestingAssistantReply(
    { action: 'dify-testing-assistant', query: '请根据需求生成测试用例' },
    {
      ok: false,
      mode: 'fallback',
      reason: 'error',
      message: 'Dify error with [REDACTED]',
      config: { apiKey: '[REDACTED]' },
    },
  );

  assert.match(reply, /Dify 测试助理暂不可用/);
  assert.match(reply, /测试目标/);
  assert.match(reply, /测试用例/);
  assert.match(reply, /改进建议/);
  assert.doesNotMatch(reply, /app-/);
  assert.doesNotMatch(reply, /secret/);
});

test('buildOpsAgentReply formats whitelisted check results', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234 test commit',
      };
    },
  });

  assert.match(reply, /openclaw-feishu-bridge/);
  assert.match(reply, /active/);
  assert.match(reply, /abc1234/);
  assert.equal(receivedAction, 'status');
});

test('buildOpsAgentReply renders friendly summary replies', async () => {
  const reply = await buildOpsAgentReply({
    action: 'memory-summary',
    target: 'self',
    confidence: 'high',
  }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      memory: { total: '8G', used: '3.1G', free: '4.9G' },
    }),
  });

  assert.match(reply, /我这台服务器目前正常/);
  assert.match(reply, /内存：8G 总量/);
});

test('buildOpsAgentReply renders combined resource summary replies', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({
    action: 'load-summary',
    target: 'self',
    confidence: 'high',
  }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234',
        memory: { total: '8G', used: '3.1G', free: '4.9G' },
        disk: { size: '40G', used: '22G', available: '18G', usePercent: '55%' },
        load: { loadAverage: '0.12, 0.10, 0.09', cpu: '2 cores' },
      };
    },
  });

  assert.equal(receivedAction, 'load-summary');
  assert.match(reply, /内存：8G 总量/);
  assert.match(reply, /硬盘：40G 总量/);
  assert.match(reply, /负载：0\.12, 0\.10, 0\.09/);
});

test('buildOpsAgentReply asks for clarification on medium-confidence dangerous ops', async () => {
  const reply = await buildOpsAgentReply({
    action: 'restart',
    target: 'self',
    confidence: 'medium',
    originalText: '你重起一下',
  });

  assert.match(reply, /你是想让我重启/);
});

test('buildOpsAgentReply guides on low-confidence ops requests', async () => {
  const reply = await buildOpsAgentReply({
    action: 'clarify',
    target: 'unknown',
    confidence: 'low',
  });

  assert.match(reply, /我没完全听懂/);
  assert.match(reply, /你现在内存多少/);
});

test('buildOpsAgentReply supports whitelisted peer repair actions', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'peer-repair' }, {
    runOpsCheck: async (action) => {
      receivedAction = action;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'peer',
        commit: 'abc1234',
        target: 'OpenClaw',
        operation: 'peer-repair',
        detail: 'restart ok; tests ok',
      };
    },
  });

  assert.equal(receivedAction, 'peer-repair');
  assert.match(reply, /目标：OpenClaw/);
  assert.match(reply, /操作：peer-repair/);
  assert.match(reply, /restart ok; tests ok/);
});

test('buildOpsAgentReply supports explicit exec actions', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'exec', command: 'df -h' }, {
    runOpsCheck: async (action, route) => {
      receivedAction = `${action}:${route.command}`;
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
  });

  assert.equal(receivedAction, 'exec:df -h');
  assert.match(reply, /操作：exec/);
  assert.match(reply, /Filesystem/);
});

test('buildOpsAgentReply renders disk audit cleanup candidates', async () => {
  const reply = await buildOpsAgentReply({ action: 'disk-audit' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      disk: { size: '40G', used: '36G', available: '4G', usePercent: '90%' },
      audit: {
        candidates: [
          {
            id: 1,
            name: 'khoj',
            path: '/opt/khoj',
            size: '9.5G',
            risk: 'confirm',
            recommendation: '如果不用 Khoj，可以确认清理。',
          },
          {
            id: 2,
            name: 'npm-cache',
            path: '/root/.npm',
            size: '1.2G',
            risk: 'safe',
            recommendation: '可清理 npm 缓存。',
          },
        ],
      },
    }),
  });

  assert.match(reply, /硬盘占用盘点/);
  assert.match(reply, /1\. khoj/);
  assert.match(reply, /\/opt\/khoj/);
  assert.match(reply, /确认清理第 1 个/);
});

test('buildOpsAgentReply renders cleanup confirmation results', async () => {
  const reply = await buildOpsAgentReply({ action: 'cleanup-confirm', selection: 1 }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      operation: 'cleanup-confirm',
      cleaned: {
        name: 'khoj',
        path: '/opt/khoj',
        beforeAvailable: '4G',
        afterAvailable: '13G',
        detail: '清理完成',
      },
    }),
  });

  assert.match(reply, /已清理 khoj/);
  assert.match(reply, /4G -> 13G/);
});

test('buildOpsAgentReply rejects unknown ops actions', async () => {
  const reply = await buildOpsAgentReply({ action: 'rm -rf /' }, {
    runOpsCheck: async () => {
      throw new Error('runOpsCheck should not be called for unknown ops actions');
    },
  });

  assert.match(reply, /不支持的运维指令/);
});

test('buildOpsAgentReply does not echo secret-like unknown ops actions', async () => {
  const reply = await buildOpsAgentReply({ action: 'Authorization: Bearer abc.def.secret' }, {
    runOpsCheck: async () => {
      throw new Error('runOpsCheck should not be called for unknown ops actions');
    },
  });

  assert.match(reply, /不支持的运维指令/);
  assert.doesNotMatch(reply, /Authorization|Bearer|abc\.def\.secret/);
});

test('buildOpsAgentReply redacts secret-like fields', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: 'GITHUB_TOKEN: abc123',
      watchdog: 'active',
      commit: 'def5678 test commit',
    }),
  });

  assert.doesNotMatch(reply, /abc123/);
  assert.doesNotMatch(reply, /GITHUB_TOKEN/);
  assert.match(reply, /\[redacted secret-like output\]/);
});

test('sanitizeReplyField redacts ops-specific secret formats', () => {
  assert.equal(sanitizeReplyField('Authorization: Bearer abc.def.secret'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('Authorization: Basic dXNlcjpwYXNz'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('Authorization: token abcdefghijkl'), '[redacted secret-like output]');
  assert.equal(sanitizeReplyField('token=sk-proj-abc123456789'), '[redacted secret-like output]');
  assert.equal(
    sanitizeReplyField('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'),
    '[redacted secret-like output]',
  );
});

test('buildOpsAgentReply trims long fields', async () => {
  const longHealth = 'x'.repeat(2000);
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: longHealth,
      watchdog: 'active',
      commit: 'abc1234 test commit',
    }),
  });

  assert.doesNotMatch(reply, new RegExp(longHealth));
  assert.match(reply, /x{500}\.\.\./);
});

test('buildOpsAgentReply returns safe reply when ops check fails', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => {
      throw new Error('Authorization: Bearer abc.def.secret');
    },
  });

  assert.match(reply, /服务器状态暂时不可用/);
  assert.doesNotMatch(reply, /abc\.def\.secret/);
});

test('buildOpsAgentReply tolerates empty ops check result', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => null,
  });

  assert.match(reply, /服务器状态摘要/);
  assert.match(reply, /unknown/);
});

test('buildOpsAgentReply uses provided local ops runner for watchdog action', async () => {
  let receivedAction;
  const reply = await buildOpsAgentReply({ action: 'watchdog' }, {
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
  });

  assert.equal(receivedAction, 'watchdog');
  assert.match(reply, /watchdog：active/);
  assert.doesNotMatch(reply, /not configured in local mode/);
});

test('buildChatAgentPrompt does not include memory unless provided', () => {
  const reply = buildChatAgentPrompt('你好');
  assert.doesNotMatch(reply, /Memory Context/);
  assert.doesNotMatch(reply, /38\.76\./);
});
