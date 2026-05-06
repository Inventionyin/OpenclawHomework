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
  buildCapabilityGuideReply,
  buildBrainGuideReply,
  buildDocAgentReply,
  buildEcosystemAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildPlannerClarifyReply,
  buildQaAgentReply,
  sanitizeReplyField,
} = require('../scripts/agents/agent-handlers');

test('buildCapabilityGuideReply explains practical agent playbook', () => {
  const reply = buildCapabilityGuideReply('OpenClaw');
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /日常玩法菜单/);
  assert.match(reply, /让网页自己跑一遍/);
  assert.match(reply, /看看你现在卡不卡/);
  assert.match(reply, /互相照看/);
  assert.match(reply, /每天收一封小结/);
  assert.match(reply, /把报告和截图走文件通道/);
  assert.match(reply, /微信 Bridge 计划/);
  assert.match(reply, /画一张商品主图/);
  assert.match(reply, /记到脑库里/);
  assert.match(reply, /开一轮 token 训练场/);
  assert.match(reply, /UI 自动化/);
  assert.match(reply, /服务器状态和互修/);
  assert.match(reply, /长期记忆和知识库/);
  assert.match(reply, /邮箱调度/);
  assert.match(reply, /电商客服训练数据/);
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

test('buildClerkAgentReply gives safe office playbook for todos and reports', () => {
  const todoReply = buildClerkAgentReply({ action: 'todo-summary' });
  assert.match(todoReply, /待办/);
  assert.match(todoReply, /不会重启/);

  const reportReply = buildClerkAgentReply({ action: 'daily-report' });
  assert.match(reportReply, /日报/);
  assert.match(reportReply, /最近一次任务/);
  assert.match(reportReply, /服务器部分仍建议只引用状态摘要/);
});

test('buildClerkAgentReply previews a richer daily report from local artifacts', () => {
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

    const reportReply = buildClerkAgentReply({ action: 'daily-report' }, {
      env: {
        FEISHU_USAGE_LEDGER_PATH: ledgerFile,
        DAILY_SUMMARY_STATE_FILE: stateFile,
        MULTI_AGENT_LAB_OUTPUT_DIR: multiAgentDir,
      },
    });

    assert.match(reportReply, /文员日报预览/);
    assert.match(reportReply, /run-1#artifacts/);
    assert.match(reportReply, /Hermes：66 tokens/);
    assert.match(reportReply, /OpenClaw：33 tokens/);
    assert.match(reportReply, /多 Agent 训练场：3 个样本/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
  const reply = buildClerkAgentReply({ action: 'mailbox-workbench' });
  assert.match(reply, /邮箱工作台/);
  assert.match(reply, /watchee\.task@claw\.163\.com/);
  assert.match(reply, /evasan\.verify@claw\.163\.com/);
  assert.match(reply, /agent3\.archive@claw\.163\.com/);
  assert.match(reply, /子邮箱/);
  assert.match(reply, /注册验证码测试/);
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
  assert.match(reply, /evasan\.verify@claw\.163\.com/);
  assert.match(reply, /不要批量注册/);
  assert.match(reply, /真实平台/);
});

test('buildClerkAgentReply creates verification test plan from mailbox bindings', () => {
  const reply = buildClerkAgentReply({ action: 'verification-test-plan' });
  assert.match(reply, /注册验证码测试计划/);
  assert.match(reply, /evasan\.verify@claw\.163\.com/);
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
  assert.match(reply, /evasan\.verify@claw\.163\.com/);
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
  assert.match(reply, /hagent\.eval@claw\.163\.com/);
  assert.match(reply, /agent3\.archive@claw\.163\.com/);
});

test('buildClerkAgentReply explains token lab before execution', () => {
  const reply = buildClerkAgentReply({ action: 'token-lab' });
  assert.match(reply, /高 token 训练场/);
  assert.match(reply, /LongCat/);
  assert.match(reply, /archive/);
  assert.match(reply, /eval/);
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
