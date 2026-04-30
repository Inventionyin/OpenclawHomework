const http = require('node:http');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  dispatchWorkflow,
  parseCliArgs,
  waitForWorkflowCompletion,
} = require('./trigger-ui-tests');
const {
  looksLikeTestHowToQuestion,
  looksLikeTestNegation,
  routeAgentIntent,
} = require('./agents/router');
const {
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
} = require('./agents/agent-handlers');

const VALID_RUN_MODES = new Set(['contracts', 'smoke', 'all']);
let openClawCliQueue = Promise.resolve();
const seenFeishuEventKeys = new Map();
const scheduledFeishuNotificationKeys = new Map();

function parseJsonContent(content) {
  if (typeof content !== 'string') {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch {
    return { text: content };
  }
}

function extractFeishuText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.text === 'string') {
    return payload.text.trim();
  }

  if (typeof payload.message?.text === 'string') {
    return payload.message.text.trim();
  }

  const eventContent = payload.event?.message?.content;
  const content = parseJsonContent(eventContent);
  if (typeof content?.text === 'string') {
    return content.text.trim();
  }

  return '';
}

function parseRunUiTestCommand(text) {
  const commandText = String(text ?? '').trim().replace(/^@\S+\s*/, '');
  if (looksLikeTestHowToQuestion(commandText) || looksLikeTestNegation(commandText)) {
    return null;
  }

  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const commandIndex = parts.findIndex((part) => part === '/run-ui-test' || part === 'run-ui-test');
  if (commandIndex === -1) {
    return null;
  }

  const targetRef = parts[commandIndex + 1] || 'main';
  const runMode = parts[commandIndex + 2] || 'contracts';
  if (!VALID_RUN_MODES.has(runMode)) {
    throw new Error(`Unsupported run mode: ${runMode}. Use contracts, smoke, or all.`);
  }

  return {
    targetRef,
    runMode,
  };
}

function normalizeOpenClawCommand(command) {
  if (!command || typeof command !== 'object') {
    return null;
  }

  if (command.intent === 'none' || command.intent === 'chat') {
    return null;
  }

  if (command.intent && command.intent !== 'run-ui-test') {
    return null;
  }

  const targetRef = String(command.targetRef || command.target_ref || command.ref || 'main').trim();
  const runMode = String(command.runMode || command.run_mode || 'contracts').trim();
  if (!VALID_RUN_MODES.has(runMode)) {
    throw new Error(`Unsupported run mode from OpenClaw: ${runMode}`);
  }

  return {
    targetRef: targetRef || 'main',
    runMode,
  };
}

