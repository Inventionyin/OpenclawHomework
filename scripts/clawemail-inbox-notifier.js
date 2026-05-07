const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { sendFeishuTextMessage } = require('./feishu-bridge');
const { parseEnvFile } = require('./server-watchdog');

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  return {
    once: args.includes('--once') || String(env.CLAWEMAIL_INBOX_ONCE || '').toLowerCase() === 'true',
    envFile: readOption(args, '--env-file', env.CLAWEMAIL_INBOX_ENV_FILE || env.FEISHU_ENV_FILE || ''),
    stateFile: readOption(args, '--state-file', env.CLAWEMAIL_INBOX_STATE_FILE || '/var/lib/openclaw-homework/clawemail-inbox-state.json'),
    intervalMs: Number(readOption(args, '--interval-ms', env.CLAWEMAIL_INBOX_INTERVAL_MS || '60000')),
    limit: Number(readOption(args, '--limit', env.CLAWEMAIL_INBOX_LIMIT || '20')),
    inboxFid: readOption(args, '--fid', env.CLAWEMAIL_INBOX_FID || '1'),
    mailbox: readOption(args, '--mailbox', env.CLAWEMAIL_INBOX_MAILBOX || env.EMAIL_FROM || env.SMTP_USER || ''),
  };
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
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function compactMessageForState(message = {}) {
  return {
    uid: getMessageId(message),
    mailbox: message.mailbox || '',
    from: message.from || '',
    subject: message.subject || '',
    date: message.date || '',
    text: compactText(message.text || message.html || '', 500),
  };
}

