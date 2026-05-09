const {
  buildMailLedgerSummaryReply,
  filterMailLedgerEntriesForDay,
  readMailLedgerEntries: defaultReadMailLedger,
} = require('../../mail-ledger');
const {
  buildMailWorkbenchReportFromEnv,
  formatMailWorkbenchReply,
} = require('../../mail-workbench');
const {
  applyMailApprovalAction,
  buildApprovalQueueFromMessages,
  getMailApprovalQueueFile,
  writeMailApprovalQueue,
} = require('../../mail-approval-queue');
const {
  resolveMailboxAction,
} = require('../../mailbox-action-router');

const CLERK_MAILBOX_ACTIONS = new Set([
  'mailbox-workbench',
  'mailbox-approvals',
  'mailbox-approval-action',
  'mailbox-daily-report',
  'mailbox-registration-playbook',
  'verification-test-plan',
  'mailbox-tasks',
  'mail-ledger',
]);

function isClerkMailboxAction(action = '') {
  return CLERK_MAILBOX_ACTIONS.has(String(action || ''));
}

function mailboxLine(actionName, env = process.env) {
  const action = resolveMailboxAction(actionName, env);
  if (!action.enabled || !action.mailbox) {
    return `- ${actionName}：未启用`;
  }
  return `- ${actionName} -> ${action.mailbox}：${action.description}`;
}

function buildClerkMailboxWorkbenchReply(env = process.env, options = {}) {
  const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(env, options);
  return [
    formatMailWorkbenchReply(workbench),
    '',
    '邮箱动作绑定：',
    mailboxLine('task', env),
    mailboxLine('report', env),
    mailboxLine('verify', env),
    mailboxLine('support', env),
    mailboxLine('eval', env),
    mailboxLine('files', env),
    mailboxLine('archive', env),
    mailboxLine('daily', env),
    '',
    '自然语言玩法：',
    '- 文员，用 verify 邮箱设计一轮注册验证码测试',
    '- 文员，子邮箱可以拿去注册测试平台吗',
    '- 文员，今天邮箱里有哪些任务',
    '- 文员，列出待审批邮件',
    '- 文员，生成 ClawEmail 每日报告',
    '- 文员，今天机器人发了哪些邮件',
    '- 文员，把失败样本归档到 archive',
    '- 文员，把今天日报发到邮箱',
    '- 文员，整理一批客服训练数据并归档',
    '',
    '子邮箱可以做注册验证码测试和测试账号池，但我会优先做整理、归档、邮件摘要，不会碰服务器重启和清理。',
  ].join('\n');
}

function buildClerkMailboxRegistrationReply(env = process.env) {
  const verify = resolveMailboxAction('verify', env);
  const account = resolveMailboxAction('account', env);
  const archive = resolveMailboxAction('archive', env);

  return [
    '子邮箱注册测试玩法：可以用，但要当成测试账号池来管。',
    '',
    '适合注册的平台：',
    '- 你自己的电商平台、测试环境、开源演示站、允许测试账号的平台',
    '- 课程作业、UI 自动化练习、AI 客服训练环境',
    '',
    '不建议的做法：',
    '- 不要批量注册真实平台账号',
    '- 不要绕过验证码、风控、邀请码或平台限制',
    '- 不要把子邮箱当垃圾注册池用',
    '',
    '建议分工：',
    `- 验证码收件：${verify.mailbox || 'verify 邮箱未配置'}`,
    `- 账号专项结果：${account.mailbox || 'account 邮箱未配置'}`,
    `- 失败样本归档：${archive.mailbox || 'archive 邮箱未配置'}`,
    '',
    '我可以帮你生成“平台名、用途、邮箱、账号状态、验证码结果、失败截图链接”的测试账号池表格。',
  ].join('\n');
}

function buildClerkVerificationTestPlanReply(env = process.env) {
  const verify = resolveMailboxAction('verify', env);
  const report = resolveMailboxAction('report', env);
  const files = resolveMailboxAction('files', env);

  return [
    '注册验证码测试计划：',
    `- 收件邮箱：${verify.mailbox || 'verify 邮箱未配置'}`,
    `- 报告邮箱：${report.mailbox || 'report 邮箱未配置'}`,
    `- 附件归档：${files.mailbox || 'files 邮箱未配置'}`,
    '',
    '核心用例：',
    '- 合法邮箱注册：能收到验证码并完成注册',
    '- 验证码有效期：过期后不能继续使用',
    '- 错误验证码：连续错误后提示清楚并限流',
    '- 重复发送：按钮冷却、频率限制、邮件内容不混乱',
    '- 已注册邮箱：提示账号已存在，不泄露敏感信息',
    '',
    '自动化建议：Playwright 或 Cypress 负责页面操作，邮箱平台负责收验证码和归档结果。',
  ].join('\n');
}

