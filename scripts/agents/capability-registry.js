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
    name: '服务器状态和互修',
    description: '查询 OpenClaw/Hermes 各自服务器状态、硬盘、内存、负载，并支持明确授权后的重启和修复。',
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
    name: 'QA 数据资产',
    description: '生成和整理电商客服训练数据、Agent 评测题、UI 自动化测试矩阵、邮箱平台玩法。',
    examples: [
      '帮我生成一批电商平台客服训练数据',
      '帮我做一轮 OpenClaw 和 Hermes 的能力评测',
      '整理一下 UI 自动化测试矩阵',
    ],
    riskLevel: 'low',
    requiresAuth: true,
  },
  {
    id: 'memory.brain',
    agent: 'memory-agent',
    name: '长期记忆和知识库',
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
    name: '邮箱调度',
    description: '用 ClawEmail/SMTP 发送测试报告、验证码测试邮件、归档失败样本和日报。',
    examples: [
      '邮箱平台可以怎么玩',
      'UI 自动化完成后发报告到邮箱',
    ],
    riskLevel: 'medium',
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
