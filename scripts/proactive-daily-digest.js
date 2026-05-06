#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const {
  filterMailLedgerEntriesForDay,
  readMailLedgerEntries,
} = require('./mail-ledger');
const {
  readUsageLedgerEntries,
} = require('./usage-ledger');
const {
  sendMailboxActionEmail,
} = require('./feishu-bridge');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    once: false,
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--once') args.once = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--env-file') {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === '--to') {
      args.to = argv[index + 1];
      index += 1;
    } else if (arg === '--day') {
      args.day = argv[index + 1];
      index += 1;
    } else if (arg === '--state-file') {
      args.stateFile = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function getAssistantName(env = process.env) {
  return String(env.PROACTIVE_DIGEST_ASSISTANT_NAME || env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || 'OpenClaw').trim();
}

function getTimezoneOffsetMinutes(env = process.env) {
  return Number(env.PROACTIVE_DIGEST_TZ_OFFSET_MINUTES || env.MAIL_LEDGER_TZ_OFFSET_MINUTES || 480);
}

function getDayKey(now = new Date(), timezoneOffsetMinutes = 480) {
  const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function formatDateLabel(day) {
  return `${day}（Agent 日报）`;
}

function readState(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
  if (!filePath) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function summarizeUsage(entries = []) {
  const total = entries.reduce((sum, entry) => sum + Number(entry.totalTokens || entry.estimatedTotalTokens || 0), 0);
  const byAssistant = new Map();
  for (const entry of entries) {
    const key = String(entry.assistant || 'unknown');
    const current = byAssistant.get(key) || { assistant: key, calls: 0, tokens: 0, elapsedMs: 0 };
    current.calls += 1;
    current.tokens += Number(entry.totalTokens || entry.estimatedTotalTokens || 0);
    current.elapsedMs += Number(entry.modelElapsedMs || entry.elapsedMs || 0);
    byAssistant.set(key, current);
  }
  return {
    calls: entries.length,
    totalTokens: total,
    byAssistant: Array.from(byAssistant.values()).sort((a, b) => b.tokens - a.tokens),
  };
}

function summarizeMail(entries = []) {
  const sent = entries.filter((entry) => entry.sent).length;
  const failed = entries.filter((entry) => !entry.sent).length;
  const outgoing = entries.reduce((sum, entry) => sum + Number(entry.recipientCount || 0), 0);
  const actions = new Map();
  for (const entry of entries) {
    const action = String(entry.action || 'unknown');
    actions.set(action, (actions.get(action) || 0) + 1);
  }
  return {
    total: entries.length,
    sent,
    failed,
    outgoing,
    actions: Array.from(actions.entries()).map(([name, count]) => ({ name, count })),
  };
}

function runCommand(command, args = [], options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout || 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    return '';
  }
}

function collectServerSnapshot() {
  const disk = runCommand('df', ['-h', '/']).split(/\r?\n/).slice(-1)[0] || '';
  const memory = runCommand('free', ['-h']).split(/\r?\n/).find((line) => /^Mem:/.test(line)) || '';
  const load = runCommand('cat', ['/proc/loadavg']).split(/\s+/).slice(0, 3).join(' ');
  return { disk, memory, load };
}

function defaultNewsItems(env = process.env) {
  const configured = String(env.PROACTIVE_DIGEST_NEWS_ITEMS || '').trim();
  if (configured) {
    return configured.split(/\s*\|\s*/).filter(Boolean).slice(0, 8).map((title, index) => ({
      title,
      source: `自定义源 ${index + 1}`,
    }));
  }

  return [
    { title: 'AI Agent：继续关注多 Agent 协作、工具调用稳定性和长期记忆。', source: 'AI 趋势' },
    { title: '软件测试：优先沉淀 UI 自动化、报告归档、失败复盘和测试账号池。', source: 'QA 趋势' },
    { title: '工程效率：把“聊天触发任务”升级为“定时主动产出”是下一阶段重点。', source: '工程实践' },
  ];
}

function buildAiSummary({ assistant, mailSummary, usageSummary, server }) {
  const parts = [
    `${assistant} 今日主动巡检完成。`,
    `邮件动作 ${mailSummary.total} 条，成功 ${mailSummary.sent} 条，失败 ${mailSummary.failed} 条。`,
    usageSummary.calls ? `模型调用账本 ${usageSummary.calls} 条，token 约 ${usageSummary.totalTokens}。` : '模型调用账本今日暂无新增。',
    server.disk ? `根分区状态：${server.disk.replace(/\s+/g, ' ')}。` : '服务器磁盘状态未取到。',
  ];
  return parts.join('');
}

function buildDigest(input = {}) {
  const assistant = input.assistant || 'OpenClaw';
  const day = input.day || getDayKey(input.now || new Date(), input.timezoneOffsetMinutes);
  const mailSummary = summarizeMail(input.mailEntries || []);
  const usageSummary = summarizeUsage(input.usageEntries || []);
  const server = input.server || {};
  const newsItems = input.newsItems || defaultNewsItems(input.env || {});
  const aiSummary = input.aiSummary || buildAiSummary({ assistant, mailSummary, usageSummary, server });
  const workItems = [
    mailSummary.total ? `处理邮件动作 ${mailSummary.total} 条，成功 ${mailSummary.sent} 条。` : '暂无邮件动作，但收信通知器保持在线。',
    usageSummary.calls ? `记录模型调用 ${usageSummary.calls} 条，token 约 ${usageSummary.totalTokens}。` : '暂无模型调用账本，适合今天跑一轮训练场。',
    server.load ? `服务器负载 ${server.load}。` : '服务器负载未记录。',
  ];

  const text = [
    `每日 Agent 主动报告：${assistant}`,
    `日期：${day}`,
    '',
    `AI 总结：${aiSummary}`,
    '',
    `收发信：${mailSummary.sent} 封成功 / ${mailSummary.failed} 封失败 / ${mailSummary.outgoing} 个收件投递`,
    `模型：${usageSummary.calls} 次调用 / ${usageSummary.totalTokens} tokens`,
    server.disk ? `硬盘：${server.disk.replace(/\s+/g, ' ')}` : null,
    server.memory ? `内存：${server.memory.replace(/\s+/g, ' ')}` : null,
    '',
    '今日处理：',
    ...workItems.map((item, index) => `${index + 1}. ${item}`),
    '',
    '新闻日报：',
    ...newsItems.map((item, index) => `${index + 1}. ${item.title}（${item.source || 'news'}）`),
    '',
    '明日建议：',
    '- 跑一次 UI 自动化冒烟测试并归档 Allure 报告。',
    '- 让文员 Agent 生成客服训练数据并消耗一批低价 token。',
    '- 检查邮件账本，确认日报和报告都能从主邮箱正常外发。',
  ].filter(Boolean).join('\n');

  const statCards = [
    ['收信/动作', mailSummary.total],
    ['发信成功', mailSummary.sent],
    ['失败', mailSummary.failed],
    ['Token', usageSummary.totalTokens],
  ];
  const html = [
    '<div class="proactive-digest">',
    '<style>',
    '.proactive-digest{font-family:Inter,Arial,sans-serif;background:#f3f6fb;color:#172033;padding:22px;line-height:1.58}',
    '.digest-shell{max-width:760px;margin:0 auto;background:#fff;border:1px solid #dde6f0;border-radius:8px;overflow:hidden}',
    '.digest-hero{padding:26px 24px;text-align:center;background:#ffffff;border-bottom:1px solid #e6edf5}',
    '.digest-icon{font-size:42px;margin-bottom:8px}',
    '.digest-hero h2{margin:0;font-size:24px}',
    '.digest-date{margin-top:8px;color:#69758a}',
    '.digest-body{padding:22px 24px}',
    '.digest-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 18px}',
    '.digest-card{border:1px solid #e3ebf4;border-radius:8px;padding:12px;background:#f8fafc;text-align:center}',
    '.digest-value{font-size:22px;font-weight:700;color:#162033}',
    '.digest-label{font-size:12px;color:#69758a;margin-top:4px}',
    '.digest-section{border-top:1px solid #edf2f7;padding-top:16px;margin-top:16px}',
    '.digest-section h3{font-size:16px;margin:0 0 8px}',
    '.digest-section p{margin:0;color:#344156}',
    '.digest-section ol,.digest-section ul{margin:0;padding-left:20px}',
    '.digest-section li{margin:6px 0}',
    '.digest-meta{font-size:12px;color:#748197;margin-top:14px}',
    '@media (max-width:720px){.proactive-digest{padding:12px}.digest-body,.digest-hero{padding-left:16px;padding-right:16px}.digest-grid{grid-template-columns:1fr 1fr}}',
    '</style>',
    '<div class="digest-shell">',
    '<div class="digest-hero">',
    '<div class="digest-icon">📮</div>',
    `<h2>${esc(assistant)} 每日主动报告</h2>`,
    `<div class="digest-date">${esc(formatDateLabel(day))}</div>`,
    '</div>',
    '<div class="digest-body">',
    '<div class="digest-section" style="border-top:0;margin-top:0;padding-top:0">',
    `<p>${esc(aiSummary)}</p>`,
    '</div>',
    '<div class="digest-grid">',
    ...statCards.map(([label, value]) => `<div class="digest-card"><div class="digest-value">${esc(value)}</div><div class="digest-label">${esc(label)}</div></div>`),
    '</div>',
    '<div class="digest-section"><h3>今日处理</h3><ol>',
    ...workItems.map((item) => `<li>${esc(item)}</li>`),
    '</ol></div>',
    '<div class="digest-section"><h3>新闻日报</h3><ol>',
    ...newsItems.map((item) => `<li>${esc(item.title)} <span style="color:#748197">(${esc(item.source || 'news')})</span></li>`),
    '</ol></div>',
    '<div class="digest-section"><h3>服务器状态</h3><ul>',
    `<li>硬盘：${esc(server.disk || '未记录')}</li>`,
    `<li>内存：${esc(server.memory || '未记录')}</li>`,
    `<li>负载：${esc(server.load || '未记录')}</li>`,
    '</ul></div>',
    '<div class="digest-section"><h3>明日建议</h3><ul>',
    '<li>跑一次 UI 自动化冒烟测试并归档 Allure 报告。</li>',
    '<li>让文员 Agent 生成客服训练数据并消耗一批低价 token。</li>',
    '<li>检查邮件账本，确认日报和报告都能从主邮箱正常外发。</li>',
    '</ul></div>',
    '<div class="digest-meta">由 OpenclawHomework proactive-daily-digest 自动生成。</div>',
    '</div></div></div>',
  ].join('\n');

  return {
    action: 'daily',
    mailbox: 'agent4.daily@claw.163.com',
    subject: `[Agent Daily] ${assistant} 每日主动报告 ${day}`,
    text,
    html,
    externalTo: input.externalTo || [],
    archiveTo: ['agent4.daily@claw.163.com'],
  };
}

async function runDigest(options = {}) {
  const env = { ...process.env, ...loadEnvFile(options.envFile), ...(options.env || {}) };
  const timezoneOffsetMinutes = getTimezoneOffsetMinutes(env);
  const day = options.day || getDayKey(new Date(), timezoneOffsetMinutes);
  const stateFile = options.stateFile || env.PROACTIVE_DIGEST_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'proactive-daily-digest-state.json');
  const state = readState(stateFile);
  if (!options.force && state.lastSentDay === day) {
    return { sent: false, reason: 'already_sent', day };
  }

  const recipient = options.to || env.PROACTIVE_DIGEST_TO || env.DAILY_SUMMARY_EXTERNAL_TO || env.EMAIL_TO;
  const externalTo = String(recipient || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  const allMailEntries = readMailLedgerEntries(env, 400);
  const mailEntries = filterMailLedgerEntriesForDay(allMailEntries, { day, timezoneOffsetMinutes });
  const usageEntries = readUsageLedgerEntries(env, 400).filter((entry) => {
    const timestamp = entry.timestamp || '';
    return filterMailLedgerEntriesForDay([{ timestamp }], { day, timezoneOffsetMinutes }).length > 0;
  });
  const digest = buildDigest({
    assistant: getAssistantName(env),
    day,
    mailEntries,
    usageEntries,
    server: collectServerSnapshot(),
    newsItems: defaultNewsItems(env),
    externalTo,
    env,
  });
  const message = {
    ...digest,
    to: [...externalTo, 'agent4.daily@claw.163.com'],
  };

  if (options.dryRun) {
    return { sent: false, reason: 'dry_run', day, message };
  }

  if (!externalTo.length && String(env.PROACTIVE_DIGEST_REQUIRE_EXTERNAL_TO || 'true').toLowerCase() !== 'false') {
    return { sent: false, reason: 'missing_external_recipient', day, message };
  }

  const result = await sendMailboxActionEmail(message, env);
  if (result.sent) {
    writeState(stateFile, { lastSentDay: day, lastSentAt: new Date().toISOString(), assistant: getAssistantName(env) });
  }
  return { ...result, day, message };
}

async function main() {
  const args = parseArgs();
  const result = await runDigest(args);
  console.log(JSON.stringify({
    sent: result.sent,
    reason: result.reason,
    day: result.day,
    subject: result.message?.subject,
  }, null, 2));
  if (!result.sent && result.reason && !['already_sent', 'dry_run'].includes(result.reason)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildDigest,
  collectServerSnapshot,
  defaultNewsItems,
  getDayKey,
  parseArgs,
  runDigest,
};