function mergeRecentMessages(previous = [], incoming = [], limit = 80) {
  const merged = [];
  const seen = new Set();
  for (const message of [...incoming, ...(Array.isArray(previous) ? previous : [])]) {
    const compact = compactMessageForState(message);
    const key = compact.uid || `${compact.from}:${compact.subject}:${compact.date}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(compact);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function normalizeUid(value) {
  const uid = Number(value);
  return Number.isFinite(uid) ? uid : 0;
}

function getMessageId(message) {
  return String(message?.uid || message?.id || message?.messageId || '').trim();
}

function filterNewMessages(messages = [], state = {}) {
  const sorted = [...messages].filter((message) => getMessageId(message));
  const hasOnlyNumericIds = sorted.every((message) => normalizeUid(message.uid) > 0);
  if (hasOnlyNumericIds) {
    sorted.sort((a, b) => normalizeUid(a.uid) - normalizeUid(b.uid));
  }
  const maxUid = sorted.reduce((max, message) => Math.max(max, normalizeUid(message.uid)), normalizeUid(state.lastUid));
  const seen = new Set(Array.isArray(state.seenMessageIds) ? state.seenMessageIds.map(String) : []);
  const currentIds = sorted.map(getMessageId).filter(Boolean);
  const nextState = {
    ...state,
    lastUid: maxUid || state.lastUid,
    seenMessageIds: [...currentIds, ...Array.from(seen)].filter((id, index, all) => all.indexOf(id) === index).slice(0, 200),
    updatedAt: new Date().toISOString(),
  };

  if (!state.lastUid && !seen.size && !state.baselineInitialized) {
    return {
      newMessages: [],
      nextState: {
        ...nextState,
        baselineInitialized: true,
      },
    };
  }

  return {
    newMessages: hasOnlyNumericIds
      ? sorted.filter((message) => normalizeUid(message.uid) > normalizeUid(state.lastUid))
      : sorted.filter((message) => !seen.has(getMessageId(message))),
    nextState,
  };
}

function buildNotificationTarget(env = process.env) {
  const receiveId = env.CLAWEMAIL_NOTIFY_RECEIVE_ID
    || env.FEISHU_NOTIFY_RECEIVE_ID
    || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID
    || String(env.HERMES_FEISHU_ALLOWED_USER_IDS || env.FEISHU_ALLOWED_USER_IDS || '').split(',')[0].trim();

  if (!receiveId) {
    return null;
  }

  return {
    receiveId,
    receiveIdType: env.CLAWEMAIL_NOTIFY_RECEIVE_ID_TYPE
      || env.FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || 'open_id',
  };
}

function compactText(value, maxLength = 360) {
  const text = String(value || '')
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function buildInboxNotificationText(message, options = {}) {
  const assistantName = options.assistantName || 'Hermes';
  return [
    `${assistantName} 收到新邮件`,
    `收件箱：${message.mailbox || options.mailbox || 'unknown'}`,
    `来自：${message.from || 'unknown'}`,
    `主题：${message.subject || '(无主题)'}`,
    message.date ? `时间：${message.date}` : '',
    '',
    `摘要：${compactText(message.text || message.html || '') || '(无正文摘要)'}`,
    '',
    '你可以回复：处理这封邮件 / 生成客服回复 / 归档到训练语料。',
  ].filter((line) => line !== '').join('\n');
}

function parseMailCliJson(output) {
  const text = String(output || '').trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.messages)) {
    return parsed.messages;
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return [];
}

function execFileJson(execFile, command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function extractBodyText(parsed) {
  const data = parsed?.data || parsed;
  if (!data) {
    return '';
  }
  if (typeof data.text === 'string') {
    return data.text;
  }
  if (typeof data.text?.content === 'string') {
    return data.text.content;
  }
  if (typeof data.content === 'string') {
    return data.content;
  }
  return '';
}

async function fetchMessagesWithMailCli(config, env = process.env, options = {}) {
  const execFile = options.execFile || require('node:child_process').execFile;
  const command = env.CLAWEMAIL_MAIL_CLI_BIN || 'mail-cli';
  const timeoutMs = Number(env.CLAWEMAIL_MAIL_CLI_TIMEOUT_MS || 30000);
  const args = [
    '--json',
    'mail',
    'list',
    '--fid',
    String(config.inboxFid || '1'),
    '--desc',
    '--limit',
    String(config.limit || 20),
  ];

  const stdout = await execFileJson(execFile, command, args, timeoutMs);
  const messages = parseMailCliJson(stdout).map((message) => ({
    uid: message.uid || message.id || message.messageId || message.mailId,
    mailbox: message.mailbox || config.mailbox,
    from: Array.isArray(message.from) ? message.from.join(', ') : (message.from || message.sender || message.fromAddress || ''),
    subject: message.subject || '',
    date: message.date || message.receivedAt || message.timestamp || '',
    text: message.text || message.snippet || message.preview || '',
    html: message.html || '',
  }));

  if (!config.readBody && String(env.CLAWEMAIL_INBOX_READ_BODY || '').toLowerCase() !== 'true') {
    return messages;
  }

  for (const message of messages) {
    if (message.text || !message.uid) {
      continue;
    }
    try {
      const bodyOutput = await execFileJson(execFile, command, ['--json', 'read', 'body', '--id', String(message.uid)], timeoutMs);
      const parsed = JSON.parse(bodyOutput);
      message.text = extractBodyText(parsed);
    } catch {
      // List output is enough for a notification; body fetch is best-effort.
    }
  }

  return messages;
}

async function notifyMessage(message, env, options = {}) {
  const target = buildNotificationTarget(env);
  if (!target) {
    return { sent: false, reason: 'missing_target' };
  }

  const text = buildInboxNotificationText(message, {
    assistantName: env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || 'Hermes',
    mailbox: message.mailbox,
  });
  await (options.sendFeishuTextMessage || sendFeishuTextMessage)(env, {
    receiveIdType: target.receiveIdType,
    receiveId: target.receiveId,
    msgType: 'text',
    content: JSON.stringify({ text }),
  }, options.fetchImpl);

  return { sent: true };
}

async function runInboxNotifierOnce(config, env = process.env, options = {}) {
  const mergedEnv = { ...env, ...parseEnvFile(config.envFile) };
  const state = readState(config.stateFile);
  if (String(mergedEnv.CLAWEMAIL_NOTIFY_FIRST_MESSAGE_AFTER_EMPTY_BASELINE || '').toLowerCase() === 'true'
    && state.baselineInitialized
    && Array.isArray(state.seenMessageIds)
    && state.seenMessageIds.length === 0) {
    state.lastUid = state.lastUid || -1;
  }
  const fetchMessages = options.fetchMessages || ((runnerConfig, runnerEnv) => fetchMessagesWithMailCli(runnerConfig, runnerEnv, options));
  const messages = await fetchMessages(config, mergedEnv);
  const { newMessages, nextState } = filterNewMessages(messages, state);
  let notified = 0;
  const notifyEnabled = String(mergedEnv.CLAWEMAIL_NOTIFY_ENABLED || 'true').toLowerCase() !== 'false';

  if (notifyEnabled) {
    for (const message of newMessages) {
      const result = await notifyMessage(message, mergedEnv, options).catch((error) => ({ sent: false, reason: error.message }));
      if (result.sent) {
        notified += 1;
      }
    }
  }

  writeState(config.stateFile, {
    ...nextState,
    mailbox: config.mailbox || mergedEnv.CLAWEMAIL_INBOX_MAILBOX || mergedEnv.EMAIL_FROM || mergedEnv.SMTP_USER || '',
    fetched: messages.length,
    notified,
    recentMessages: mergeRecentMessages(state.recentMessages, newMessages, Number(mergedEnv.CLAWEMAIL_WORKBENCH_RECENT_LIMIT || 80)),
  });

  return {
    status: 'ok',
    fetched: messages.length,
    newMessages: newMessages.length,
    notified,
    lastUid: nextState.lastUid,
  };
}

async function main() {
  const config = parseCliArgs();
  do {
    const summary = await runInboxNotifierOnce(config);
    console.log(JSON.stringify(summary));
    if (config.once) {
      break;
    }
    await sleep(config.intervalMs);
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildInboxNotificationText,
  buildNotificationTarget,
  compactText,
  fetchMessagesWithMailCli,
  filterNewMessages,
  mergeRecentMessages,
  parseCliArgs,
  parseMailCliJson,
  runInboxNotifierOnce,
};
