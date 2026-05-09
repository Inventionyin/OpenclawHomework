const {
  findRegisteredSkill,
} = require('./skill-registry');

function stripMention(text) {
  return String(text ?? '').trim().replace(/^@\S+\s*/, '');
}

function extractFirstUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s，。！？)）]+/i);
  return match ? match[0] : '';
}

function extractResearchDevGoal(text) {
  return stripMention(text)
    .replace(/^(?:文员|秘书|助理|clerk|office)[，,\s:：。]*/i, '')
    .replace(/(?:启动|开始|跑|执行|建立|安排)?\s*(?:rd-agent-lite|rd\s*agent|研发循环|研究开发闭环|自动进化|自我进化)\s*/ig, '')
    .replace(/^(?:，|,|：|:|\s)+/, '')
    .trim() || '优化当前 OpenClaw/Hermes 项目';
}

function extractSkillFlowId(text) {
  const original = stripMention(text);
  const explicit = original.match(/(?:按|运行|启动|执行)\s*([a-z0-9_-]+)\s*(?:技能|skill|流程)/i)
    || original.match(/(?:技能|skill)\s*[:：]\s*([a-z0-9_-]+)/i)
    || original.match(/([a-z0-9_-]+)\s*(?:技能|skill).{0,8}(?:跑|运行|启动|执行)/i);
  return explicit ? explicit[1].toLowerCase() : '';
}

function withSkillMetadata(route, skill) {
  return {
    ...route,
    requiresAuth: skill.requiresAuth,
    riskLevel: skill.riskLevel,
    autoRun: skill.autoRun,
  };
}

function buildResearchDevRoute(text) {
  const normalized = String(text ?? '').toLowerCase();
  if (!/(rd-agent-lite|rd\s*agent|研发循环|研究开发闭环|自动进化|自我进化)/i.test(normalized)) {
    return null;
  }
  const skill = findRegisteredSkill('research-dev-loop');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
    goal: extractResearchDevGoal(text),
  }, skill);
}

function buildWebContentFetchRoute(text) {
  const url = extractFirstUrl(text);
  if (!url) return null;
  const normalized = String(text ?? '').toLowerCase();
  if (/(cdp|har|协议|接口|network|抓包|请求|响应|登录流程|注册流程|console|控制台|截图|验证码)/i.test(normalized)) {
    return null;
  }
  if (!/(抓一下|抓取|抽取|提取|正文|网页摘要|网页内容|验证热点链接|看看这个链接|分析这个链接)/i.test(normalized)) {
    return null;
  }
  const skill = findRegisteredSkill('web-fetch-summary');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
    url,
  }, skill);
}

function buildSkillFlowRoute(text) {
  const normalized = String(text ?? '').toLowerCase();
  if (!/(技能|skill|skflow|skill-flow).{0,20}(跑|运行|启动|执行|流程)|(?:按|运行|启动|执行).{0,20}(技能|skill|skflow|skill-flow)/i.test(normalized)) {
    return null;
  }
  const skill = findRegisteredSkill('skill-flow');
  const skillId = extractSkillFlowId(text);
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId,
    sourceSkillId: skill.id,
  }, skill);
}

function routeSkillIntent(text) {
  return buildResearchDevRoute(text)
    || buildWebContentFetchRoute(text)
    || buildSkillFlowRoute(text);
}

module.exports = {
  buildResearchDevRoute,
  buildSkillFlowRoute,
  buildWebContentFetchRoute,
  extractFirstUrl,
  extractResearchDevGoal,
  extractSkillFlowId,
  routeSkillIntent,
};
