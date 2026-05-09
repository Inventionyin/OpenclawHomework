const { appendFileSync, existsSync, mkdirSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const SECRET_FIELD_PATTERN = /(pass|password|token|secret|key|authorization|auth)/i;

function getMailLedgerPath(env = process.env) {
  return String(
    env.MAIL_LEDGER_PATH
      || env.FEISHU_MAIL_LEDGER_PATH
      || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'mail-ledger.jsonl'),
  ).trim();
}

function isMailLedgerEnabled(env = process.env) {
  return String(env.MAIL_LEDGER_ENABLED || env.FEISHU_MAIL_LEDGER_ENABLED || 'false').toLowerCase() === 'true';
}

function asEmailList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimText(value, limit = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function sanitizeEntry(input = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      continue;
    }
    safe[key] = value;
  }

  const to = asEmailList(safe.to);
  return {
    timestamp: safe.timestamp || new Date().toISOString(),
    traceId: safe.traceId || safe.trace_id,
    assistant: trimText(safe.assistant || 'unknown', 80),
    action: trimText(safe.action || 'unknown', 80),
    provider: trimText(safe.provider || 'unknown', 80),
    sent: Boolean(safe.sent),
    reason: safe.reason ? trimText(safe.reason, 120) : undefined,
    fallbackFrom: safe.fallbackFrom ? trimText(safe.fallbackFrom, 80) : undefined,
    subject: trimText(safe.subject || '', 180),
    to,
    externalTo: asEmailList(safe.externalTo),
    archiveTo: asEmailList(safe.archiveTo),
    recipientCount: to.length || asEmailList(safe.externalTo).length + asEmailList(safe.archiveTo).length,
  };
}

function compactEntry(entry) {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

function appendMailLedgerEntry(env = process.env, input = {}) {
  if (!isMailLedgerEnabled(env)) {
    return false;
  }

  const file = getMailLedgerPath(env);
  if (!file) {
    return false;
  }

  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(compactEntry(sanitizeEntry(input)))}\n`, 'utf8');
  return true;
}

function readMailLedgerEntries(env = process.env, limit = 80) {
  const file = getMailLedgerPath(env);
  if (!file || !existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseDayKey(date, timezoneOffsetMinutes = 480) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    return '';
  }

  const shifted = new Date(value.getTime() + Number(timezoneOffsetMinutes || 0) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function filterMailLedgerEntriesForDay(entries = [], options = {}) {
  const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes ?? 480);
  const day = options.day || parseDayKey(options.now || new Date(), timezoneOffsetMinutes);
  return (Array.isArray(entries) ? entries : []).filter((entry) => (
    parseDayKey(entry.timestamp, timezoneOffsetMinutes) === day
  ));
}

function formatRecipients(entry = {}) {
  const external = asEmailList(entry.externalTo);
  const archive = asEmailList(entry.archiveTo);
  if (external.length || archive.length) {
    return [
      external.length ? `外发 ${external.join(', ')}` : null,
      archive.length ? `归档 ${archive.join(', ')}` : null,
    ].filter(Boolean).join('；');
  }

  const to = asEmailList(entry.to);
  return to.length ? to.join(', ') : '未记录收件人';
}

function buildMailLedgerSummaryReply(entries = []) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!safeEntries.length) {
    return [
      '邮件发送账本：最近还没有记录。',
      '等你让机器人发日报、发 UI 自动化报告、归档训练样本后，我会记录动作、通道、收件人和主题。',
    ].join('\n');
  }

  const lines = [
    `邮件发送账本：最近 ${safeEntries.length} 条。`,
  ];

  safeEntries.slice(-10).reverse().forEach((entry, index) => {
    const time = String(entry.timestamp || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z');
    const sentText = entry.sent ? '已发送' : `未发送${entry.reason ? `（${entry.reason}）` : ''}`;
    const provider = entry.fallbackFrom
      ? `${entry.provider || 'unknown'}（从 ${entry.fallbackFrom} 回退）`
      : (entry.provider || 'unknown');
    lines.push(`${index + 1}. ${time} ${entry.assistant || 'unknown'} / ${entry.action || 'unknown'}：${sentText}，通道 ${provider}`);
    lines.push(`   收件：${formatRecipients(entry)}`);
    if (entry.subject) {
      lines.push(`   主题：${trimText(entry.subject, 120)}`);
    }
  });

  return lines.join('\n');
}

module.exports = {
  appendMailLedgerEntry,
  buildMailLedgerSummaryReply,
  filterMailLedgerEntriesForDay,
  getMailLedgerPath,
  isMailLedgerEnabled,
  readMailLedgerEntries,
};