function parseOpenClawCommandOutput(output) {
  const text = String(output ?? '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return normalizeOpenClawCommand(parsed);
}

function buildOpenClawPrompt(text) {
  return [
    '你是飞书 UI 自动化指令解析器，只输出 JSON，不要解释。',
    '目标：判断用户是否要触发 UI 自动化测试。',
    '输出格式：{"intent":"run-ui-test","targetRef":"main","runMode":"contracts"}',
    '如果用户只是问候、闲聊、感谢，或不是要跑 UI 自动化，输出：{"intent":"none"}',
    'runMode 只能是 contracts、smoke、all。',
    '如果用户说冒烟测试，runMode 用 smoke；如果说全量测试，runMode 用 all；默认用 contracts。',
    'targetRef 默认 main。',
    `用户消息：${text}`,
  ].join('\n');
}

function runOpenClawParser(text, env = process.env, execFileImpl = execFile) {
  return enqueueOpenClawCliTask(() => {
    const openclawBin = env.OPENCLAW_BIN || 'openclaw';
    const model = env.OPENCLAW_MODEL || 'xfyun/astron-code-latest';
    const prompt = buildOpenClawPrompt(text);
    const openclawArgs = ['infer', 'model', 'run', '--local', '--model', model, '--prompt', prompt];
    let command = openclawBin;
    let args = openclawArgs;

    if (process.platform === 'win32' && !env.OPENCLAW_BIN) {
      const openclawEntry = join(env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
      if (existsSync(openclawEntry)) {
        command = process.execPath;
        args = [openclawEntry, ...openclawArgs];
      }
    }

    return new Promise((resolve, reject) => {
      execFileImpl(
        command,
        args,
        {
          timeout: Number(env.OPENCLAW_PARSE_TIMEOUT_MS || 300000),
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`OpenClaw parser failed: ${error.message}\n${stderr || ''}`.trim()));
            return;
          }

          try {
            resolve(parseOpenClawCommandOutput(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
    });
  }, env);
}

function buildOpenClawCommand(env, prompt) {
  const openclawBin = env.OPENCLAW_BIN || 'openclaw';
  const model = env.OPENCLAW_MODEL || 'xfyun/astron-code-latest';
  const openclawArgs = ['infer', 'model', 'run', '--local', '--model', model, '--prompt', prompt];
  let command = openclawBin;
  let args = openclawArgs;

  if (process.platform === 'win32' && !env.OPENCLAW_BIN) {
    const openclawEntry = join(env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
    if (existsSync(openclawEntry)) {
      command = process.execPath;
      args = [openclawEntry, ...openclawArgs];
    }
  }

  return { command, args };
}

function enqueueOpenClawCliTask(task, env = process.env) {
  if (String(env.OPENCLAW_CLI_QUEUE_ENABLED ?? 'true').toLowerCase() === 'false') {
    return task();
  }

  const run = openClawCliQueue.catch(() => {}).then(task);
  openClawCliQueue = run.catch(() => {});
  return run;
}

function buildHermesCommand(env, prompt) {
  const hermesBin = env.HERMES_BIN || 'hermes';
  const model = env.HERMES_MODEL || 'astron-code-latest';
  const provider = env.HERMES_PROVIDER || 'custom';
  return {
    command: hermesBin,
    args: ['--provider', provider, '--model', model, '-z', prompt],
  };
}

function getAssistantName(env = process.env, fallback = 'OpenClaw') {
  return String(env.FEISHU_ASSISTANT_NAME || env.ASSISTANT_NAME || fallback).trim() || fallback;
}

function parseOpenClawChatOutput(output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^model\.run\b/i.test(line) && !/^provider:/i.test(line) && !/^model:/i.test(line) && !/^outputs:/i.test(line))
    .join('\n')
    .trim();
}

function runHermesParser(text, env = process.env, execFileImpl = execFile) {
  const prompt = buildOpenClawPrompt(text);
  const { command, args } = buildHermesCommand(env, prompt);

  return new Promise((resolve, reject) => {
    execFileImpl(
      command,
      args,
      {
        timeout: Number(env.HERMES_PARSE_TIMEOUT_MS || 300000),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Hermes parser failed: ${error.message}\n${stderr || ''}`.trim()));
          return;
        }

        try {
          resolve(parseOpenClawCommandOutput(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

function buildOpenClawChatPrompt(text, assistantName = 'OpenClaw') {
  return [
    `你是 ${assistantName} UI 自动化助手，正在飞书里和用户对话。`,
    '回答要简洁、中文、像一个靠谱的项目助手。',
    '你可以说明当前项目能触发 GitHub Actions 跑 UI 自动化、查看报告、回复帮助。',
    '如果用户想跑测试，提醒他可以说：帮我跑一下 main 分支的 UI 自动化冒烟测试。',
    `用户消息：${text}`,
  ].join('\n');
}

function runHermesChat(text, env = process.env, execFileImpl = execFile) {
  const prompt = buildOpenClawChatPrompt(text, getAssistantName(env, 'Hermes'));
  const { command, args } = buildHermesCommand(env, prompt);

  return new Promise((resolve, reject) => {
    execFileImpl(
      command,
      args,
      {
        timeout: Number(env.HERMES_CHAT_TIMEOUT_MS || 300000),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Hermes chat failed: ${error.message}\n${stderr || ''}`.trim()));
          return;
        }

        const answer = parseOpenClawChatOutput(stdout);
        resolve(answer || '我在，但刚才没有生成有效回复。你可以发“帮助”查看可用指令。');
      },
    );
  });
}

function runOpenClawChat(text, env = process.env, execFileImpl = execFile) {
  return enqueueOpenClawCliTask(() => new Promise((resolve, reject) => {
    const prompt = buildOpenClawChatPrompt(text, getAssistantName(env, 'OpenClaw'));
    const { command, args } = buildOpenClawCommand(env, prompt);

    execFileImpl(
      command,
      args,
      {
        timeout: Number(env.OPENCLAW_CHAT_TIMEOUT_MS || 300000),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`OpenClaw chat failed: ${error.message}\n${stderr || ''}`.trim()));
          return;
        }

        const answer = parseOpenClawChatOutput(stdout);
        resolve(answer || '我在，但刚才没有生成有效回复。你可以发“帮助”查看可用指令。');
      },
    );
  }), env);
}

function extractSenderId(payload) {
  const senderId = payload?.event?.sender?.sender_id ?? {};
  return senderId.open_id || senderId.user_id || senderId.union_id || payload?.sender_id || '';
}

function extractFeishuChatId(payload) {
  return payload?.event?.message?.chat_id || payload?.message?.chat_id || payload?.chat_id || '';
}

