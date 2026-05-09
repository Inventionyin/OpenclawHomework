const {
  formatResearchDevLoopReply,
  runResearchDevLoop,
} = require('../../research-dev-loop');
const {
  runWebContentFetch,
} = require('../../web-content-fetcher');
const {
  buildSkillFlowReply,
  runSkillFlow,
} = require('../../skill-flow-runner');
const {
  resolveMailboxAction: defaultResolveMailboxAction,
} = require('../../mailbox-action-router');
const {
  summarizeTasks,
} = require('../../task-center');
const {
  evaluateSkillRisk,
} = require('../../skills/skill-risk-gate');

const CLERK_SKILL_ACTIONS = new Set([
  'trend-intel',
  'trend-token-factory',
  'token-factory',
  'token-factory-status',
  'multi-agent-lab',
  'research-dev-loop',
  'web-content-fetch',
  'skill-flow',
  'daily-email',
]);

function sanitizeReplyField(value = '', maxLength = 300) {
  const text = String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bak_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bck_live_[A-Za-z0-9_-]{8,}/g, '[redacted]');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildWebContentFetchReply(result = {}) {
  if (!result.allowed) {
    return [
      '网页正文抽取已拦截。',
      `- URL：${sanitizeReplyField(result.url || '未提供', 300)}`,
      `- 原因：${sanitizeReplyField(result.reason || 'URL 不在允许列表或指向私网地址。', 300)}`,
      '- 目前只允许 GitHub、HN、Product Hunt、Hugging Face、Cloudflare 和自有域名等白名单来源。',
    ].join('\n');
  }
  const links = Array.isArray(result.links) ? result.links : [];
  return [
    '网页正文抽取完成：',
    `- URL：${sanitizeReplyField(result.url || '', 300)}`,
    `- 状态：${sanitizeReplyField(result.status || 'unknown', 40)}`,
    result.title ? `- 标题：${sanitizeReplyField(result.title, 180)}` : null,
    '',
    sanitizeReplyField(result.summary || result.text || '没有抽取到正文摘要。', 900),
    '',
    '可跟进链接：',
    ...(links.length
      ? links.slice(0, 5).map((link, index) => `${index + 1}. ${sanitizeReplyField(link.text || link.href, 100)} - ${sanitizeReplyField(link.href, 220)}`)
      : ['- 暂无。']),
  ].filter(Boolean).join('\n');
}

function isClerkSkillAction(action = '') {
  return CLERK_SKILL_ACTIONS.has(String(action || ''));
}

function buildTrendIntelReply() {
  return [
    '我来给你盯今天的开源热榜，重点还是你现在最需要的方向。',
    '- 我会抓 GitHub Trending、GitHub Search、Hacker News 和 RSS 技术源。',
    '- 结果会优先筛 AI Agent、Playwright、软件测试、电商自动化这几类。',
    '- 抓到的内容会写进 data/trend-intel，也会喂给每日热点日报。',
    '- 你要继续深挖的话，我可以直接接趋势 token 工厂，把热点拆成学习计划、UI 自动化借鉴点和客服训练数据。',
    '',
    '你可以直接说：文员，今天开源热榜。要高消耗版就说：文员，烧 token 分析今天 GitHub 热门项目。',
  ].join('\n');
}

function buildTrendTokenFactoryReply() {
  return [
    '趋势 token 工厂这块我可以当你的研究助理来跑。',
    '- 我先收集今天的 GitHub 热门项目、Hacker News 热点和 RSS 技术新闻。',
    '- 然后批量让模型分析学习价值、UI 自动化借鉴点、测试风险和下一步动作。',
    '- 最后把结果转成电商客服训练数据、QA 评测样本和可跟进清单。',
    '- 每次调用都会写 token/耗时账本，产物归档到 data/trend-token-factory，后面复盘直接可用。',
    '- 这条线很适合用来消耗 LongCat 额度，但不会只烧 token，都会沉淀成能复用的资产。',
    '',
    '要开始就说：文员，烧 token 分析今天 GitHub 热门项目。',
  ].join('\n');
}

function buildTokenFactoryReply() {
  return [
    '文员 token-factory 已就绪，我会按一条完整流水线给你推进：',
    '- 先生成训练数据：覆盖电商客服、验证码流程、UI 自动化与 Agent 对比场景。',
    '- 接着进 token lab：批量跑模型调用并记录 token/耗时账本，方便后续复盘。',
    '- 然后做多 Agent 评审：按风险、完整性、可执行性逐条打分挑错。',
    '- 评审结果会做邮箱归档：样本进 archive，评分进 eval，综合摘要进 report/daily。',
    '- 最后做日报沉淀：自动整理“今天产出了什么、哪类样本最好、明天先做什么”。',
    '',
    '你只要继续一句：文员，今天就按 token-factory 跑一轮。',
  ].join('\n');
}

