const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  filterMailLedgerEntriesForDay,
  readMailLedgerEntries,
} = require('./mail-ledger');

const CATEGORY_META = {
  'system-alert': { label: '系统告警', risk: 'high', approval: true },
  'customer-inquiry': { label: '客户咨询', risk: 'medium', approval: true },
  'after-sales': { label: '售后/退款', risk: 'high', approval: true },
  cooperation: { label: '商务合作', risk: 'medium', approval: true },
  recruitment: { label: '招聘/求职', risk: 'medium', approval: true },
  verification: { label: '验证码/测试账号', risk: 'low', approval: false },
  'internal-notice': { label: '内部通知', risk: 'low', approval: false },
  'spam-abnormal': { label: '垃圾/异常', risk: 'high', approval: true },
  unknown: { label: '未分类', risk: 'medium', approval: true },
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compactText(value, limit = 180) {
  const text = String(value || '')
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function getMessageId(message = {}) {
  return String(message.uid || message.id || message.messageId || message.mailId || '').trim();
}

function getMessageSearchText(message = {}) {
  return [
    message.from,
    message.subject,
    message.text,
    message.html,
    message.snippet,
    message.preview,
  ].map((value) => String(value || '')).join(' ').toLowerCase();
}

function classifyMailMessage(message = {}) {
  const text = getMessageSearchText(message);
  let category = 'unknown';

  if (/(告警|报警|异常|失败|unhealthy|health check|watchdog|error|failed|timeout|down|restart)/i.test(text)) {
    category = 'system-alert';
  } else if (/(退款|退货|换货|售后|坏了|损坏|投诉|赔偿|订单|物流|发货|收货|after.?sales|refund)/i.test(text)) {
    category = 'after-sales';
  } else if (/(验证码|校验码|注册|登录|找回密码|verify|verification|code|otp|\b\d{4,8}\b)/i.test(text)) {
    category = 'verification';
  } else if (/(合作|商务|渠道|投放|报价|采购|代理|对接|cooperation|partnership|collab)/i.test(text)) {
    category = 'cooperation';
  } else if (/(应届|简历|求职|招聘|面试|岗位|实习|毕业生|candidate|resume|recruit)/i.test(text)) {
    category = 'recruitment';
  } else if (/(咨询|客服|客户|问题|请问|帮助|support|question|inquiry)/i.test(text)) {
    category = 'customer-inquiry';
  } else if (/(日报|周报|内部|通知|归档|报告|agent|openclaw|hermes|clawemail)/i.test(text)) {
    category = 'internal-notice';
  }

  if (/(中奖|贷款|博彩|发票代开|点击领取|刷单|暴富|spam|casino)/i.test(text)) {
    category = 'spam-abnormal';
  }

  const meta = CATEGORY_META[category] || CATEGORY_META.unknown;
  return {
    category,
    label: meta.label,
    risk: meta.risk,
    requiresApproval: meta.approval,
    reason: buildCategoryReason(category),
  };
}

function buildCategoryReason(category) {
  const reasons = {
    'system-alert': '系统状态或告警类邮件，需要人工确认是否修复。',
    'customer-inquiry': '客户咨询类邮件，可以先生成草稿再审批。',
    'after-sales': '售后/退款类邮件风险较高，不自动答复。',
    cooperation: '商务合作类邮件需要确认口径。',
    recruitment: '招聘/求职类邮件适合人工审批后回复。',
    verification: '验证码/测试账号类邮件可自动归档，不建议展示完整验证码。',
    'internal-notice': '内部通知类邮件可直接归档。',
    'spam-abnormal': '疑似垃圾或异常邮件，建议隔离。',
    unknown: '未匹配明确规则，默认进入待审批。',
  };
  return reasons[category] || reasons.unknown;
}

function normalizeInboxMessage(message = {}) {
  const classification = classifyMailMessage(message);
  return {
    id: getMessageId(message) || `${message.from || 'unknown'}:${message.subject || 'no-subject'}`,
    mailbox: message.mailbox || '',
    from: String(message.from || message.sender || message.fromAddress || 'unknown'),
    subject: compactText(message.subject || '(无主题)', 120),
    date: message.date || message.receivedAt || message.timestamp || '',
    preview: compactText(message.text || message.snippet || message.preview || message.html || '', 220),
    ...classification,
  };
}

function extractPendingApprovalItems(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeInboxMessage)
    .filter((message) => message.requiresApproval)
    .slice(0, 20);
}

function countByCategory(messages = []) {
  const counts = {};
  for (const message of messages) {
    counts[message.category] = (counts[message.category] || 0) + 1;
  }
  return counts;
}

function summarizeOutgoing(mailEntries = []) {
  const safeEntries = Array.isArray(mailEntries) ? mailEntries : [];
  return {
    total: safeEntries.length,
    sent: safeEntries.filter((entry) => entry.sent).length,
    failed: safeEntries.filter((entry) => !entry.sent).length,
    byAction: safeEntries.reduce((acc, entry) => {
      const action = String(entry.action || 'unknown');
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {}),
  };
}

function buildMailWorkbenchReport(input = {}) {
  const assistant = input.assistant || 'OpenClaw';
  const day = input.day || '';
  const inbox = (Array.isArray(input.inboxMessages) ? input.inboxMessages : []).map(normalizeInboxMessage);
  const pending = extractPendingApprovalItems(input.inboxMessages || []);
  const outgoing = summarizeOutgoing(input.mailEntries || []);
  const categories = countByCategory(inbox);
  const summary = {
    received: inbox.length,
    sent: outgoing.sent,
    failedSent: outgoing.failed,
    pendingApproval: pending.length,
  };
  const topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${CATEGORY_META[category]?.label || category} ${count}`)
    .join('，') || '暂无';

  const text = [
    `${assistant} ClawEmail 邮箱工作台`,
    day ? `日期：${day}` : null,
    '',
    `概览：收信 ${summary.received} 封，成功发信 ${summary.sent} 封，失败发信 ${summary.failedSent} 封，待审批 ${summary.pendingApproval} 封。`,
    `分类：${topCategories}`,
    '',
    '待审批邮件：',
    ...(pending.length
      ? pending.slice(0, 8).map((item, index) => `${index + 1}. [${item.label}] ${item.subject} - ${item.from}。建议：${item.reason}`)
      : ['暂无待审批邮件。']),
    '',
    '自动处理建议：',
    '- 验证码/测试账号邮件：自动归档到 verify/account，不外发。',
    '- 内部通知/日报：自动归档到 daily/archive。',
    '- 客户、售后、合作、招聘、异常邮件：先生成草稿，等你说“审批第 N 封并发送”。',
    '',
    '可复制指令：',
    '- 文员，列出待审批邮件',
    '- 文员，把客户咨询整理成客服训练数据',
    '- 文员，生成 ClawEmail 每日报告',
  ].filter(Boolean).join('\n');

  const statCards = [
    ['收到', summary.received],
    ['发出', summary.sent],
    ['待审批', summary.pendingApproval],
    ['失败', summary.failedSent],
  ];
  const html = [
    '<div class="mail-workbench">',
    '<style>',
    '.mail-workbench{font-family:Inter,Arial,sans-serif;background:#f5f7fb;color:#162033;padding:20px;line-height:1.55}',
    '.mail-shell{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e1e8f0;border-radius:8px;overflow:hidden}',
    '.mail-hero{text-align:center;padding:24px 20px;border-bottom:1px solid #edf2f7}',
    '.mail-hero h2{margin:4px 0 0;font-size:23px}',
    '.mail-logo{font-size:38px}',
    '.mail-body{padding:20px}',
    '.mail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}',
    '.mail-card{background:#f8fafc;border:1px solid #e5edf5;border-radius:8px;text-align:center;padding:12px}',
    '.mail-value{font-size:22px;font-weight:700}',
    '.mail-label{font-size:12px;color:#69758a}',
    '.mail-section{border-top:1px solid #edf2f7;margin-top:16px;padding-top:14px}',
    '.mail-section h3{font-size:16px;margin:0 0 8px}',
    '.mail-button{display:inline-block;margin-top:12px;padding:9px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px}',
    '@media(max-width:680px){.mail-grid{grid-template-columns:1fr 1fr}.mail-workbench{padding:10px}}',
    '</style>',
    '<div class="mail-shell">',
    '<div class="mail-hero">',
    '<div class="mail-logo">ClawEmail</div>',
    `<h2>${esc(assistant)} 邮箱每日工作台</h2>`,
    day ? `<div style="color:#69758a">${esc(day)}</div>` : '',
    '</div>',
    '<div class="mail-body">',
    `<p>收信 ${esc(summary.received)} 封，成功发信 ${esc(summary.sent)} 封，失败 ${esc(summary.failedSent)} 封，待审批 ${esc(summary.pendingApproval)} 封。</p>`,
    '<div class="mail-grid">',
    ...statCards.map(([label, value]) => `<div class="mail-card"><div class="mail-value">${esc(value)}</div><div class="mail-label">${esc(label)}</div></div>`),
    '</div>',
    '<div class="mail-section"><h3>AI 分类摘要</h3>',
    `<p>${esc(topCategories)}</p>`,
    '</div>',
    '<div class="mail-section"><h3>待审批</h3><ol>',
    ...(pending.length
      ? pending.slice(0, 8).map((item) => `<li><strong>${esc(item.label)}</strong> ${esc(item.subject)} - ${esc(item.from)}</li>`)
      : ['<li>暂无待审批邮件</li>']),
    '</ol></div>',
    '<div class="mail-section"><h3>建议</h3><p>低风险邮件自动归档，高风险邮件生成草稿后等待审批。</p><a class="mail-button" href="https://claw.163.com/">前往后台</a></div>',
    '</div></div></div>',
  ].join('\n');

  return {
    assistant,
    day,
    summary,
    categories,
    inbox,
    pending,
    outgoing,
    text,
    html,
  };
}

function formatMailWorkbenchReply(report = {}, options = {}) {
  const mode = options.mode || 'overview';
  const pending = Array.isArray(report.pending) ? report.pending : [];
  if (mode === 'pending') {
    return [
      '待审批邮件：',
      ...(pending.length
        ? pending.slice(0, 10).map((item, index) => `${index + 1}. [${item.label}] ${item.subject} - ${item.from}\n   处理建议：${item.reason}\n   继续：审批第 ${index + 1} 封并发送 / 忽略第 ${index + 1} 封`)
        : ['暂无待审批邮件。']),
      '',
      '默认不会自动批准、自动发送或替你承诺退款/合作/录用。需要你明确审批。',
    ].join('\n');
  }

  return report.text || '邮箱工作台暂无数据。';
}

function readInboxMessagesFromState(stateFile) {
  if (!stateFile || !existsSync(stateFile)) {
    return [];
  }
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (Array.isArray(state.recentMessages)) return state.recentMessages;
    if (Array.isArray(state.latestMessages)) return state.latestMessages;
    return [];
  } catch {
    return [];
  }
}

function getMailWorkbenchStateFile(env = process.env) {
  return env.CLAWEMAIL_WORKBENCH_STATE_FILE
    || env.CLAWEMAIL_INBOX_STATE_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'clawemail-inbox-state.json');
}

function buildMailWorkbenchReportFromEnv(env = process.env, options = {}) {
  const timezoneOffsetMinutes = Number(env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES || env.MAIL_LEDGER_TZ_OFFSET_MINUTES || 480);
  const now = options.now || new Date();
  const day = options.day || (() => {
    const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  })();
  const readInbox = options.readInboxMessages || (() => readInboxMessagesFromState(getMailWorkbenchStateFile(env)));
  const inboxMessages = readInbox(env);
  const mailEntries = filterMailLedgerEntriesForDay(
    (options.readMailLedger || readMailLedgerEntries)(env, 200),
    { day, timezoneOffsetMinutes, now },
  );

  return buildMailWorkbenchReport({
    assistant: env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || 'OpenClaw',
    day,
    inboxMessages,
    mailEntries,
  });
}

module.exports = {
  buildMailWorkbenchReport,
  buildMailWorkbenchReportFromEnv,
  classifyMailMessage,
  extractPendingApprovalItems,
  formatMailWorkbenchReply,
  getMailWorkbenchStateFile,
  normalizeInboxMessage,
  readInboxMessagesFromState,
};
