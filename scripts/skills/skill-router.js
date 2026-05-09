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

function extractRecipientEmail(text) {
  const original = stripMention(text);
  const match = original.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  return match ? match[1] : '';
}

function extractEmailLike(text) {
  const original = stripMention(text);
  const match = original.match(/\b([^\s]+@[^\s]+)\b/);
  return match ? match[1].replace(/[，。！!？?,;；]+$/u, '') : '';
}

function withSkillMetadata(route, skill) {
  return {
    ...route,
    requiresAuth: skill.requiresAuth,
    riskLevel: skill.riskLevel,
    autoRun: skill.autoRun,
  };
}

function buildDailyEmailRoute(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!(/(发送|发|寄|给我).{0,12}(今天|当前|今儿)?.{0,8}(日报|周报|报告).{0,20}(邮箱|邮件|给|到|发给|发到|寄给|寄到)/i.test(normalized)
    || /(今天|当前|今儿)?.{0,8}(日报|周报|报告).{0,20}(发送|发|寄|邮箱|邮件|发给|发到)/i.test(normalized)
    || /((发到|发给|寄到|寄给).{0,24}[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.test(normalized))) {
    return null;
  }
  const skill = findRegisteredSkill('daily-email');
  const recipientEmail = extractRecipientEmail(text);
  const emailLike = extractEmailLike(text);
  if (emailLike && !recipientEmail) {
    return null;
  }
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
    ...(recipientEmail ? { recipientEmail } : {}),
  }, skill);
}

function buildUiAutomationRunRoute(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!(/^\/run-ui-test\b/i.test(normalized)
    || /^run-ui-test\b/i.test(normalized)
    || /(帮我|请|麻烦|帮忙|给我)?.{0,12}(跑|运行|触发|执行).{0,40}(测试|ui\s*自动化|冒烟|全量)/i.test(normalized)
    || /^(帮我|请|麻烦|帮忙|给我).{0,20}(冒烟|全量|smoke|contracts?).{0,10}(测试|test)$/i.test(normalized))) {
    return null;
  }
  if (/(如何|怎么|怎样|在哪|哪里).{0,30}(使用|运行|跑|触发|执行)?.{0,20}(\/run-ui-test|run-ui-test|测试|ui\s*自动化|冒烟|全量|smoke\s+test|contracts?\s+test)/i.test(normalized)
    || /(不要|别|不用|无需|不要再|先别).{0,30}(\/run-ui-test|run-ui-test|运行|跑|触发|执行).{0,30}(测试|ui\s*自动化|冒烟|全量|smoke|contracts?)?/i.test(normalized)) {
    return null;
  }
  const skill = findRegisteredSkill('ui-automation-run');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
  }, skill);
}

function buildDifyTestingAssistantRoute(text) {
  const original = stripMention(text);
  const normalized = original.toLowerCase();
  if (!(/(项目质量|代码质量|测试质量).{0,12}(体检|检查|评估|评审|诊断|跑一下|看一下|看一遍)/i.test(normalized)
    || /(项目|代码|测试).{0,12}(体检|检查|评估|评审|诊断|跑一下|看一下|看一遍)/i.test(normalized)
    || /(跑一下|检查|评估|评审|诊断).{0,16}(项目|代码|测试).{0,8}(质量)?/i.test(normalized)
    || /(dify).{0,12}(工作流|workflow|问答|qa)/i.test(normalized)
    || /(需求|需求文档|prd|spec).{0,30}(测试用例|用例|测试点|场景)/i.test(normalized)
    || /(缺陷|bug|故障|问题).{0,30}(分析|定位|复现|排查)/i.test(normalized)
    || /(测试报告|报告).{0,20}(整理|汇总|归纳|总结)/i.test(normalized))) {
    return null;
  }
  const skill = findRegisteredSkill('dify-testing-assistant');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
    query: original,
  }, skill);
}

function buildTrendIntelRoute(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!(/(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点).{0,24}(热榜|热点|新闻|日报|看看|分析|今天|每日|推荐|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(今天|每日).{0,12}(开源|github|热门项目|热榜|热点新闻|热点|新闻|趋势|测试圈|测试社区|qa圈|测试热点|值得学|学习|学什么|推荐项目)/i.test(normalized)
    || /(值得学|学习|学什么|推荐项目).{0,24}(开源|github|热门项目|项目|趋势)/i.test(normalized)
    || /(测试圈|测试社区|qa圈|测试热点).{0,24}(热点|看看|新闻|趋势|日报|推荐)?/i.test(normalized))) {
    return null;
  }
  const skill = findRegisteredSkill('trend-intel');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
  }, skill);
}

function buildTrendTokenFactoryRoute(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!(/(烧|消耗|花完|用掉).{0,12}(token|额度).{0,30}(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势)/i.test(normalized)
    || /(git(?:hub)?|开源|热门|热榜|热点|看新闻|刷新闻|新闻|项目|趋势).{0,30}(烧|消耗|花完|用掉).{0,12}(token|额度)/i.test(normalized)
    || /longcat.{0,18}(分析|看|研究|总结).{0,18}(热点|新闻|热榜|开源|github|项目|趋势)/i.test(normalized)
    || /(热点|新闻|热榜|开源|github|项目|趋势).{0,18}(longcat).{0,18}(分析|看|研究|总结)/i.test(normalized))) {
    return null;
  }
  const skill = findRegisteredSkill('trend-token-factory');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
  }, skill);
}

function buildTokenFactoryRoute(text) {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!(/(把|将|让).{0,8}token.{0,8}(跑起来|用起来)/i.test(normalized)
    || /(来一套|安排一套|整一套).{0,12}(高\s*token|token).{0,12}(玩法|流程|全链路)/i.test(normalized)
    || /(生成|做|整理).{0,16}(一套|一批).{0,16}(训练数据|语料).{0,20}(评测|评审).{0,12}(归档|沉淀)/i.test(normalized)
    || /(token).{0,20}(全链路|流水线|工厂|产线)/i.test(normalized)
    || /(今天).{0,10}(把).{0,8}(token).{0,8}(用起来)/i.test(normalized)
    || /(继续|接着|延续).{0,12}(昨天|昨晚|昨日).{0,12}(没跑完|没做完|没完成).{0,12}(token|token\s*工厂|token-factory)/i.test(normalized)
    || /(token|token\s*工厂|token-factory).{0,18}(继续|接着).{0,12}(昨天|昨晚|昨日)/i.test(normalized))) {
    return null;
  }
  const skill = findRegisteredSkill('token-factory');
  return withSkillMetadata({
    agent: skill.agent,
    action: skill.action,
    skillId: skill.id,
  }, skill);
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
  return buildDailyEmailRoute(text)
    || buildUiAutomationRunRoute(text)
    || buildDifyTestingAssistantRoute(text)
    || buildTrendTokenFactoryRoute(text)
    || buildTrendIntelRoute(text)
    || buildTokenFactoryRoute(text)
    || buildResearchDevRoute(text)
    || buildWebContentFetchRoute(text)
    || buildSkillFlowRoute(text);
}

module.exports = {
  buildDailyEmailRoute,
  buildDifyTestingAssistantRoute,
  buildResearchDevRoute,
  buildSkillFlowRoute,
  buildTokenFactoryRoute,
  buildTrendIntelRoute,
  buildTrendTokenFactoryRoute,
  buildUiAutomationRunRoute,
  buildWebContentFetchRoute,
  extractFirstUrl,
  extractEmailLike,
  extractRecipientEmail,
  extractResearchDevGoal,
  extractSkillFlowId,
  routeSkillIntent,
};
