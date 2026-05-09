const REGISTERED_SKILLS = [
  {
    id: 'web-fetch-summary',
    name: '网页正文抽取',
    action: 'web-content-fetch',
    agent: 'clerk-agent',
    description: '抓取白名单网页正文并生成摘要，适合 GitHub 项目、README、资料页和热点链接初筛。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['抓一下', '抓取', '抽取', '提取', '正文', '网页摘要', '网页内容', '看看这个链接', '分析这个链接'],
  },
  {
    id: 'research-dev-loop',
    name: '研发循环',
    action: 'research-dev-loop',
    agent: 'clerk-agent',
    description: '把目标拆成 Research、Plan、Development、Evaluation、Learning、Next 的可追踪研发闭环。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['RD-Agent-lite', 'RD Agent', '研发循环', '研究开发闭环', '自动进化', '自我进化'],
  },
  {
    id: 'skill-flow',
    name: '技能流程',
    action: 'skill-flow',
    agent: 'clerk-agent',
    description: '读取 docs/skills/*.md，把技能文档中的步骤写入任务中枢，形成可恢复流程。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['技能', 'skill', 'skflow', 'skill-flow', '流程'],
  },
  {
    id: 'daily-email',
    name: '日报邮件',
    action: 'daily-email',
    agent: 'clerk-agent',
    description: '把今日总结、测试报告或日报发送到邮箱；可识别显式收件邮箱。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['发送日报', '发到邮箱', '发给邮箱', '日报邮件', '报告发给'],
  },
  {
    id: 'ui-automation-run',
    name: 'UI 自动化执行',
    action: 'run',
    agent: 'ui-test-agent',
    description: '触发 GitHub Actions UI 自动化测试，执行前需要明确测试意图。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['跑测试', 'UI 自动化', '冒烟测试', '全量测试', 'run-ui-test'],
  },
  {
    id: 'dify-testing-assistant',
    name: 'Dify 测试助理',
    action: 'dify-testing-assistant',
    agent: 'qa-agent',
    description: '生成测试点、测试用例、缺陷分析和测试报告整理建议。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['需求文档', '测试用例', '测试点', '缺陷分析', '测试报告', 'Dify'],
  },
  {
    id: 'trend-intel',
    name: '热点和开源学习雷达',
    action: 'trend-intel',
    agent: 'clerk-agent',
    description: '抓取并总结开源热榜、热点新闻、测试圈趋势和学习建议。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['开源热榜', '热点新闻', '值得学', 'GitHub 热门', '测试圈热点'],
  },
  {
    id: 'trend-token-factory',
    name: '趋势 token 工厂',
    action: 'trend-token-factory',
    agent: 'clerk-agent',
    description: '用模型批量分析热点和开源项目，生成学习价值、测试借鉴点和后续行动。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['烧 token 看新闻', 'LongCat 分析热点', '热点 token', '趋势 token'],
  },
  {
    id: 'token-factory',
    name: 'token 训练工厂',
    action: 'token-factory',
    agent: 'clerk-agent',
    description: '批量生成训练数据、模型评审和归档报告，适合主动消耗 token 沉淀资产。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['token 工厂', 'token-factory', '训练数据', '高 token 玩法'],
  },
  {
    id: 'command-center',
    name: '项目一屏总览',
    action: 'command-center',
    agent: 'clerk-agent',
    description: '汇总项目进展、任务、邮件、流水线和下一步建议。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['一屏看懂', '项目总览', '整体情况', '今天进展'],
  },
  {
    id: 'todo-summary',
    name: '待办和明日计划',
    action: 'todo-summary',
    agent: 'clerk-agent',
    description: '整理今日待办、未完成任务、今日总结和明日计划。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['待办', 'todo', '未完成', '下一步', '今日总结明日计划'],
  },
  {
    id: 'mailbox-workbench',
    name: '邮箱工作台',
    action: 'mailbox-workbench',
    agent: 'clerk-agent',
    description: '查看 ClawEmail/邮箱平台玩法、任务、审批、流水和归档工作台。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['邮箱平台怎么玩', 'ClawEmail 玩法', '邮箱工作台', '邮箱调度'],
  },
  {
    id: 'mailbox-approvals',
    name: '邮件审批队列',
    action: 'mailbox-approvals',
    agent: 'clerk-agent',
    description: '列出待审批邮件；真正审批发送仍由审批 action 单独处理。',
    riskLevel: 'medium',
    autoRun: false,
    requiresAuth: true,
    triggers: ['待审批邮件', '邮件审批', '待确认邮箱'],
  },
  {
    id: 'mailbox-tasks',
    name: '邮箱任务队列',
    action: 'mailbox-tasks',
    agent: 'clerk-agent',
    description: '查看今天邮箱里的任务、队列和待办。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['邮箱任务', '邮件队列', '邮箱待办'],
  },
  {
    id: 'mail-ledger',
    name: '邮件发送流水',
    action: 'mail-ledger',
    agent: 'clerk-agent',
    description: '查看邮件发送记录、流水、历史和账本。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['邮件流水', '邮件发送记录', '发了哪些邮件'],
  },
  {
    id: 'server-ops-status',
    name: '服务器状态查询',
    action: 'load-summary',
    agent: 'ops-agent',
    description: '自然语言查询本机或对端服务器内存、硬盘、负载和状态。',
    riskLevel: 'low',
    autoRun: true,
    requiresAuth: true,
    triggers: ['内存多少', '硬盘多少', '服务器状态', '负载', '卡不卡'],
  },
];

function cloneSkill(skill) {
  return {
    ...skill,
    triggers: [...(skill.triggers || [])],
  };
}

function normalizeSkillId(value = '') {
  return String(value || '').trim().toLowerCase();
}

function listRegisteredSkills() {
  return REGISTERED_SKILLS.map(cloneSkill);
}

function findRegisteredSkill(skillId = '') {
  const normalized = normalizeSkillId(skillId);
  const skill = REGISTERED_SKILLS.find((candidate) => candidate.id === normalized
    || candidate.action === normalized
    || candidate.name.toLowerCase() === normalized);
  return skill ? cloneSkill(skill) : null;
}

function findRegisteredSkillByAction(action = '') {
  const normalized = normalizeSkillId(action);
  const skill = REGISTERED_SKILLS.find((candidate) => candidate.action === normalized);
  return skill ? cloneSkill(skill) : null;
}

module.exports = {
  findRegisteredSkill,
  findRegisteredSkillByAction,
  listRegisteredSkills,
  normalizeSkillId,
};
