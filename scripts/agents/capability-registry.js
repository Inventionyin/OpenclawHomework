const CAPABILITIES = [
  {
    id: 'ui-test.run',
    agent: 'ui-test-agent',
    name: 'UI 自动化测试',
    description: '触发 GitHub Actions 执行电商平台 UI 自动化，并回传 Allure/GitHub 报告。',
    examples: [
      '帮我跑一下 main 分支的 UI 自动化冒烟测试',
      '触发 UI 自动化全量测试',
    ],
    riskLevel: 'medium',
    requiresAuth: true,
  },
  {
    id: 'ops.status',
    agent: 'ops-agent',
    name: '日常体检与互修',
    description: '做日常体检（内存/硬盘/负载/健康检查），并在明确授权后执行 OpenClaw/Hermes 互修。',
    examples: [
      '你现在内存多少',
      '看看 Hermes 的服务器状态',
      '修复 OpenClaw',
    ],
    riskLevel: 'high',
    requiresAuth: true,
  },
  {
    id: 'qa.assets',
    agent: 'qa-agent',
    name: '测试资产工坊',
    description: '生成和整理电商客服训练数据、Agent 评测题、UI 自动化测试矩阵、邮箱玩法模板，并可调用 Dify 测试助理生成测试方案。',
    examples: [
      '帮我生成一批电商平台客服训练数据',
      '帮我做一轮 OpenClaw 和 Hermes 的能力评测',
      '整理一下 UI 自动化测试矩阵',
      '请根据需求文档生成测试用例',
      '帮我分析这个缺陷原因',
      'Dify 工作流问答：回归测试策略怎么设计',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'memory.brain',
    agent: 'memory-agent',
    name: '知识库与长期记忆',
    description: '把项目经验沉淀到本地 Markdown/Obsidian，后续可接 GBrain 做 Agent 检索、知识图谱和工作流记忆。',
    examples: [
      'Obsidian 存储和 GBrain 工作流怎么结合',
      '把这段经验沉淀到知识库：UI 自动化失败先看 Allure',
      '/memory search GitHub Actions',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'mailbox.qa',
    agent: 'qa-agent',
    name: '邮箱与日报',
    description: '用 ClawEmail/SMTP 发送测试报告、验证码测试邮件、归档失败样本和日报。',
    examples: [
      '邮箱平台可以怎么玩',
      'UI 自动化完成后发报告到邮箱',
    ],
    riskLevel: 'medium',
    requiresAuth: true,
  },
  {
    id: 'clerk.task-center',
    agent: 'clerk-agent',
    name: '任务中枢和主控脑',
    description: '汇总今日任务、历史任务、失败复盘、下一步计划、每日流水线、token 消耗和邮件归档，适合回答“现在项目什么情况”“下一步怎么做”。',
    examples: [
      '文员，查看任务中枢主控脑',
      '文员，给我一个今日总结和明日计划',
      '文员，把失败复盘和下一步一起汇总',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'browser.protocol-assets',
    agent: 'browser-agent',
    name: '浏览器 CDP 和协议资产',
    description: '对自有站点或授权测试环境做浏览器/CDP 页面检查、截图、console/network 抓取，把协议资产整理成接口测试用例。',
    examples: [
      '真实执行 https://evanshine.me 并截图抓接口',
      '最近抓到哪些接口',
      '把最近抓到的接口整理成测试用例',
    ],
    riskLevel: 'medium',
    requiresAuth: true,
  },
  {
    id: 'files.channel',
    agent: 'clerk-agent',
    name: '文件通道',
    description: '把 UI 自动化报告、失败截图、trace、训练样本和日报附件归档到约定邮箱或文件收件口。',
    examples: [
      '把报告和截图走文件通道',
      '文员，把失败样本归档到 files',
    ],
    riskLevel: 'medium',
    requiresAuth: true,
  },
  {
    id: 'wechat.bridge.plan',
    agent: 'planner-agent',
    name: '微信 Bridge 计划',
    description: '把飞书桥里的自然语言玩法整理成后续可迁移到微信 Bridge 的计划、入口和安全边界。',
    examples: [
      '微信 Bridge 计划怎么接',
      '帮我整理微信 Bridge 的第一版入口',
    ],
    riskLevel: 'low',
    requiresAuth: false,
  },
  {
    id: 'clerk.office',
    agent: 'clerk-agent',
    name: '文员整理和日报',
    description: '统计 token/耗时账本，整理待办、日报、UI 自动化摘要、邮箱归档和知识库沉淀建议。',
    examples: [
      '文员，统计今天 Hermes 和 OpenClaw 谁更费 token',
      '文员，整理一下还没完成的待办',
      '文员，把今天 UI 自动化结果发到邮箱',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'image.generate',
    agent: 'image-agent',
    name: '图片生成和修图',
    description: '用独立生图模型生成海报、商品图、客服机器人素材，也可以基于飞书图片做修复和编辑。',
    examples: [
      '生成一张图片：赛博风电商客服机器人海报',
      '把刚才那张旧照片修复清晰',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'token.training',
    agent: 'clerk-agent',
    name: 'token 工厂',
    description: '批量生成训练数据、跑模型评审、记录 token/耗时，并把结果整理成日报和邮箱归档。',
    examples: [
      '文员，开一轮 token 训练场',
      '文员，今天按 token-factory 跑一轮',
    ],
    riskLevel: 'medium',
    requiresAuth: true,
  },
  {
    id: 'clerk.workflow-enhancement',
    agent: 'clerk-agent',
    name: '研发循环、网页抽取和技能流程',
    description: '把 RD-Agent、Scrapling、skflow 的核心思路轻量化：建立可追踪研发循环、抽取白名单网页正文、按 docs/skills 技能文档生成可恢复任务。',
    examples: [
      '文员，启动 RD-Agent-lite 研发循环，优化 UI 自动化失败复盘',
      '文员，抓一下 https://github.com/microsoft/RD-Agent 正文',
      '文员，按 ui-automation 技能跑一轮流程',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'chat.normal',
    agent: 'chat-agent',
    name: '普通聊天和需求澄清',
    description: '正常聊天、解释模型选择、把模糊需求拆成下一步可执行动作。',
    examples: [
      'LongCat 和讯飞 CodingPlan 怎么分工',
      '我现在该怎么玩 OpenClaw 和 Hermes',
    ],
    riskLevel: 'low',
    requiresAuth: false,
  },
];

function listCapabilities() {
  return CAPABILITIES.map((capability) => ({ ...capability }));
}

function buildCapabilityPromptCatalog() {
  return CAPABILITIES.map((capability) => [
    `- ${capability.id} (${capability.agent})`,
    `  名称：${capability.name}`,
    `  能力：${capability.description}`,
    `  示例：${capability.examples.join(' / ')}`,
    `  风险：${capability.riskLevel}`,
  ].join('\n')).join('\n');
}

module.exports = {
  buildCapabilityPromptCatalog,
  listCapabilities,
};