function extractFeishuChatType(payload) {
  return payload?.event?.message?.chat_type || payload?.message?.chat_type || payload?.chat_type || '';
}

function extractFeishuEventType(payload) {
  return payload?.header?.event_type || payload?.event_type || payload?.type || '';
}

function shouldProcessFeishuMessagePayload(payload) {
  const eventType = extractFeishuEventType(payload);
  if (eventType && eventType !== 'im.message.receive_v1') {
    return false;
  }

  return Boolean(payload?.event?.message || payload?.message || extractFeishuText(payload));
}

function isFeishuGroupChat(payload) {
  const chatType = extractFeishuChatType(payload);
  return chatType && chatType !== 'p2p';
}

function hasFeishuMention(payload, text = extractFeishuText(payload)) {
  const message = payload?.event?.message || payload?.message || {};
  if (Array.isArray(message.mentions) && message.mentions.length > 0) {
    return true;
  }

  return /^@\S+/.test(String(text ?? '').trim());
}

function shouldIgnorePassiveGroupMessage(payload, text, env = process.env, route = routeAgentIntent(text)) {
  if (String(env.FEISHU_GROUP_PASSIVE_REPLY_ENABLED ?? 'false').toLowerCase() === 'true') {
    return false;
  }

  if (!isFeishuGroupChat(payload) || hasFeishuMention(payload, text)) {
    return false;
  }

  if (route.agent === 'ops-agent') {
    return false;
  }

  if (parseBindCommand(text) || parseRunUiTestCommand(text) || looksLikeAutomationRequest(text)) {
    return false;
  }

  return true;
}

function buildStableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function getFeishuDedupKeys(payload) {
  const keys = [];
  const eventId = payload?.header?.event_id || payload?.event_id || payload?.uuid || '';
  const message = payload?.event?.message || payload?.message || {};
  const messageId = message.message_id || message.open_message_id || message.messageId || '';
  const senderId = extractSenderId(payload);
  const chatId = extractFeishuChatId(payload);
  const text = extractFeishuText(payload);

  if (eventId) {
    keys.push(`event:${eventId}`);
  }

  if (messageId) {
    keys.push(`message:${messageId}`);
  }

  if (text) {
    keys.push(`text:${buildStableHash([senderId, chatId, text].join('|'))}`);
  }

  return keys;
}