function buildClerkMailboxTasksReply(env = process.env) {
  return [
    '今天邮箱任务队列：',
    `- 待执行：用 ${resolveMailboxAction('verify', env).mailbox || 'verify 邮箱'} 做注册验证码测试`,
    `- 待归档：把失败截图、trace、Allure 链接发到 ${resolveMailboxAction('files', env).mailbox || 'files 邮箱'}`,
    `- 待评测：把 OpenClaw/Hermes 对比结果发到 ${resolveMailboxAction('eval', env).mailbox || 'eval 邮箱'}`,
    `- 待日报：把今日测试摘要发到 ${resolveMailboxAction('daily', env).mailbox || 'daily 邮箱'}`,
    '',
    '默认不自动发送。你明确说“发送日报到邮箱”或“把这次报告归档到 report”时，我再调用邮件发送。',
    '要查历史发送记录，可以说：文员，今天机器人发了哪些邮件。',
    '其中 report / daily 可以优先走 evanshine 第二 SMTP；如果第二 SMTP 临时异常，会自动回退默认 SMTP。',
  ].join('\n');
}

function buildMailboxApprovalsReply(options = {}) {
  const env = options.env || process.env;
  const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(env, options);
  const queueFile = getMailApprovalQueueFile(env);
  const queue = buildApprovalQueueFromMessages(workbench.inbox || [], { now: (options.now || new Date()).toISOString() });
  writeMailApprovalQueue(queue, queueFile);
  return formatMailWorkbenchReply(workbench, { mode: 'pending' });
}

function buildMailboxApprovalActionReply(route = {}, options = {}) {
  const env = options.env || process.env;
  const queueFile = getMailApprovalQueueFile(env);
  const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(env, options);
  const queue = buildApprovalQueueFromMessages(workbench.inbox || [], { now: (options.now || new Date()).toISOString() });
  writeMailApprovalQueue(queue, queueFile);

  const actionResult = applyMailApprovalAction({
    action: route.approvalAction || 'approve',
    index: Number(route.index || 0),
  }, {
    env,
    queueFile,
    now: (options.now || new Date()).toISOString(),
  });

  if (!actionResult.ok) return actionResult.reply;
  const extra = [];
  if (route.approvalAction === 'approve') {
    extra.push('继续处理可以说：审批第 2 封并发送。');
  } else if (route.approvalAction === 'ignore') {
    extra.push('继续处理可以说：审批第 1 封并发送。');
  } else if (route.approvalAction === 'training-data' && actionResult.trainingSample) {
    extra.push(`训练数据主题：${actionResult.trainingSample.source?.subject || '无主题'}`);
  }
  return [actionResult.reply, ...extra].join('\n');
}

function buildMailboxDailyReportReply(options = {}) {
  const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(options.env || process.env, options);
  return [
    'ClawEmail 每日报告预览：',
    '',
    formatMailWorkbenchReply(workbench),
    '',
    '这份报告可以直接进入主动日报模板；要真实外发，请说：文员，发送今天日报到邮箱。',
  ].join('\n');
}

function buildMailLedgerReply(options = {}) {
  const env = options.env || process.env;
  const entries = (options.readMailLedger || defaultReadMailLedger)(env);
  const todayEntries = filterMailLedgerEntriesForDay(entries, {
    timezoneOffsetMinutes: Number(env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES || 480),
    now: options.now,
  });
  return buildMailLedgerSummaryReply(todayEntries);
}

function buildClerkMailboxReply(route = {}, options = {}) {
  if (route.action === 'mailbox-workbench') {
    return buildClerkMailboxWorkbenchReply(options.env || process.env, options);
  }
  if (route.action === 'mailbox-approvals') return buildMailboxApprovalsReply(options);
  if (route.action === 'mailbox-approval-action') return buildMailboxApprovalActionReply(route, options);
  if (route.action === 'mailbox-daily-report') return buildMailboxDailyReportReply(options);
  if (route.action === 'mailbox-registration-playbook') {
    return buildClerkMailboxRegistrationReply(options.env || process.env);
  }
  if (route.action === 'verification-test-plan') {
    return buildClerkVerificationTestPlanReply(options.env || process.env);
  }
  if (route.action === 'mailbox-tasks') {
    return buildClerkMailboxTasksReply(options.env || process.env);
  }
  if (route.action === 'mail-ledger') return buildMailLedgerReply(options);
  return null;
}

module.exports = {
  buildClerkMailboxRegistrationReply,
  buildClerkMailboxReply,
  buildClerkMailboxTasksReply,
  buildClerkMailboxWorkbenchReply,
  buildClerkVerificationTestPlanReply,
  buildMailLedgerReply,
  buildMailboxApprovalActionReply,
  buildMailboxApprovalsReply,
  buildMailboxDailyReportReply,
  isClerkMailboxAction,
};
