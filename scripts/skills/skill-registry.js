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