function pruneFeishuDedupCache(cache, now) {
  for (const [key, expiresAt] of cache.entries()) {
    if (expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function isDuplicateFeishuEvent(payload, env = process.env, cache = seenFeishuEventKeys) {
  if (String(env.FEISHU_DEDUP_ENABLED ?? 'true').toLowerCase() === 'false') {
    return false;
  }

  const keys = getFeishuDedupKeys(payload);
  if (keys.length === 0) {
    return false;
  }

  const now = Date.now();
  const ttlMs = Number(env.FEISHU_DEDUP_TTL_MS || 300000);
  pruneFeishuDedupCache(cache, now);

  if (keys.some((key) => cache.has(key))) {
    return true;
  }

  const expiresAt = now + ttlMs;
  keys.forEach((key) => cache.set(key, expiresAt));
  return false;
}

function parseSmallTalkMessage(text, env = process.env) {
  const normalized = String(text ?? '').trim().replace(/^@\S+\s*/, '');
  const assistantName = getAssistantName(env, 'OpenClaw');
  if (/^(你好|您好|hi|hello|嗨|在吗|在不在)[!！。.\s]*$/i.test(normalized)) {
    return `你好，我是 ${assistantName} UI 自动化助手。你可以发：帮我跑一下 main 分支的 UI 自动化冒烟测试`;
  }

  if (/^(帮助|help|怎么用|使用说明)[!！。.\s]*$/i.test(normalized)) {
    return [
      `我是 ${assistantName} UI 自动化助手。`,
      '可用指令：',
      '1. 帮我跑一下 main 分支的 UI 自动化冒烟测试',
      '2. /run-ui-test main smoke',
      '3. /run-ui-test main contracts',
    ].join('\n');
  }

  return null;
}

function parseBindCommand(text) {
  const normalized = String(text ?? '').trim().replace(/^@\S+\s*/, '');
  return /^(绑定我|只允许我|限制为我|我的ID|我的id|whoami)$/i.test(normalized);
}

function getAllowedSenderIds(env = process.env) {
  return String(env.FEISHU_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isBindingRequired(env = process.env) {
  return String(env.FEISHU_REQUIRE_BINDING ?? '').toLowerCase() === 'true';
}

function looksLikeAutomationRequest(text) {
  return Boolean(parseRunUiTestCommand(text))
    || /(UI|ui|自动化|测试|冒烟|全量|contracts|smoke|all|GitHub Actions|workflow|跑一下|运行)/.test(String(text ?? ''));
}

async function bindAllowedSender(payload, env = process.env, options = {}) {
  const senderId = extractSenderId(payload);
  if (!senderId) {
    return '没有从飞书事件里拿到你的 sender id，暂时不能绑定。';
  }

  const allowlistKey = env.FEISHU_ALLOWED_USER_IDS_ENV_KEY || 'FEISHU_ALLOWED_USER_IDS';
  const allowedSenderIds = getAllowedSenderIds(env);
  if (allowedSenderIds.length > 0 && !allowedSenderIds.includes(senderId)) {
    return '当前已经绑定了其他飞书用户，你没有权限覆盖触发人设置。';
  }

  if (options.allowlistBinder) {
    await options.allowlistBinder(senderId, env, allowlistKey);
  } else if (env.FEISHU_ENV_FILE) {
    upsertEnvFileValue(env.FEISHU_ENV_FILE, allowlistKey, senderId);
  }

  env.FEISHU_ALLOWED_USER_IDS = senderId;
  env[allowlistKey] = senderId;
  process.env[allowlistKey] = senderId;
  return `已绑定当前飞书用户，后续只有你可以触发 UI 自动化测试。\nopen_id：${senderId}`;
}

function upsertEnvFileValue(filePath, key, value) {
  const lines = existsSync(filePath) ? readFileSync(filePath, 'utf8').split(/\r?\n/) : [];
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  }).filter((line, index, array) => line || index < array.length - 1);

  if (!found) {
    next.push(`${key}=${value}`);
  }

  writeFileSync(filePath, `${next.join('\n')}\n`);
}

function buildFeishuTextMessage(payload, text, env = process.env) {
  const chatId = extractFeishuChatId(payload);
  if (chatId) {
    return {
      receiveIdType: 'chat_id',
      receiveId: chatId,
      msgType: 'text',
      content: JSON.stringify({ text }),
    };
  }

  const senderId = extractSenderId(payload);
  if (senderId) {
    return {
      receiveIdType: 'open_id',
      receiveId: senderId,
      msgType: 'text',
      content: JSON.stringify({ text }),
    };
  }

  const configuredReceiveId = env.FEISHU_NOTIFY_RECEIVE_ID || '';
  const configuredReceiveIdType = env.FEISHU_NOTIFY_RECEIVE_ID_TYPE || '';
  if (configuredReceiveId) {
    return {
      receiveIdType: configuredReceiveIdType || 'chat_id',
      receiveId: configuredReceiveId,
      msgType: 'text',
      content: JSON.stringify({ text }),
    };
  }

  return {
    receiveIdType: 'open_id',
    receiveId: '',
    msgType: 'text',
    content: JSON.stringify({ text }),
  };
}

function hasFeishuReplyTarget(payload) {
  return Boolean(extractFeishuChatId(payload) || extractSenderId(payload));
}

function buildFeishuCardMessage(payload, card, env = process.env) {
  const base = buildFeishuTextMessage(payload, '', env);
  return {
    receiveIdType: base.receiveIdType,
    receiveId: base.receiveId,
    msgType: 'interactive',
    content: JSON.stringify(card),
  };
}

function buildRunArtifactsUrl(runUrl) {
  return runUrl ? `${runUrl}#artifacts` : '';
}

function buildFeishuResultCard(job, run) {
  const conclusion = run.conclusion || 'unknown';
  const success = conclusion === 'success';
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const title = success ? 'UI 自动化测试成功' : 'UI 自动化测试失败';

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: success ? 'green' : 'red',
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**分支**：${job.targetRef}`,
            `**模式**：${job.runMode}`,
            `**结论**：${conclusion}`,
          ].join('\n'),
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'GitHub Actions',
            },
            type: 'primary',
            url: runUrl,
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: 'Allure 报告',
            },
            type: 'default',
            url: artifactsUrl || runUrl,
          },
        ],
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: success ? '打开 Allure 报告 artifact 可查看测试明细。' : '打开 GitHub Actions 可查看失败截图、trace 和日志 artifact。',
          },
        ],
      },
    ],
  };
}

async function fetchFeishuTenantAccessToken(env = process.env, fetchImpl = fetch) {
  const appId = env.FEISHU_APP_ID || env.LARK_APP_ID || '';
  const appSecret = env.FEISHU_APP_SECRET || env.LARK_APP_SECRET || '';
  if (!appId || !appSecret) {
    throw new Error('Missing Feishu app credentials. Set FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }

  const response = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu tenant token request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const body = await response.json();
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`Feishu tenant token request failed: ${body.msg || JSON.stringify(body)}`);
  }

  return body.tenant_access_token;
}

async function sendFeishuTextMessage(env = process.env, message, fetchImpl = fetch) {
  if (!message?.receiveId) {
    throw new Error('Missing Feishu receive id for result notification.');
  }

  const tenantAccessToken = await fetchFeishuTenantAccessToken(env, fetchImpl);
  const receiveIdType = encodeURIComponent(message.receiveIdType);
  const response = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: message.receiveId,
      msg_type: message.msgType,
      content: message.content,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu message send failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(`Feishu message send failed: ${body.msg || JSON.stringify(body)}`);
  }

  return body;
}

function shouldNotifyFeishu(env) {
  return String(env.FEISHU_RESULT_NOTIFY_ENABLED || '').toLowerCase() === 'true'
    && Boolean(env.FEISHU_APP_ID || env.LARK_APP_ID)
    && Boolean(env.FEISHU_APP_SECRET || env.LARK_APP_SECRET);
}

function shouldSendAutomationReceipt(env) {
  return String(env.FEISHU_AUTOMATION_RECEIPT_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function isHermesFallbackEnabled(env) {
  return String(env.HERMES_FALLBACK_ENABLED ?? '').toLowerCase() === 'true';
}

function formatRunResultMessage(job, run) {
  const conclusion = run.conclusion || 'unknown';
  const statusText = conclusion === 'success' ? '成功' : '失败';
  const reportHint = conclusion === 'success' ? '可以打开链接查看 Allure / Playwright 报告 artifact。' : '请打开链接查看失败日志、截图或 trace。';

  return [
    `UI 自动化测试${statusText}`,
    `分支：${job.targetRef}`,
    `模式：${job.runMode}`,
    `结论：${conclusion}`,
    `链接：${run.html_url || job.actionsUrl}`,
    reportHint,
  ].join('\n');
}

async function notifyFeishuRunResult(job, env = process.env, fetchImpl = fetch) {
  if (!job.run?.id) {
    await sendFeishuTextMessage(env, {
      ...job.message,
      content: JSON.stringify({ text: `UI 自动化测试已启动，请查看：${job.actionsUrl}` }),
    }, fetchImpl);
    return null;
  }

  const completedRun = await waitForWorkflowCompletion(job.config, job.run.id, fetchImpl, {
    attempts: Number(env.GITHUB_RUN_NOTIFY_ATTEMPTS || 60),
    intervalMs: Number(env.GITHUB_RUN_NOTIFY_INTERVAL_MS || 10000),
  });

  if (String(env.FEISHU_CARD_ENABLED ?? 'true').toLowerCase() !== 'false') {
    await sendFeishuTextMessage(env, {
      ...job.message,
      msgType: 'interactive',
      content: JSON.stringify(buildFeishuResultCard(job, completedRun)),
    }, fetchImpl);
  } else {
    const text = formatRunResultMessage(job, completedRun);
    await sendFeishuTextMessage(env, {
      ...job.message,
      content: JSON.stringify({ text }),
    }, fetchImpl);
  }
  return completedRun;
}

function buildFeishuRunNotificationKey(job) {
  return [
    job.message?.receiveIdType || '',
    job.message?.receiveId || '',
    job.config?.inputs?.target_repository || '',
    job.targetRef || job.config?.inputs?.target_ref || '',
    job.runMode || job.config?.inputs?.run_mode || '',
  ].join('|');
}

function scheduleFeishuResultNotification(job, env = process.env, options = {}) {
  const cache = options.cache || scheduledFeishuNotificationKeys;
  const now = Date.now();
  const ttlMs = Number(env.FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS || 300000);
  pruneFeishuDedupCache(cache, now);

  if (ttlMs > 0) {
    const notificationKey = buildFeishuRunNotificationKey(job);
    if (notificationKey && cache.has(notificationKey)) {
      console.log('Ignored duplicate Feishu result notification schedule.');
      return false;
    }
    cache.set(notificationKey, now + ttlMs);
  }

  const notifier = options.notifier || notifyFeishuRunResult;
  Promise.resolve(notifier(job, env)).catch((error) => {
    console.error(`Feishu result notification failed: ${error.message}`);
  });
  return true;
}

function isAuthorized(payload, env) {
  const allowlist = getAllowedSenderIds(env);
  if (allowlist.length === 0) {
    return !isBindingRequired(env);
  }

  return allowlist.includes(extractSenderId(payload));
}

function getUnauthorizedMessage(env) {
  if (getAllowedSenderIds(env).length === 0 && isBindingRequired(env)) {
    return '还没有绑定可触发用户。请先在飞书里发送“绑定我”，绑定后只有你本人能触发 UI 自动化测试。';
  }

  return '未授权用户不能触发 UI 自动化测试';
}

function buildDispatchConfig(command, env) {
  const config = parseCliArgs([], env);
  config.inputs.target_ref = command.targetRef;
  config.inputs.run_mode = command.runMode;
  return config;
}

async function handleFeishuWebhook(payload, env = process.env, dispatch = dispatchWorkflow, parserOverride, schedulerOverride, fallbackParserOverride, parserSourceOverride, fallbackParserSourceOverride) {
  if (payload?.challenge) {
    return {
      statusCode: 200,
      body: {
        challenge: payload.challenge,
      },
    };
  }

  if (!isAuthorized(payload, env)) {
    return {
      statusCode: 403,
      body: {
        ok: false,
        message: getUnauthorizedMessage(env),
      },
    };
  }

  const text = extractFeishuText(payload);
  let command;
  let commandSource = 'direct';
  try {
    command = parseRunUiTestCommand(text);
    if (!command && String(env.OPENCLAW_PARSE_ENABLED).toLowerCase() === 'true') {
      const parser = parserOverride || runOpenClawParser;
      try {
        command = await parser(text, env);
        commandSource = command ? (parserSourceOverride || 'openclaw') : commandSource;
      } catch (parserError) {
        if (!isHermesFallbackEnabled(env)) {
          throw parserError;
        }

        const hermesParser = fallbackParserOverride || runHermesParser;
        command = await hermesParser(text, env);
        commandSource = command ? (fallbackParserSourceOverride || 'hermes') : commandSource;
      }
    }
  } catch (error) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: error.message,
      },
    };
  }

  if (!command) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        message: '指令不合法，请使用：/run-ui-test main contracts',
      },
    };
  }

  const config = buildDispatchConfig(command, env);
  const result = await dispatch(config);
  const workflowRunUrl = result.workflowRunUrl || result.run?.html_url;
  const notificationMessage = buildFeishuTextMessage(
    payload,
    `UI 自动化测试已启动：分支 ${command.targetRef}，模式 ${command.runMode}\n链接：${workflowRunUrl || result.actionsUrl}`,
    env,
  );

  if (shouldNotifyFeishu(env)) {
    const scheduler = schedulerOverride || scheduleFeishuResultNotification;
    await scheduler({
      actionsUrl: result.actionsUrl,
      config,
      message: notificationMessage,
      run: result.run,
      runMode: config.inputs.run_mode,
      targetRef: config.inputs.target_ref,
    }, env);
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      message: `UI 自动化测试已触发：分支 ${command.targetRef}，模式 ${command.runMode}`,
      actionsUrl: result.actionsUrl,
      workflowRunUrl,
      commandSource,
      targetRepository: config.inputs.target_repository,
      targetRef: config.inputs.target_ref,
      runMode: config.inputs.run_mode,
    },
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function getFeishuRouteMode(url = '') {
  const pathname = String(url).split('?')[0].replace(/\/+$/, '');
  if (pathname === '/webhook/feishu') {
    return 'openclaw';
  }

  if (pathname === '/webhook/feishu/openclaw') {
    return 'openclaw';
  }

  if (pathname === '/webhook/feishu/hermes') {
    return 'hermes';
  }

  return null;
}

function getFeishuPayloadMode(payload, env = process.env, fallbackMode = 'openclaw') {
  const appId = payload?.header?.app_id || payload?.app_id || payload?.event?.app_id || '';
  if (appId && env.HERMES_FEISHU_APP_ID && appId === env.HERMES_FEISHU_APP_ID) {
    return 'hermes';
  }

  if (appId && env.FEISHU_APP_ID && appId === env.FEISHU_APP_ID) {
    return 'openclaw';
  }

  return fallbackMode;
}

function buildRouteOptions(mode, options = {}) {
  if (mode !== 'hermes') {
    return options;
  }

  return {
    ...options,
    chat: options.chat || runHermesChat,
    hermesChat: options.hermesChat || runOpenClawChat,
    parser: options.parser || runHermesParser,
    hermesParser: options.hermesParser || runOpenClawParser,
    parserSource: options.parserSource || 'hermes',
    fallbackParserSource: options.fallbackParserSource || 'openclaw',
  };
}

function buildRouteEnv(mode, env = process.env) {
  if (mode !== 'hermes') {
    return env;
  }

  const routeEnv = { ...env };
  if (env.HERMES_FEISHU_APP_ID) {
    routeEnv.FEISHU_APP_ID = env.HERMES_FEISHU_APP_ID;
  }
  if (env.HERMES_FEISHU_APP_SECRET) {
    routeEnv.FEISHU_APP_SECRET = env.HERMES_FEISHU_APP_SECRET;
  }
  if (env.HERMES_FEISHU_NOTIFY_RECEIVE_ID) {
    routeEnv.FEISHU_NOTIFY_RECEIVE_ID = env.HERMES_FEISHU_NOTIFY_RECEIVE_ID;
  }
  if (env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE) {
    routeEnv.FEISHU_NOTIFY_RECEIVE_ID_TYPE = env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE;
  }
  routeEnv.FEISHU_ASSISTANT_NAME = env.HERMES_FEISHU_ASSISTANT_NAME || 'Hermes';
  routeEnv.FEISHU_ALLOWED_USER_IDS = env.HERMES_FEISHU_ALLOWED_USER_IDS || '';
  routeEnv.FEISHU_ALLOWED_USER_IDS_ENV_KEY = 'HERMES_FEISHU_ALLOWED_USER_IDS';
  routeEnv.FEISHU_REQUIRE_BINDING = env.HERMES_FEISHU_REQUIRE_BINDING || env.FEISHU_REQUIRE_BINDING;
  return routeEnv;
}

function isAsyncWebhookEnabled(env) {
  return String(env.FEISHU_WEBHOOK_ASYNC ?? 'true').toLowerCase() !== 'false';
}

async function buildRoutedChatReply(text, env, options = {}) {
  if (String(env.OPENCLAW_CHAT_ENABLED ?? 'true').toLowerCase() === 'false') {
    return null;
  }

  const prompt = buildChatAgentPrompt(text);
  const chat = options.chat || runOpenClawChat;
  try {
    return await chat(prompt, env);
  } catch (error) {
    if (!isHermesFallbackEnabled(env)) {
      throw error;
    }

    const hermesChat = options.hermesChat || runHermesChat;
    return hermesChat(prompt, env);
  }
}

async function buildRoutedAgentReply(payload, env, options = {}, route = routeAgentIntent(extractFeishuText(payload))) {
  if (route.agent === 'ui-test-agent') {
    return {
      handled: false,
      replyText: '',
    };
  }

  const text = extractFeishuText(payload);
  if (route.requiresAuth && !isAuthorized(payload, env)) {
    return {
      handled: true,
      replyText: getUnauthorizedMessage(env),
    };
  }

  if (route.agent === 'doc-agent') {
    return {
      handled: true,
      replyText: buildDocAgentReply(text),
    };
  }

  if (route.agent === 'memory-agent') {
    return {
      handled: true,
      replyText: buildMemoryAgentReply(route),
    };
  }

  if (route.agent === 'ops-agent') {
    return {
      handled: true,
      replyText: await buildOpsAgentReply(route),
    };
  }

  if (route.agent === 'chat-agent') {
    return {
      handled: true,
      replyText: await buildRoutedChatReply(text, env, options),
    };
  }

  return {
    handled: false,
    replyText: '',
  };
}

function sendRoutedFeishuReply(receiptSender, payload, replyText, env, label) {
  if (!replyText) {
    return Promise.resolve();
  }

  return Promise.resolve(receiptSender(buildFeishuTextMessage(payload, replyText, env))).catch((error) => {
    console.error(`Feishu ${label} reply failed: ${error.message}`);
  });
}

function runWebhookInBackground(payload, env, options = {}) {
  setTimeout(() => {
    const text = extractFeishuText(payload);
    const receiptSender = options.receiptSender || ((reply) => sendFeishuTextMessage(env, reply));

    if (!hasFeishuReplyTarget(payload)) {
      console.log('Ignored Feishu message without reply target.');
      return;
    }

    if (parseBindCommand(text)) {
      bindAllowedSender(payload, env, options)
        .then((replyText) => receiptSender(buildFeishuTextMessage(payload, replyText, env)))
        .catch((error) => {
          console.error(`Feishu bind reply failed: ${error.message}`);
        });
      return;
    }

    const route = routeAgentIntent(text);
    if (shouldIgnorePassiveGroupMessage(payload, text, env, route)) {
      console.log('Ignored passive Feishu group message.');
      return;
    }

    const smallTalkReply = parseSmallTalkMessage(extractFeishuText(payload), env);
    if (smallTalkReply) {
      const message = buildFeishuTextMessage(payload, smallTalkReply, env);
      Promise.resolve(receiptSender(message)).catch((error) => {
        console.error(`Feishu small talk reply failed: ${error.message}`);
      });
      return;
    }

    if (route.agent !== 'ui-test-agent') {
      Promise.resolve(buildRoutedAgentReply(payload, env, options, route))
        .then(({ replyText }) => sendRoutedFeishuReply(receiptSender, payload, replyText, env, 'routed agent'))
        .catch((error) => {
          console.error(`Feishu routed agent failed: ${error.message}`);
        });
      return;
    }

    if (!isAuthorized(payload, env)) {
      Promise.resolve(receiptSender(buildFeishuTextMessage(payload, getUnauthorizedMessage(env), env))).catch((error) => {
        console.error(`Feishu unauthorized reply failed: ${error.message}`);
      });
      return;
    }

    if (shouldNotifyFeishu(env) && shouldSendAutomationReceipt(env)) {
      const receipt = buildFeishuTextMessage(
        payload,
        '收到了，正在运行 UI 自动化测试。报告生成后我会发给你。',
        env,
      );
      Promise.resolve(receiptSender(receipt)).catch((error) => {
        console.error(`Feishu receipt notification failed: ${error.message}`);
      });
    }

    handleFeishuWebhook(
      payload,
      env,
      options.dispatch || dispatchWorkflow,
      options.parser,
      options.scheduler,
      options.hermesParser,
      options.parserSource,
      options.fallbackParserSource,
    ).catch((error) => {
      console.error(`Feishu webhook background job failed: ${error.message}`);
    });
  }, 0);
}

function createServer(env = process.env, options = {}) {
  const dedupCache = options.dedupCache || new Map();
  return http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    const routeMode = getFeishuRouteMode(request.url);
    if (request.method !== 'POST' || !routeMode) {
      sendJson(response, 404, { ok: false, message: 'Not found' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const effectiveRouteMode = getFeishuPayloadMode(payload, env, routeMode);
      const routeOptions = buildRouteOptions(effectiveRouteMode, options);
      const routeEnv = buildRouteEnv(effectiveRouteMode, env);
      if (payload?.challenge) {
        const result = await handleFeishuWebhook(
          payload,
          routeEnv,
          routeOptions.dispatch || dispatchWorkflow,
          routeOptions.parser,
          routeOptions.scheduler,
          routeOptions.hermesParser,
          routeOptions.parserSource,
          routeOptions.fallbackParserSource,
        );
        sendJson(response, result.statusCode, result.body);
        return;
      }

      if (!shouldProcessFeishuMessagePayload(payload)) {
        console.log(`Ignored non-message Feishu event: ${extractFeishuEventType(payload) || 'unknown'}`);
        sendJson(response, 200, {
          ok: true,
          ignored: true,
          message: '非消息类飞书事件已忽略',
        });
        return;
      }

      if (isDuplicateFeishuEvent(payload, routeEnv, dedupCache)) {
        console.log('Ignored duplicate Feishu webhook event.');
        sendJson(response, 200, {
          ok: true,
          duplicate: true,
          message: '重复飞书事件已忽略',
        });
        return;
      }

      if (isAsyncWebhookEnabled(routeEnv)) {
        runWebhookInBackground(payload, routeEnv, routeOptions);
        sendJson(response, 200, {
          ok: true,
          message: '飞书指令已收到，正在后台触发 UI 自动化测试',
        });
        return;
      }

      const route = routeAgentIntent(extractFeishuText(payload));
      const routed = await buildRoutedAgentReply(payload, routeEnv, routeOptions, route);
      if (routed.handled) {
        sendJson(response, 200, {
          ok: true,
          message: routed.replyText || '消息已处理',
        });
        return;
      }

      const result = await handleFeishuWebhook(
        payload,
        routeEnv,
        routeOptions.dispatch || dispatchWorkflow,
        routeOptions.parser,
        routeOptions.scheduler,
        routeOptions.hermesParser,
        routeOptions.parserSource,
        routeOptions.fallbackParserSource,
      );
      sendJson(response, result.statusCode, result.body);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message,
      });
    }
  });
}

function main() {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, () => {
    console.log(`Feishu bridge listening on http://127.0.0.1:${port}`);
    console.log('Webhook path: POST /webhook/feishu');
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildFeishuResultCard,
  buildRunArtifactsUrl,
  buildFeishuCardMessage,
  buildFeishuTextMessage,
  buildRouteEnv,
  createServer,
  extractFeishuText,
  getFeishuDedupKeys,
  getFeishuRouteMode,
  handleFeishuWebhook,
  isDuplicateFeishuEvent,
  notifyFeishuRunResult,
  scheduleFeishuResultNotification,
  parseOpenClawChatOutput,
  parseSmallTalkMessage,
  parseRunUiTestCommand,
  parseOpenClawCommandOutput,
  runHermesChat,
  runHermesParser,
  runOpenClawChat,
  runWebhookInBackground,
  runOpenClawParser,
  sendFeishuTextMessage,
};