function buildMultiAgentLabReply() {
  return [
    '文员多 Agent 训练场：',
    '- 第 1 段生成：批量产出客服回复、测试思路、UI 自动化建议。',
    '- 第 2 段评审：让另一轮模型从风险、完整性、可执行性、是否乱编四个角度挑错打分。',
    '- 第 3 段总结：汇总赢家、失败模式和高价值样本。',
    '- 归档：训练样本进 archive，评测结果进 eval，综合摘要进 report。',
    '',
    '这套流程比普通高 token 训练场更像“生成 -> 评审 -> 总结”的多轮对打，token 消耗更高，也更容易沉淀测试资产。',
    '启动口令：文员，启动多 Agent 训练场。',
  ].join('\n');
}

function buildTokenFactoryStatusReply(options = {}) {
  const summary = (options.summarizeTasks || summarizeTasks)({
    env: options.env || process.env,
    now: options.now || new Date(),
    type: 'token-factory',
  });
  const counts = summary.counts || {};
  return [
    '文员 token-factory 任务中枢：',
    `- 总任务：${counts.total || 0}`,
    `- 今天任务：${counts.today || 0}`,
    `- 运行中：${counts.running || 0}`,
    `- 失败：${counts.failed || 0}`,
    `- 可恢复：${counts.recoverable || 0}`,
    summary.latest ? `- 最新任务：${summary.latest.id}（${summary.latest.status}）` : '- 最新任务：暂无',
  ].join('\n');
}

function buildDailyEmailReply(route = {}, options = {}) {
  const resolveMailboxAction = options.resolveMailboxAction || defaultResolveMailboxAction;
  const daily = resolveMailboxAction('daily', options.env || process.env);
  const defaultRecipients = [
    options.env?.DAILY_SUMMARY_EXTERNAL_TO,
    options.env?.EMAIL_TO,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    '文员日报邮件：',
    `- 默认外发：${route.recipientEmail || defaultRecipients || '未配置外发邮箱'}`,
    `- 内部归档：${daily.mailbox || 'daily 邮箱未配置'}`,
    '- 指定收件人：文员，把今日日报发到 xxx@qq.com',
    '- 内容会包含 UI 自动化、token/耗时、服务器状态、邮箱归档建议。',
    '- 当前只是生成发送意图；飞书桥梁会在明确说“发送日报到邮箱”时调用邮件发送。',
  ].join('\n');
}

function buildClerkSkillReply(route = {}, options = {}) {
  if (route.action === 'trend-intel') return buildTrendIntelReply();
  if (route.action === 'trend-token-factory') return buildTrendTokenFactoryReply();
  if (route.action === 'token-factory') return buildTokenFactoryReply();
  if (route.action === 'multi-agent-lab') return buildMultiAgentLabReply();
  if (route.action === 'token-factory-status') return buildTokenFactoryStatusReply(options);
  if (route.action === 'daily-email') return buildDailyEmailReply(route, options);

  if (route.action === 'research-dev-loop') {
    const runner = options.runResearchDevLoop || runResearchDevLoop;
    return Promise.resolve(runner({
      goal: route.goal || route.rawText || options.text || '',
      text: route.rawText || options.text || '',
      env: options.env || process.env,
      now: options.now || new Date(),
    })).then(formatResearchDevLoopReply);
  }

  if (route.action === 'web-content-fetch') {
    const runner = options.runWebContentFetch || runWebContentFetch;
    return Promise.resolve(runner({
      url: route.url,
      text: route.rawText || options.text || route.url || '',
      env: options.env || process.env,
      maxSummaryChars: 700,
    })).then(buildWebContentFetchReply);
  }

  if (route.action === 'skill-flow') {
    const risk = evaluateSkillRisk({
      action: route.action,
      skillId: route.skillId,
      sourceSkillId: route.sourceSkillId || 'skill-flow',
    });
    if (!risk.allowed) {
      return [
        '技能流程没有启动。',
        risk.reason === 'missing_skill_id'
          ? '- 原因：没有识别到明确的技能名。请说：文员，按 ui-automation 技能跑。'
          : `- 原因：${risk.reason}`,
      ].join('\n');
    }
    const runner = options.runSkillFlow || runSkillFlow;
    return Promise.resolve(runner({
      skillId: route.skillId,
      goal: route.goal || route.rawText || options.text || '',
      env: options.env || process.env,
      now: options.now || new Date(),
      projectDir: options.projectDir || process.cwd(),
      skillsDir: options.skillsDir,
    })).then(buildSkillFlowReply);
  }

  return null;
}

module.exports = {
  buildClerkSkillReply,
  buildDailyEmailReply,
  buildMultiAgentLabReply,
  buildTokenFactoryReply,
  buildTokenFactoryStatusReply,
  buildTrendIntelReply,
  buildTrendTokenFactoryReply,
  buildWebContentFetchReply,
  isClerkSkillAction,
};
