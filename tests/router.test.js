const assert = require('node:assert/strict');
const test = require('node:test');

const {
  routeAgentIntent,
} = require('../scripts/agents/router');

test('routeAgentIntent routes UI automation requests', () => {
  assert.equal(routeAgentIntent('/run-ui-test main smoke').agent, 'ui-test-agent');
  assert.equal(routeAgentIntent('帮我跑一下 main 分支的 UI 自动化冒烟测试').agent, 'ui-test-agent');
});

test('routeAgentIntent routes safe ops commands', () => {
  assert.deepEqual(routeAgentIntent('/status'), { agent: 'ops-agent', action: 'status', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/health'), { agent: 'ops-agent', action: 'health', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/watchdog'), { agent: 'ops-agent', action: 'watchdog', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/logs'), { agent: 'ops-agent', action: 'logs', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/exec df -h'), {
    agent: 'ops-agent',
    action: 'exec',
    command: 'df -h',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('/peer-exec df -h'), {
    agent: 'ops-agent',
    action: 'peer-exec',
    command: 'df -h',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('/peer-status'), { agent: 'ops-agent', action: 'peer-status', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/peer repair'), { agent: 'ops-agent', action: 'peer-repair', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('@OpenClaw UI 自动化助手 /status'), {
    agent: 'ops-agent',
    action: 'status',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language self server queries', () => {
  assert.deepEqual(routeAgentIntent('你现在内存多少'), {
    agent: 'ops-agent',
    action: 'memory-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'disk-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你现在卡不卡'), {
    agent: 'ops-agent',
    action: 'load-summary',
    target: 'self',
    confidence: 'medium',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你现在内存多少，硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'load-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你现在内存、硬盘、CPU 都怎么样'), {
    agent: 'ops-agent',
    action: 'load-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language disk audit and cleanup confirmations', () => {
  assert.deepEqual(routeAgentIntent('有哪些地方没用的占用很多硬盘'), {
    agent: 'ops-agent',
    action: 'disk-audit',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('khoj 可以清理吗'), {
    agent: 'ops-agent',
    action: 'disk-audit',
    target: 'self',
    confidence: 'high',
    cleanupHint: 'khoj',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('确认清理第 2 个'), {
    agent: 'ops-agent',
    action: 'cleanup-confirm',
    target: 'self',
    confidence: 'high',
    selection: 2,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('清理 khoj'), {
    agent: 'ops-agent',
    action: 'cleanup-confirm',
    target: 'self',
    confidence: 'high',
    selectionName: 'khoj',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language peer server queries', () => {
  assert.deepEqual(routeAgentIntent('看看 Hermes 的服务器状态'), {
    agent: 'ops-agent',
    action: 'peer-status',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('OpenClaw 硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'peer-disk-summary',
    target: 'openclaw',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('Hermes 内存和硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'peer-load-summary',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes high-confidence restart and repair requests', () => {
  assert.deepEqual(routeAgentIntent('重启你自己'), {
    agent: 'ops-agent',
    action: 'restart',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('修复 Hermes'), {
    agent: 'ops-agent',
    action: 'peer-repair',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('修复 OpenClaw'), {
    agent: 'ops-agent',
    action: 'peer-repair',
    target: 'openclaw',
    confidence: 'high',
    requiresAuth: true,
  });
});

test('routeAgentIntent marks ambiguous dangerous ops as medium or low confidence', () => {
  assert.deepEqual(routeAgentIntent('你重起一下'), {
    agent: 'ops-agent',
    action: 'restart',
    target: 'self',
    confidence: 'medium',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('那个你帮我搞一下'), {
    agent: 'ops-agent',
    action: 'clarify',
    target: 'unknown',
    confidence: 'low',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes memory commands', () => {
  assert.deepEqual(routeAgentIntent('/memory'), { agent: 'memory-agent', action: 'show', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/memory search session lock'), {
    agent: 'memory-agent',
    action: 'search',
    query: 'session lock',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('/memory remember 今天修复了 session lock'), {
    agent: 'memory-agent',
    action: 'remember',
    note: '今天修复了 session lock',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('查知识库 LongCat 模型分工'), {
    agent: 'memory-agent',
    action: 'brain-search',
    query: 'LongCat 模型分工',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('问脑库 UI 自动化报告怎么发邮箱'), {
    agent: 'memory-agent',
    action: 'brain-search',
    query: 'UI 自动化报告怎么发邮箱',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language QA asset requests', () => {
  assert.deepEqual(routeAgentIntent('帮我生成一批电商平台客服训练数据'), {
    agent: 'qa-agent',
    action: 'customer-service-data',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('帮我做一轮 OpenClaw 和 Hermes 的能力评测'), {
    agent: 'qa-agent',
    action: 'agent-eval',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('整理一下 UI 自动化测试矩阵'), {
    agent: 'qa-agent',
    action: 'ui-matrix',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('邮箱平台可以怎么玩'), {
    agent: 'qa-agent',
    action: 'email-playbook',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes Dify testing assistant intents', () => {
  assert.deepEqual(routeAgentIntent('请根据需求文档帮我生成测试用例'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
    query: '请根据需求文档帮我生成测试用例',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('帮我做一下线上缺陷分析并给出复现建议'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
    query: '帮我做一下线上缺陷分析并给出复现建议',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('把这周测试报告整理一下，按模块输出结论'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
    query: '把这周测试报告整理一下，按模块输出结论',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('Dify 工作流问答：回归测试策略怎么设计更稳妥'), {
    agent: 'qa-agent',
    action: 'dify-testing-assistant',
    query: 'Dify 工作流问答：回归测试策略怎么设计更稳妥',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes safe combined requests to multi-intent planner', () => {
  const route = routeAgentIntent('看看两台服务器内存硬盘，顺便看今天失败任务，再统计 token 用量');

  assert.equal(route.agent, 'planner-agent');
  assert.equal(route.action, 'multi-intent-plan');
  assert.equal(route.requiresAuth, true);
  assert.equal(route.plan.isMultiIntent, true);
  assert.deepEqual(
    route.plan.intents.map((intent) => intent.action),
    ['load-summary', 'task-center-failed', 'token-summary'],
  );
});

test('routeAgentIntent routes browser CDP and protocol automation requests', () => {
  assert.deepEqual(routeAgentIntent('打开 https://projectku.local/login 看看登录页为什么验证码不出来'), {
    agent: 'browser-agent',
    action: 'browser-dry-run',
    requiresAuth: true,
  });

  assert.deepEqual(routeAgentIntent('抓一下 http://localhost:3000/register 登录流程接口，生成接口测试用例'), {
    agent: 'browser-agent',
    action: 'protocol-capture-plan',
    requiresAuth: true,
  });

  assert.deepEqual(routeAgentIntent('最近抓到哪些接口'), {
    agent: 'browser-agent',
    action: 'protocol-assets-report',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('协议资产库里有什么'), {
    agent: 'browser-agent',
    action: 'protocol-assets-report',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('查看登录接口资产'), {
    agent: 'browser-agent',
    action: 'protocol-assets-report',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('把最近抓到的接口整理成测试用例'), {
    agent: 'browser-agent',
    action: 'protocol-assets-to-tests',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('真实执行打开 https://projectku.local/login 页面检查'), {
    agent: 'browser-agent',
    action: 'browser-live-run',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('真的打开浏览器去跑一遍页面检查 https://projectku.local/login'), {
    agent: 'browser-agent',
    action: 'browser-live-run',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes clerk agent office work requests', () => {
  assert.deepEqual(routeAgentIntent('文员，统计今天 Hermes 和 OpenClaw 谁更费 token'), {
    agent: 'clerk-agent',
    action: 'token-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，整理一下还没完成的待办'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把今天 UI 自动化结果发到邮箱'), {
    agent: 'clerk-agent',
    action: 'daily-report',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天可以帮我干嘛'), {
    agent: 'clerk-agent',
    action: 'workbench',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，给我一屏看懂'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天有什么进展'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天做了啥'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，现在该怎么玩'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，给我总览'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('飞书里面打开控制台看板'), {
    agent: 'clerk-agent',
    action: 'dashboard-card',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，邮箱平台现在怎么结合起来玩'), {
    agent: 'clerk-agent',
    action: 'mailbox-workbench',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看今天邮箱工作台'), {
    agent: 'clerk-agent',
    action: 'mailbox-workbench',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，列出待审批邮件'), {
    agent: 'clerk-agent',
    action: 'mailbox-approvals',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，审批第 1 封并发送'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'approve',
    index: 1,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，忽略第 2 封'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'ignore',
    index: 2,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把第 1 封整理成客服训练数据'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'training-data',
    index: 1,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，生成 ClawEmail 每日报告'), {
    agent: 'clerk-agent',
    action: 'mailbox-daily-report',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，子邮箱可以拿去注册测试平台吗'), {
    agent: 'clerk-agent',
    action: 'mailbox-registration-playbook',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，用 verify 邮箱设计一轮注册验证码测试'), {
    agent: 'clerk-agent',
    action: 'verification-test-plan',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，用 verify 邮箱给 projectku-web 跑一轮注册验证码测试'), {
    agent: 'clerk-agent',
    action: 'platform-registration-runner',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天邮箱里有哪些任务'), {
    agent: 'clerk-agent',
    action: 'mailbox-tasks',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天机器人发了哪些邮件'), {
    agent: 'clerk-agent',
    action: 'mail-ledger',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，帮我生成一批电商平台客服训练数据'), {
    agent: 'clerk-agent',
    action: 'training-data',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，启动高 token 训练场，今天多生成一些数据'), {
    agent: 'clerk-agent',
    action: 'token-lab',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天开源热榜'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天有什么值得学的开源项目'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，看看测试圈热点'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，烧 100 万 token 分析今天 GitHub 热门项目'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，用 LongCat 分析热点'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，烧 token 看新闻'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把 token 跑起来'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，来一套高 token 玩法'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，生成一套训练数据并评测归档'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，今天把 token 用起来'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，安排一条 token 全链路流水线'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看 token-factory 状态'), {
    agent: 'clerk-agent',
    action: 'token-factory-status',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看今天任务中枢'), {
    agent: 'clerk-agent',
    action: 'task-center-today',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看任务中枢主控脑'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，给我主控脑总结一下'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把失败复盘和下一步一起汇总'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，启动今天的自动流水线'), {
    agent: 'clerk-agent',
    action: 'daily-pipeline',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看今天自动流水线状态'), {
    agent: 'clerk-agent',
    action: 'daily-pipeline-status',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，试跑今天的自动流水线'), {
    agent: 'clerk-agent',
    action: 'daily-pipeline',
    dryRun: true,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，查看失败任务'), {
    agent: 'clerk-agent',
    action: 'task-center-failed',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，继续昨天 token-factory 任务'), {
    agent: 'clerk-agent',
    action: 'task-center-continue-yesterday',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，继续吧'), {
    agent: 'clerk-agent',
    action: 'continue-context',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，下一步'), {
    agent: 'clerk-agent',
    action: 'continue-context',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('clerk, 下一步'), {
    agent: 'clerk-agent',
    action: 'continue-context',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('office. 继续吧'), {
    agent: 'clerk-agent',
    action: 'continue-context',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，启动多 Agent 训练场，用邮箱归档结果'), {
    agent: 'clerk-agent',
    action: 'multi-agent-lab',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，发送今天日报到邮箱'), {
    agent: 'clerk-agent',
    action: 'daily-email',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把今日日报发到 1693457391@qq.com'), {
    agent: 'clerk-agent',
    action: 'daily-email',
    recipientEmail: '1693457391@qq.com',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，把今日日报发给 1693457391@.com'), {
    agent: 'clerk-agent',
    action: 'daily-email-invalid-recipient',
    invalidRecipient: '1693457391@.com',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes office work without requiring clerk wake word', () => {
  assert.deepEqual(routeAgentIntent('统计 Hermes 和 OpenClaw 谁更费 token'), {
    agent: 'clerk-agent',
    action: 'token-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('把今天日报发到邮箱'), {
    agent: 'clerk-agent',
    action: 'daily-email',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('整理一下今天待办'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('今天邮箱里有哪些任务'), {
    agent: 'clerk-agent',
    action: 'mailbox-tasks',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('查看今天任务中枢'), {
    agent: 'clerk-agent',
    action: 'task-center-today',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('今天有什么值得学的开源项目'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('测试圈热点看看'), {
    agent: 'clerk-agent',
    action: 'trend-intel',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('用 LongCat 分析热点'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('烧 token 看新闻'), {
    agent: 'clerk-agent',
    action: 'trend-token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('给我一屏看懂今天项目'), {
    agent: 'clerk-agent',
    action: 'command-center',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('给我主控脑总结一下'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('今天任务全景图'), {
    agent: 'clerk-agent',
    action: 'task-center-brain',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('今天发了哪些邮件'), {
    agent: 'clerk-agent',
    action: 'mail-ledger',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('列出待审批邮件'), {
    agent: 'clerk-agent',
    action: 'mailbox-approvals',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('审批第 1 封并发送'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'approve',
    index: 1,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('忽略第 1 封'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'ignore',
    index: 1,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('把第 1 封整理成客服训练数据'), {
    agent: 'clerk-agent',
    action: 'mailbox-approval-action',
    approvalAction: 'training-data',
    index: 1,
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('生成 ClawEmail 每日报告'), {
    agent: 'clerk-agent',
    action: 'mailbox-daily-report',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language control brain and memory discovery', () => {
  assert.deepEqual(routeAgentIntent('我现在能让你做哪些事情'), {
    agent: 'capability-agent',
    action: 'guide',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('Obsidian 存储和 GBrain 工作流怎么结合'), {
    agent: 'memory-agent',
    action: 'brain-guide',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('把这段经验沉淀到知识库：UI 自动化失败先看 Allure'), {
    agent: 'memory-agent',
    action: 'remember',
    note: 'UI 自动化失败先看 Allure',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('记住 workflow 今天失败了'), {
    agent: 'memory-agent',
    action: 'remember',
    note: 'workflow 今天失败了',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('帮我记一下：UI 自动化失败先看 Allure'), {
    agent: 'memory-agent',
    action: 'remember',
    note: 'UI 自动化失败先看 Allure',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes ecosystem plugin and skill management requests', () => {
  assert.deepEqual(routeAgentIntent('给 Hermes 安装 GBrain、Hermes WebUI 和自检更新技能'), {
    agent: 'ecosystem-agent',
    action: 'install-safe',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('查看生态插件状态'), {
    agent: 'ecosystem-agent',
    action: 'status',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('开启记忆自我净化和后台自检'), {
    agent: 'ecosystem-agent',
    action: 'enable-maintenance',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
});

test('routeAgentIntent asks for clarification on broad natural-language work requests', () => {
  assert.deepEqual(routeAgentIntent('帮我把项目优化一下'), {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('帮我搞一个完整工作流'), {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('今天帮我把项目质量搞一下'), {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('把 UI 自动化、新闻、token 训练都安排一下'), {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    requiresAuth: false,
  });
});

test('routeAgentIntent routes image generation requests', () => {
  assert.deepEqual(routeAgentIntent('/image 赛博风电商客服机器人海报'), {
    agent: 'image-agent',
    action: 'generate',
    prompt: '赛博风电商客服机器人海报',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('生成一张图片：极简科技风商品主图'), {
    agent: 'image-agent',
    action: 'generate',
    prompt: '极简科技风商品主图',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes image channel switch by confidence', () => {
  assert.deepEqual(routeAgentIntent('切换生图通道\nurl: https://img2.suneora.com\nkey: sk-test-secret'), {
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
  });
  assert.deepEqual(routeAgentIntent('url: https://img2.suneora.com\napikey: sk-test-secret'), {
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
  });
  assert.deepEqual(routeAgentIntent('更新图片 key: sk-only'), {
    agent: 'image-agent',
    action: 'image-channel-clarify',
    confidence: 'low',
    config: {
      url: '',
      apiKey: 'sk-only',
      maskedApiKey: 'sk...7',
      model: 'auto',
      size: '1024x1024',
      scope: 'both',
    },
    missing: ['url'],
    requiresAuth: true,
  });
});

test('routeAgentIntent routes chat model channel switch by confidence', () => {
  assert.deepEqual(routeAgentIntent('切换聊天模型通道\nurl: https://api.longcat.chat/openai/v1\nkey: ak-test-secret\nmodel: LongCat-Flash-Chat'), {
    agent: 'model-agent',
    action: 'model-channel-switch',
    confidence: 'high',
    config: {
      url: 'https://api.longcat.chat/openai/v1',
      apiKey: 'ak-test-secret',
      maskedApiKey: 'ak-tes...cret (14)',
      model: 'LongCat-Flash-Chat',
      simpleModel: '',
      thinkingModel: '',
      endpointMode: 'chat_completions',
      scope: 'current',
    },
    missing: [],
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('url: https://api.longcat.chat/openai/v1\nkey: ak-test-secret'), {
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
  });
});

test('routeAgentIntent routes documentation questions', () => {
  assert.deepEqual(routeAgentIntent('老师任务还差哪些'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.equal(routeAgentIntent('怎么让新 AI 接手').agent, 'doc-agent');
  assert.equal(routeAgentIntent('GitHub Actions workflow 文档在哪').agent, 'doc-agent');
});

test('routeAgentIntent defaults to chat agent', () => {
  assert.deepEqual(routeAgentIntent('你好，今天状态怎么样'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('系统运行正常吗'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('这个 UI 怎么设计'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});

test('routeAgentIntent keeps memory and explicit UI test boundaries', () => {
  assert.equal(routeAgentIntent('帮我跑测试').agent, 'ui-test-agent');
});

test('routeAgentIntent prioritizes imperative test runs over fuzzy docs', () => {
  assert.deepEqual(routeAgentIntent('帮我跑测试并更新文档'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('请执行冒烟测试'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('触发 UI 自动化测试'), {
    agent: 'ui-test-agent',
    action: 'run',
    requiresAuth: true,
  });
});

test('routeAgentIntent does not run tests for questions negations or failure discussion', () => {
  assert.deepEqual(routeAgentIntent('如何运行测试'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('不要运行测试'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('不要 /run-ui-test main smoke'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('如何使用 /run-ui-test main smoke'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('请问 /run-ui-test main smoke 怎么用'), {
    agent: 'doc-agent',
    action: 'answer',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('contract test failure 怎么办'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});

test('routeAgentIntent handles boss-style natural-language control phrases', () => {
  assert.deepEqual(routeAgentIntent('今天还有什么没做'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('昨天失败了什么'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('继续昨天没跑完的 token 工厂'), {
    agent: 'clerk-agent',
    action: 'token-factory',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('现在我该怎么玩'), {
    agent: 'capability-agent',
    action: 'guide',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('文员，给我一个今日总结和明日计划'), {
    agent: 'clerk-agent',
    action: 'todo-summary',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('继续'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('接着做'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
  assert.deepEqual(routeAgentIntent('下一步'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});
