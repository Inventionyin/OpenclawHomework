const http = require('node:http');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { dirname } = require('node:path');
const { performance } = require('node:perf_hooks');

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
  buildCapabilityGuideReply,
  buildBrowserAgentReply,
  buildChatAgentPrompt,
  buildClerkAgentReply,
  buildDocAgentReply,
  buildEcosystemAgentReply,
  buildImageChannelReply,
  buildModelChannelReply,
  buildMultiIntentPlanReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildPlannerClarifyReply,
  buildDifyTestingAssistantReply,
  buildQaAgentReply,
} = require('./agents/agent-handlers');
const {
  askDifyTestingAssistant,
} = require('./dify-testing-assistant');
const {
  buildIntentDiagnosis,
} = require('./agents/intent-diagnoser');
const {
  buildIntentPlannerPrompt,
  parseIntentPlannerOutput,
} = require('./agents/intent-planner');
const {
  buildConversationKey,
  getFreshIntentHint,
  routeFromContextHint,
  writeIntentContext,
} = require('./agents/intent-context');
const {
  runPeerSshAction,
} = require('./peer-client');
const {
  redactPeerOutput,
} = require('./peer-control');
const {
  resolveMailboxAction,
} = require('./mailbox-action-router');
const {
  buildDailySummary,
} = require('./daily-summary');
const {
  readDailySummarySnapshot: readDailySummarySnapshotHelper,
  writeDailySummarySnapshot: writeDailySummarySnapshotHelper,
  appendDailySummaryRunSnapshot: appendDailySummaryRunSnapshotHelper,
  getDailySummarySnapshotFile: getDailySummarySnapshotFileHelper,
  readDailySummaryState: readDailySummaryStateHelper,
  writeDailySummaryState: writeDailySummaryStateHelper,
  appendDailySummaryRun: appendDailySummaryRunHelper,
  getDailySummaryStateFile: getDailySummaryStateFileHelper,
} = require('./daily-summary-snapshot');
const {
  buildStreamingChatConfig,
  streamModelText,
} = require('./streaming-client');
const {
  appendUsageLedgerEntry,
  readUsageLedgerEntries,
} = require('./usage-ledger');
const {
  appendMailLedgerEntry,
} = require('./mail-ledger');
const {
  editImage,
  generateImage,
} = require('./image-client');
const {
  runTokenLab,
} = require('./qa-token-lab');
const {
  runMultiAgentLab,
} = require('./multi-agent-lab');
const {
  buildEcosystemStatusReply,
  installSupportedEcosystem,
  readEcosystemState,
  runMaintenance,
} = require('./ecosystem-manager');
const {
  buildProtocolTestCases,
  buildProtocolAssetReport,
  saveProtocolAsset,
} = require('./protocol-asset-store');
const {
  formatTokenFactoryTask,
  getTokenFactoryTaskStatus,
  startTokenFactoryTask,
} = require('./task-runner');
const {
  buildDashboardHtml,
  buildDashboardState,
} = require('./dashboard');
const {
  buildTrendIntelReport,
  collectTrendIntel,
  writeTrendIntelReport,
} = require('./trend-intel');
const {
  runTrendTokenFactory,
} = require('./trend-token-factory');

const VALID_RUN_MODES = new Set(['contracts', 'smoke', 'all']);
let openClawCliQueue = Promise.resolve();
const seenFeishuEventKeys = new Map();
const scheduledFeishuNotificationKeys = new Map();
const recentFeishuImages = new Map();
const feishuTenantTokenCache = new Map();

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

function collectFeishuImageKeysFromContent(content, imageKeys = []) {
  if (!content || typeof content !== 'object') {
    return imageKeys;
  }

  const directKey = content.image_key || content.imageKey || content.file_key || content.fileKey;
  if (directKey) {
    imageKeys.push(String(directKey));
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      collectFeishuImageKeysFromContent(item, imageKeys);
    }
    return imageKeys;
  }

  for (const value of Object.values(content)) {
    if (value && typeof value === 'object') {
      collectFeishuImageKeysFromContent(value, imageKeys);
    }
  }

  return imageKeys;
}

function extractFeishuImageKeys(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const keys = [];
  const message = payload.event?.message || payload.message || {};
  const content = parseJsonContent(message.content || payload.content);
  collectFeishuImageKeysFromContent(content, keys);

  return [...new Set(keys.filter(Boolean))];
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

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(nowMs() - Number(startedAt || nowMs())));
}

function createTraceId() {
  return `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveTraceIdFromPayload(payload = {}, fallbackTraceId = '') {
  const messageId = getFeishuInputMessageId(payload);
  if (messageId) {
    return String(messageId);
  }

  const eventId = payload?.header?.event_id || payload?.event_id || payload?.uuid || '';
  if (eventId) {
    return String(eventId);
  }

  return String(fallbackTraceId || '').trim() || createTraceId();
}

function createFeishuTimingContext(startedAt = nowMs(), traceId = '') {
  return { startedAt, traceId: String(traceId || '').trim() || createTraceId() };
}

function sanitizeTimingValue(value) {
  return String(value ?? '')
    .replace(/[\r\n\t ]+/g, '_')
    .replace(/[^\w:./@-]/g, '_')
    .slice(0, 80);
}

function logFeishuTiming(env, timingContext, stage, fields = {}) {
  if (String(env.FEISHU_TIMING_LOG_ENABLED ?? 'false').toLowerCase() !== 'true') {
    return;
  }

  const startedAt = timingContext?.startedAt || nowMs();
  const parts = [
    'assistant=' + sanitizeTimingValue(getAssistantName(env)),
    'stage=' + sanitizeTimingValue(stage),
    'elapsed_ms=' + elapsedMs(startedAt),
  ];
  if (timingContext?.traceId) {
    parts.push('trace_id=' + sanitizeTimingValue(timingContext.traceId));
  }

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${sanitizeTimingValue(key)}=${sanitizeTimingValue(value)}`);
  }

  console.log(`[Feishu timing] ${parts.join(' ')}`);
}

function logTimedModelFinish(env, timingContext, stage, modelStartedAt, fields = {}) {
  logFeishuTiming(env, timingContext, stage, {
    ...fields,
    model_elapsed_ms: elapsedMs(modelStartedAt),
  });
}

function logUsageLedger(env, input = {}) {
  try {
    const written = appendUsageLedgerEntry(env, {
      assistant: getAssistantName(env),
      traceId: input.traceId || input.timingContext?.traceId,
      ...input,
    });
    if (written) {
      logFeishuTiming(env, input.timingContext, 'usage:ledger', {
        agent: input.route?.agent || input.agent,
        action: input.route?.action || input.action,
        model: input.modelResult?.model || input.model,
        total_tokens: input.modelResult?.usage?.total_tokens || input.usage?.total_tokens,
      });
    }
  } catch (error) {
    console.error(`Usage ledger write failed: ${error.message}`);
  }
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

function execFilePromise(command, args = [], options = {}, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, {
      timeout: 30000,
      windowsHide: true,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(redactPeerOutput(`${error.message}\n${stderr || ''}`.trim())));
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

function getLocalBridgeService(env = process.env) {
  if (env.LOCAL_BRIDGE_SERVICE) {
    return env.LOCAL_BRIDGE_SERVICE;
  }

  const assistantName = getAssistantName(env, 'OpenClaw').toLowerCase();
  if (assistantName.includes('hermes')) {
    return 'hermes-feishu-bridge';
  }
  return 'openclaw-feishu-bridge';
}

function getLocalWatchdogTimer(env = process.env, service = getLocalBridgeService(env)) {
  if (env.LOCAL_WATCHDOG_TIMER) {
    return env.LOCAL_WATCHDOG_TIMER;
  }

  if (service.startsWith('hermes-')) {
    return 'hermes-homework-watchdog.timer';
  }
  return 'openclaw-homework-watchdog.timer';
}

async function checkLocalHealth(healthUrl, fetchImpl = fetch) {
  const response = await fetchImpl(healthUrl, { method: 'GET' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status} ${response.statusText} ${body}`);
  }
  return body;
}

function parseMemorySummary(output) {
  const line = String(output || '').split(/\r?\n/).find((item) => /^\s*Mem:/i.test(item)) || String(output || '');
  const parts = line.trim().split(/\s+/);
  return {
    total: parts[1] || 'unknown',
    used: parts[2] || 'unknown',
    free: parts[3] || 'unknown',
  };
}

function parseDiskSummary(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const line = lines.find((item) => /\s\/$/.test(item.trim())) || lines[0] || '';
  const parts = line.trim().split(/\s+/);
  return {
    filesystem: parts[0] || 'unknown',
    size: parts[1] || 'unknown',
    used: parts[2] || 'unknown',
    available: parts[3] || 'unknown',
    usePercent: parts[4] || 'unknown',
    mountedOn: parts[5] || 'unknown',
  };
}

function parseLoadSummary(output) {
  const text = String(output || '').trim();
  const loadAverage = (text.match(/load averages?:\s*(.+)$/i) || text.match(/load average:\s*(.+)$/i) || [])[1] || text || 'unknown';
  return {
    loadAverage: loadAverage.trim(),
    cpu: 'see load average',
  };
}

function getDiskAuditStateFile(env = process.env) {
  return env.DISK_AUDIT_STATE_FILE || join(env.LOCAL_PROJECT_DIR || '/opt/OpenclawHomework', 'data', 'memory', 'disk-cleanup-state.json');
}

function readDiskAuditState(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeDiskAuditState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function readJsonFileSafe(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getDailySummarySnapshotFile(env = process.env) {
  return (getDailySummarySnapshotFileHelper || getDailySummaryStateFileHelper)(env);
}

function readDailySummarySnapshot(env = process.env) {
  if (readDailySummarySnapshotHelper) {
    return readDailySummarySnapshotHelper(env);
  }
  return (readDailySummaryStateHelper || (() => ({ runs: [] })))(env);
}

function writeDailySummarySnapshot(env = process.env, state = {}) {
  if (writeDailySummarySnapshotHelper) {
    return writeDailySummarySnapshotHelper(env, state);
  }
  return (writeDailySummaryStateHelper || (() => ({ runs: [] })))(env, state);
}

function appendDailySummaryRunSnapshot(env = process.env, job = {}, run = {}) {
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const snapshotRun = {
    id: run.id || null,
    conclusion: run.conclusion || run.status || 'unknown',
    runUrl,
    artifactsUrl,
    targetRef: job.targetRef || job.config?.inputs?.target_ref || '',
    runMode: job.runMode || job.config?.inputs?.run_mode || '',
    updatedAt: run.updated_at || new Date().toISOString(),
  };
  const appendImpl = appendDailySummaryRunSnapshotHelper || appendDailySummaryRunHelper;
  const appended = appendImpl ? appendImpl(env, snapshotRun) : { runs: [snapshotRun] };
  if (Array.isArray(appended)) {
    return appended;
  }
  if (appended && Array.isArray(appended.runs)) {
    return appended.runs;
  }
  return readDailySummarySnapshot(env).runs || [];
}

function getDailySummaryStateFile(env = process.env) {
  return getDailySummarySnapshotFile(env);
}

function readDailySummaryState(env = process.env) {
  return readDailySummarySnapshot(env);
}

function writeDailySummaryState(env = process.env, state = {}) {
  return writeDailySummarySnapshot(env, state);
}

function appendDailySummaryRun(env = process.env, job = {}, run = {}) {
  return appendDailySummaryRunSnapshot(env, job, run);
}

function parseDuSummary(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(.+)$/);
      return match ? { size: match[1], path: match[2].trim() } : null;
    })
    .filter(Boolean);
}

function classifyCleanupCandidate(entry, id) {
  const path = String(entry.path || '');
  const lowered = path.toLowerCase();
  if (/(^|\/)khoj($|\/)/.test(lowered)) {
    return {
      id,
      name: 'khoj',
      path,
      size: entry.size,
      risk: 'confirm',
      cleanupCommand: `rm -rf -- ${path}`,
      recommendation: '如果已经不用 Khoj，可以确认清理；它可能占用模型、索引或虚拟环境空间。',
    };
  }
  if (/\/\.npm($|\/)/.test(lowered)) {
    return {
      id,
      name: 'npm-cache',
      path,
      size: entry.size,
      risk: 'safe',
      cleanupCommand: 'npm cache clean --force',
      recommendation: '这是 npm 缓存，清理后需要时会重新下载。',
    };
  }
  if (/\/var\/log($|\/)/.test(lowered)) {
    return {
      id,
      name: 'system-logs',
      path,
      size: entry.size,
      risk: 'confirm',
      cleanupCommand: 'journalctl --vacuum-time=7d',
      recommendation: '只压缩清理旧日志，保留近 7 天日志。',
    };
  }
  if (/\/tmp($|\/)|\/var\/tmp($|\/)/.test(lowered)) {
    return {
      id,
      name: 'tmp-files',
      path,
      size: entry.size,
      risk: 'confirm',
      cleanupCommand: `find ${path} -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf -- {} +`,
      recommendation: '只清理 1 天前的临时文件。',
    };
  }
  return null;
}

async function collectDiskAudit(env, execFileImpl) {
  const diskOutput = await execFilePromise('bash', ['-lc', 'df -h / | tail -n 1'], {}, execFileImpl)
    .catch((error) => `unknown unknown unknown unknown unknown / # ${error.message}`);
  const duCommand = [
    'for p in /opt/khoj /root/.cache /root/.npm /var/log /tmp /var/tmp /usr/local/lib/hermes-agent /opt/OpenclawHomework/node_modules; do',
    '  [ -e "$p" ] && du -sh "$p" 2>/dev/null || true;',
    'done',
  ].join(' ');
  const duOutput = await execFilePromise('bash', ['-lc', duCommand], { timeout: 120000 }, execFileImpl).catch(() => '');
  const candidates = [];
  parseDuSummary(duOutput).forEach((entry) => {
    const candidate = classifyCleanupCandidate(entry, candidates.length + 1);
    if (candidate) {
      candidates.push(candidate);
    }
  });

  const audit = {
    createdAt: new Date().toISOString(),
    candidates,
  };
  writeDiskAuditState(getDiskAuditStateFile(env), audit);
  return {
    disk: parseDiskSummary(diskOutput),
    audit,
  };
}

function findCleanupCandidate(state, route = {}) {
  const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
  if (route.selection) {
    return candidates.find((candidate) => Number(candidate.id) === Number(route.selection));
  }
  const name = String(route.selectionName || route.cleanupHint || '').toLowerCase();
  if (!name) {
    return null;
  }
  if (name === '缓存') {
    return candidates.find((candidate) => /cache/.test(candidate.name));
  }
  if (name === '日志') {
    return candidates.find((candidate) => candidate.name === 'system-logs');
  }
  return candidates.find((candidate) => String(candidate.name || '').toLowerCase().includes(name));
}

async function runCleanupConfirm(env, execFileImpl, route = {}) {
  const state = readDiskAuditState(getDiskAuditStateFile(env));
  const candidate = findCleanupCandidate(state, route);
  if (!candidate) {
    return {
      operation: 'cleanup-confirm',
      detail: '没有找到上一轮扫描里的对应清理项。',
    };
  }

  const beforeDisk = parseDiskSummary(await execFilePromise('bash', ['-lc', 'df -h / | tail -n 1'], {}, execFileImpl)
    .catch((error) => `unknown unknown unknown unknown unknown / # ${error.message}`));
  await execFilePromise('bash', ['-lc', candidate.cleanupCommand], { timeout: 240000 }, execFileImpl);
  const afterDisk = parseDiskSummary(await execFilePromise('bash', ['-lc', 'df -h / | tail -n 1'], {}, execFileImpl)
    .catch((error) => `unknown unknown unknown unknown unknown / # ${error.message}`));

  return {
    operation: 'cleanup-confirm',
    cleaned: {
      name: candidate.name,
      path: candidate.path,
      beforeAvailable: beforeDisk.available,
      afterAvailable: afterDisk.available,
      detail: '清理完成',
    },
  };
}

async function collectLocalSummary(action, execFileImpl) {
  const summary = {};
  if (action === 'memory-summary' || action === 'load-summary') {
    const memoryOutput = await execFilePromise('bash', ['-lc', 'free -h | awk \'/^Mem:/ {print $0}\''], {}, execFileImpl)
      .catch((error) => `Mem: unknown unknown unknown # ${error.message}`);
    summary.memory = parseMemorySummary(memoryOutput);
  }
  if (action === 'disk-summary' || action === 'load-summary') {
    const diskOutput = await execFilePromise('bash', ['-lc', 'df -h / | tail -n 1'], {}, execFileImpl)
      .catch((error) => `unknown unknown unknown unknown unknown / # ${error.message}`);
    summary.disk = parseDiskSummary(diskOutput);
  }
  if (action === 'load-summary') {
    const loadOutput = await execFilePromise('bash', ['-lc', 'uptime'], {}, execFileImpl)
      .catch((error) => `unknown # ${error.message}`);
    summary.load = parseLoadSummary(loadOutput);
  }
  return summary;
}

async function runLocalOpsAction(action, env = process.env, options = {}) {
  const service = getLocalBridgeService(env);
  const watchdogTimer = getLocalWatchdogTimer(env, service);
  const projectDir = env.LOCAL_PROJECT_DIR || '/opt/OpenclawHomework';
  const healthUrl = env.LOCAL_HEALTH_URL || `http://127.0.0.1:${Number(env.PORT || 8788)}/health`;
  const logLines = Number(env.LOCAL_LOG_LINES || 80);
  const execFileImpl = options.execFile || execFile;
  const fetchImpl = options.fetchImpl || fetch;

  if (action === 'exec') {
    const command = String(options.route?.command || '').trim();
    if (!command) {
      return {
        service: 'root-shell',
        active: 'error',
        health: 'n/a',
        watchdog: 'manual',
        commit: 'n/a',
        operation: 'exec',
        detail: 'missing command',
      };
    }
    const output = await execFilePromise('bash', ['-lc', command], { timeout: 240000 }, execFileImpl)
      .then((value) => redactPeerOutput(String(value).trim()).slice(0, 4000))
      .catch((error) => `error: ${redactPeerOutput(error.message)}`);
    return {
      service: 'root-shell',
      active: 'ok',
      health: 'n/a',
      watchdog: 'manual',
      commit: 'n/a',
      operation: 'exec',
      detail: output,
    };
  }

  if (action === 'disk-audit') {
    return {
      service,
      active: 'ok',
      health: 'n/a',
      watchdog: 'manual',
      commit: 'n/a',
      ...(await collectDiskAudit(env, execFileImpl)),
    };
  }

  if (action === 'cleanup-confirm') {
    return {
      service,
      active: 'ok',
      health: 'n/a',
      watchdog: 'manual',
      commit: 'n/a',
      ...(await runCleanupConfirm(env, execFileImpl, options.route || {})),
    };
  }

  const [active, commit, health, watchdog] = await Promise.all([
    execFilePromise('systemctl', ['is-active', service], {}, execFileImpl)
      .then((value) => value.trim())
      .catch((error) => `error: ${error.message}`),
    execFilePromise('git', ['-C', projectDir, 'rev-parse', '--short', 'HEAD'], {}, execFileImpl)
      .then((value) => value.trim())
      .catch(() => 'unknown'),
    checkLocalHealth(healthUrl, fetchImpl)
      .then((value) => redactPeerOutput(value))
      .catch((error) => `error: ${redactPeerOutput(error.message)}`),
    execFilePromise('systemctl', ['is-active', watchdogTimer], {}, execFileImpl)
      .then((value) => value.trim())
      .catch((error) => `error: ${error.message}`),
  ]);

  if (action === 'restart') {
    await execFilePromise('systemctl', ['restart', service], {}, execFileImpl);
    const restartedActive = await execFilePromise('systemctl', ['is-active', service], {}, execFileImpl)
      .then((value) => value.trim())
      .catch((error) => `error: ${error.message}`);
    const restartedHealth = await checkLocalHealth(healthUrl, fetchImpl)
      .then((value) => redactPeerOutput(value))
      .catch((error) => `error: ${redactPeerOutput(error.message)}`);
    return {
      service,
      active: restartedActive,
      health: restartedHealth,
      watchdog,
      commit,
      operation: 'restart',
      detail: 'service restarted',
    };
  }

  if (action === 'repair') {
    await execFilePromise('git', ['-C', projectDir, 'fetch', 'origin'], { timeout: 120000 }, execFileImpl);
    await execFilePromise('git', ['-C', projectDir, 'pull', '--ff-only'], { timeout: 120000 }, execFileImpl);
    await execFilePromise('npm', ['test'], { cwd: projectDir, timeout: 180000 }, execFileImpl);
    await execFilePromise('systemctl', ['restart', service], {}, execFileImpl);
    const repairedActive = await execFilePromise('systemctl', ['is-active', service], {}, execFileImpl)
      .then((value) => value.trim())
      .catch((error) => `error: ${error.message}`);
    const repairedCommit = await execFilePromise('git', ['-C', projectDir, 'rev-parse', '--short', 'HEAD'], {}, execFileImpl)
      .then((value) => value.trim())
      .catch(() => commit);
    const repairedHealth = await checkLocalHealth(healthUrl, fetchImpl)
      .then((value) => redactPeerOutput(value))
      .catch((error) => `error: ${redactPeerOutput(error.message)}`);
    return {
      service,
      active: repairedActive,
      health: repairedHealth,
      watchdog,
      commit: repairedCommit,
      operation: 'repair',
      detail: 'git pull --ff-only, npm test, and service restart completed',
    };
  }

  if (action === 'logs') {
    const detail = await execFilePromise('journalctl', ['-u', service, '-n', String(logLines), '--no-pager'], {}, execFileImpl)
      .then((value) => redactPeerOutput(value).slice(-2000))
      .catch((error) => `error: ${redactPeerOutput(error.message)}`);
    return {
      service,
      active,
      health,
      watchdog,
      commit,
      detail,
    };
  }

  const result = {
    service,
    active,
    health,
    watchdog,
    commit,
  };

  if (['memory-summary', 'disk-summary', 'load-summary'].includes(action)) {
    Object.assign(result, await collectLocalSummary(action, execFileImpl));
  }

  return result;
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

  if (parseBindCommand(text) || route.agent === 'ui-test-agent') {
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

  if (!eventId && !messageId && text) {
    keys.push(`text:${buildStableHash([senderId, chatId, text].join('|'))}`);
  }

  return keys;
}

function getFeishuInputMessageId(payload) {
  const message = payload?.event?.message || payload?.message || {};
  return message.message_id || message.open_message_id || message.messageId || '';
}

function buildFeishuImageMemoryKey(payload) {
  const senderId = extractSenderId(payload);
  const chatId = extractFeishuChatId(payload);
  return [chatId || 'direct', senderId || 'unknown'].join('|');
}

function pruneFeishuImageMemory(cache = recentFeishuImages, now = Date.now()) {
  for (const [key, value] of cache.entries()) {
    if (!value || value.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function rememberFeishuImage(payload, cache = recentFeishuImages, ttlMs = 10 * 60 * 1000, now = Date.now()) {
  const imageKeys = extractFeishuImageKeys(payload);
  const messageId = getFeishuInputMessageId(payload);
  if (!imageKeys.length || !messageId) {
    return null;
  }

  pruneFeishuImageMemory(cache, now);
  const memory = {
    messageId,
    imageKey: imageKeys[0],
    imageKeys,
    expiresAt: now + ttlMs,
  };
  cache.set(buildFeishuImageMemoryKey(payload), memory);
  return memory;
}

function recallFeishuImage(payload, cache = recentFeishuImages, now = Date.now()) {
  pruneFeishuImageMemory(cache, now);
  return cache.get(buildFeishuImageMemoryKey(payload)) || null;
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
    return [
      `你好，我是 ${assistantName} UI 自动化助手。`,
      '你可以直接这样说：',
      '- 你现在内存多少',
      '- 你硬盘还剩多少',
      '- 看看哪些东西占硬盘',
      '- 看看 Hermes 的服务器状态',
      '- 重启你自己',
      '- 帮我跑一下 main 分支的 UI 自动化冒烟测试',
      '发“帮助”可以看完整示例。',
    ].join('\n');
  }

  if (/^(帮助|help|怎么用|使用说明|你会做什么|你能做什么|怎么玩|玩法)[!！。.\s]*$/i.test(normalized)) {
    return [
      `我是 ${assistantName} UI 自动化助手。`,
      buildCapabilityGuideReply(assistantName),
      '',
      '绑定权限：绑定我 / whoami',
      '高级命令：/status /health /logs /exec df -h /peer-status /peer-repair',
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

function readEnvFileValues(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function truthyEnv(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) {
    return '';
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function appendFeishuReplyFooter(text, env = process.env, metadata = {}) {
  const footer = [];
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_STATUS) || truthyEnv(env.FEISHU_FOOTER_STATUS_ENABLED)) {
    footer.push(`状态：${metadata.status || '完成'}`);
  }
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_ELAPSED) || truthyEnv(env.FEISHU_FOOTER_ELAPSED_ENABLED)) {
    const duration = formatDuration(metadata.elapsedMs);
    if (duration) {
      footer.push(`耗时：${duration}`);
    }
  }
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_TRACE_ID) || truthyEnv(env.FEISHU_FOOTER_TRACE_ID_ENABLED)) {
    const traceId = String(metadata.traceId || metadata.trace_id || '').trim();
    if (traceId) {
      footer.push(`Trace ID：${traceId}`);
    }
  }

  if (footer.length === 0) {
    return String(text ?? '');
  }

  return `${String(text ?? '').trimEnd()}\n\n---\n${footer.join(' · ')}`;
}

function buildFeishuTextMessage(payload, text, env = process.env, metadata = {}) {
  const finalText = appendFeishuReplyFooter(text, env, metadata);
  const chatId = extractFeishuChatId(payload);
  if (chatId) {
    return {
      receiveIdType: 'chat_id',
      receiveId: chatId,
      msgType: 'text',
      content: JSON.stringify({ text: finalText }),
    };
  }

  const senderId = extractSenderId(payload);
  if (senderId) {
    return {
      receiveIdType: 'open_id',
      receiveId: senderId,
      msgType: 'text',
      content: JSON.stringify({ text: finalText }),
    };
  }

  const configuredReceiveId = env.FEISHU_NOTIFY_RECEIVE_ID || '';
  const configuredReceiveIdType = env.FEISHU_NOTIFY_RECEIVE_ID_TYPE || '';
  if (configuredReceiveId) {
    return {
      receiveIdType: configuredReceiveIdType || 'chat_id',
      receiveId: configuredReceiveId,
      msgType: 'text',
      content: JSON.stringify({ text: finalText }),
    };
  }

  return {
    receiveIdType: 'open_id',
    receiveId: '',
    msgType: 'text',
    content: JSON.stringify({ text: finalText }),
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

function buildFeishuStreamingCard(text, env = process.env, metadata = {}) {
  const status = metadata.status || '生成中';
  const done = status === '完成';
  const assistantName = getAssistantName(env);
  const content = String(text || '正在思考...').trim() || '正在思考...';
  const footer = [];
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_STATUS) || truthyEnv(env.FEISHU_FOOTER_STATUS_ENABLED)) {
    footer.push(`状态：${status}`);
  }
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_ELAPSED) || truthyEnv(env.FEISHU_FOOTER_ELAPSED_ENABLED)) {
    const duration = formatDuration(metadata.elapsedMs);
    if (duration) {
      footer.push(`耗时：${duration}`);
    }
  }
  if (truthyEnv(env.FEISHU_REPLY_FOOTER_TRACE_ID) || truthyEnv(env.FEISHU_FOOTER_TRACE_ID_ENABLED)) {
    const traceId = String(metadata.traceId || metadata.trace_id || '').trim();
    if (traceId) {
      footer.push(`Trace ID：${traceId}`);
    }
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: done ? 'green' : 'blue',
      title: {
        tag: 'plain_text',
        content: done ? `${assistantName} 已完成` : `${assistantName} 正在思考`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: content.slice(0, 6000),
        },
      },
      ...(footer.length > 0 ? [{
        tag: 'note',
        elements: [{
          tag: 'plain_text',
          content: footer.join(' · '),
        }],
      }] : []),
    ],
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

function formatDashboardNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function resolveDashboardPublicUrl(env = process.env) {
  return env.DASHBOARD_PUBLIC_URL
    || env.PUBLIC_DASHBOARD_URL
    || env.BRIDGE_PUBLIC_URL
    || '';
}

function buildFeishuDashboardCard(state = {}, env = process.env) {
  const assistantName = state.assistant || getAssistantName(env);
  const counts = state.tasks?.counts || {};
  const pipeline = state.pipeline || {};
  const latestRun = state.snapshot?.latestRun || {};
  const dashboardUrl = resolveDashboardPublicUrl(env);
  const generatedAt = state.generatedAt ? new Date(state.generatedAt).toLocaleString('zh-CN') : '';
  const summaryLines = [
    `**今日任务**：${formatDashboardNumber(counts.today)} 个，运行中 ${formatDashboardNumber(counts.running)}，失败 ${formatDashboardNumber(counts.failed)}，可恢复 ${formatDashboardNumber(counts.recoverable)}`,
    `**每日流水线**：${pipeline.status || '暂无'} · ${formatDashboardNumber(pipeline.completedStages)}/${formatDashboardNumber(pipeline.totalStages)} 阶段 · 失败 ${formatDashboardNumber(pipeline.failedStages)}`,
    `**Token**：${formatDashboardNumber(state.usage?.totalTokens)} · **邮件**：今日 ${formatDashboardNumber(state.mail?.todayCount)} 条`,
    `**服务**：${state.service?.streaming ? '流式开启' : '流式关闭'} · commit ${state.service?.commit || 'unknown'}`,
    latestRun.conclusion ? `**最近 UI**：${latestRun.conclusion}` : null,
    pipeline.nextAction ? `**下一步**：${pipeline.nextAction}` : null,
  ].filter(Boolean);

  const actions = [];
  if (dashboardUrl) {
    actions.push({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: '打开网页看板',
      },
      type: 'primary',
      url: dashboardUrl,
    });
  }
  if (latestRun.runUrl) {
    actions.push({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: 'GitHub Run',
      },
      type: dashboardUrl ? 'default' : 'primary',
      url: latestRun.runUrl,
    });
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: Number(counts.failed || 0) > 0 || Number(pipeline.failedStages || 0) > 0 ? 'yellow' : 'green',
      title: {
        tag: 'plain_text',
        content: `${assistantName} 控制台`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: summaryLines.join('\n'),
        },
      },
      ...(actions.length > 0 ? [{
        tag: 'action',
        actions,
      }] : []),
      {
        tag: 'note',
        elements: [{
          tag: 'plain_text',
          content: generatedAt ? `数据时间：${generatedAt}` : '这是飞书内摘要卡片；完整详情请打开网页看板。',
        }],
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

  const cacheKey = `${appId}:${appSecret}`;
  const cached = feishuTenantTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
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

  const expireSeconds = Number(body.expire);
  if (Number.isFinite(expireSeconds) && expireSeconds > 0) {
    feishuTenantTokenCache.set(cacheKey, {
      token: body.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, expireSeconds - 300) * 1000,
    });
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

async function sendFeishuMessageUpdate(env = process.env, messageId, message, fetchImpl = fetch) {
  if (!messageId) {
    throw new Error('Missing Feishu message id for message update.');
  }

  const tenantAccessToken = await fetchFeishuTenantAccessToken(env, fetchImpl);
  const response = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      msg_type: message.msgType,
      content: message.content,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu message update failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(`Feishu message update failed: ${body.msg || JSON.stringify(body)}`);
  }

  return body;
}

async function uploadFeishuImage(env = process.env, image, fetchImpl = fetch) {
  const tenantAccessToken = await fetchFeishuTenantAccessToken(env, fetchImpl);
  const buffer = Buffer.isBuffer(image?.buffer)
    ? image.buffer
    : Buffer.from(String(image?.b64Json || ''), 'base64');
  if (buffer.length === 0) {
    throw new Error('Missing image content for Feishu upload.');
  }

  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([buffer], { type: image?.mimeType || 'image/png' }), image?.filename || 'generated.png');
  const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Feishu image upload failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const body = await response.json();
  const imageKey = body?.data?.image_key || body?.image_key || '';
  if (body.code !== 0 || !imageKey) {
    throw new Error(`Feishu image upload failed: ${body.msg || JSON.stringify(body)}`);
  }
  return imageKey;
}

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  return 'png';
}

async function downloadFeishuMessageImage(env = process.env, messageId, imageKey, fetchImpl = fetch) {
  if (!messageId || !imageKey) {
    throw new Error('Missing Feishu message id or image key for download.');
  }

  const tenantAccessToken = await fetchFeishuTenantAccessToken(env, fetchImpl);
  const response = await fetchImpl(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Feishu image download failed: ${response.status} ${response.statusText}\n${body}`.trim());
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers?.get?.('content-type') || 'image/png';
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    filename: `${imageKey}.${extensionFromMimeType(mimeType)}`,
  };
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

function shouldNotifyEmail(env = process.env) {
  return String(env.EMAIL_NOTIFY_ENABLED || '').toLowerCase() === 'true';
}

function buildEmailRunResultSubject(job, run) {
  const conclusion = run.conclusion || 'unknown';
  const targetRef = job.targetRef || job.config?.inputs?.target_ref || 'unknown-ref';
  const runMode = job.runMode || job.config?.inputs?.run_mode || 'unknown-mode';
  return `[UI 自动化] ${conclusion} - ${targetRef} / ${runMode}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailRunResultMessage(job, run) {
  const text = formatRunResultMessage(job, run);
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const lines = [
    text,
    artifactsUrl ? `Allure / Playwright artifact：${artifactsUrl}` : '',
  ].filter(Boolean);

  const htmlLines = lines.map((line) => escapeHtml(line));
  const links = [
    runUrl ? `<p><a href="${escapeHtml(runUrl)}">GitHub Actions Run</a></p>` : '',
    artifactsUrl ? `<p><a href="${escapeHtml(artifactsUrl)}">Allure / Playwright Artifacts</a></p>` : '',
  ].filter(Boolean).join('\n');

  return {
    text: lines.join('\n'),
    html: [
      '<h2>UI 自动化测试结果</h2>',
      '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">',
      htmlLines.join('\n'),
      '</pre>',
      links,
    ].join('\n'),
  };
}

function parseEmailRecipients(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function applyImageChannelSwitch(route, env = process.env, options = {}) {
  const config = route.config || {};
  if (!config.url || !config.apiKey) {
    return buildImageChannelReply(route);
  }
  const envFile = options.envFile || env.FEISHU_ENV_FILE;
  if (!envFile) {
    return [
      '我识别到你要切换生图通道，但这次还没写入配置。',
      '原因：当前服务没有配置 FEISHU_ENV_FILE，无法定位环境变量文件。',
    ].join('\n');
  }

  const writer = options.envWriter || upsertEnvFileValue;
  writer(envFile, 'IMAGE_MODEL_BASE_URL', config.url);
  writer(envFile, 'IMAGE_MODEL_API_KEY', config.apiKey);
  writer(envFile, 'IMAGE_MODEL_ID', config.model || 'auto');
  writer(envFile, 'IMAGE_MODEL_SIZE', config.size || '1024x1024');

  const fetchImpl = options.fetchImpl || fetch;
  let modelsStatus = '未测试';
  try {
    const response = await fetchImpl(`${String(config.url).replace(/\/+$/, '')}/v1/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    modelsStatus = response.ok ? '通过' : `失败 ${response.status}`;
  } catch (error) {
    modelsStatus = `失败：${error.message}`;
  }

  const serviceName = options.serviceName || getLocalBridgeService(env);
  let restartStatus = '未重启';
  const shouldRestart = String(options.restart ?? env.IMAGE_CHANNEL_AUTO_RESTART ?? 'true').toLowerCase() !== 'false';
  if (shouldRestart) {
    const restart = options.restartService || ((service) => {
      setTimeout(() => {
        execFilePromise('systemctl', ['restart', service], { timeout: 30000 })
          .catch((error) => console.error(`Image channel restart failed: ${error.message}`));
      }, Number(env.IMAGE_CHANNEL_RESTART_DELAY_MS || 1200));
    });
    restart(serviceName);
    restartStatus = `已安排重启 ${serviceName}`;
  }

  return [
    '生图通道配置已写入。',
    `- URL：${config.url}`,
    `- Key：${config.maskedApiKey}`,
    `- Model：${config.model || 'auto'}`,
    `- Size：${config.size || '1024x1024'}`,
    `- /v1/models：${modelsStatus}`,
    `- 重启：${restartStatus}`,
  ].join('\n');
}

async function applyModelChannelSwitch(route, env = process.env, options = {}) {
  const config = route.config || {};
  if (!config.url || !config.apiKey) {
    return buildModelChannelReply(route);
  }
  const envFile = options.envFile || env.FEISHU_ENV_FILE;
  if (!envFile) {
    return [
      '我识别到你要切换聊天模型通道，但这次还没写入配置。',
      '原因：当前服务没有配置 FEISHU_ENV_FILE，无法定位环境变量文件。',
    ].join('\n');
  }

  const writer = options.envWriter || upsertEnvFileValue;
  writer(envFile, 'FEISHU_CHAT_STREAMING_ENABLED', 'true');
  writer(envFile, 'STREAMING_MODEL_BASE_URL', config.url);
  writer(envFile, 'STREAMING_MODEL_API_KEY', config.apiKey);
  writer(envFile, 'STREAMING_MODEL_ID', config.model || env.STREAMING_MODEL_ID || 'LongCat-Flash-Chat');
  writer(envFile, 'STREAMING_MODEL_SIMPLE_ID', config.simpleModel || env.STREAMING_MODEL_SIMPLE_ID || '');
  writer(envFile, 'STREAMING_MODEL_THINKING_ID', config.thinkingModel || env.STREAMING_MODEL_THINKING_ID || '');
  writer(envFile, 'STREAMING_MODEL_ENDPOINT_MODE', config.endpointMode || 'chat_completions');

  const fetchImpl = options.fetchImpl || fetch;
  let modelsStatus = '未测试';
  try {
    const response = await fetchImpl(`${String(config.url).replace(/\/+$/, '')}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    modelsStatus = response.ok ? '通过' : `失败 ${response.status}`;
  } catch (error) {
    modelsStatus = `失败：${error.message}`;
  }

  const serviceName = options.serviceName || getLocalBridgeService(env);
  let restartStatus = '未重启';
  const shouldRestart = String(options.restart ?? env.MODEL_CHANNEL_AUTO_RESTART ?? 'true').toLowerCase() !== 'false';
  if (shouldRestart) {
    const restart = options.restartService || ((service) => {
      setTimeout(() => {
        execFilePromise('systemctl', ['restart', service], { timeout: 30000 })
          .catch((error) => console.error(`Model channel restart failed: ${error.message}`));
      }, Number(env.MODEL_CHANNEL_RESTART_DELAY_MS || 1200));
    });
    restart(serviceName);
    restartStatus = `已安排重启 ${serviceName}`;
  }

  return [
    '聊天模型通道配置已写入。',
    `- URL：${config.url}`,
    `- Key：${config.maskedApiKey}`,
    `- Model：${config.model || env.STREAMING_MODEL_ID || 'LongCat-Flash-Chat'}`,
    config.simpleModel ? `- Simple：${config.simpleModel}` : null,
    config.thinkingModel ? `- Thinking：${config.thinkingModel}` : null,
    `- Endpoint：${config.endpointMode || 'chat_completions'}`,
    `- /v1/models：${modelsStatus}`,
    `- 重启：${restartStatus}`,
  ].filter(Boolean).join('\n');
}

function buildTokenFactoryBackgroundReply(task) {
  return [
    'token-factory 已创建后台任务。',
    `- 任务 ID：${task.id}`,
    `- 状态：${task.status}`,
    '我会在后台跑高 token 训练场和多 Agent 训练场。',
    '你可以说：文员，查看 token-factory 状态。',
  ].join('\n');
}

function buildTrendIntelReply(report, outputFile) {
  const items = Array.isArray(report?.items) ? report.items : [];
  const topLines = items.slice(0, 5).map((item, index) => {
    const stars = item.stars ? `（${item.stars} stars）` : '';
    return `${index + 1}. ${item.title}${stars} - ${item.source}`;
  });
  const errors = Array.isArray(report?.errors) && report.errors.length
    ? `\n- 降级源：${report.errors.map((item) => `${item.source}`).join('，')}`
    : '';
  return [
    '趋势情报已完成。',
    `- 条目数：${report?.total || 0}`,
    outputFile ? `- 文件：${outputFile}` : null,
    errors || null,
    topLines.length ? '' : null,
    ...topLines,
    '',
    '下一步可以说：文员，烧 100 万 token 分析今天 GitHub 热门项目。',
  ].filter((line) => line !== null).join('\n');
}

function buildTrendTokenFactoryReply(result = {}) {
  const report = result.report || {};
  const files = result.files || {};
  const followUp = Array.isArray(report.followUpProjects) && report.followUpProjects.length
    ? report.followUpProjects.slice(0, 6).join('，')
    : '暂无';
  return [
    '趋势 Token 工厂已完成。',
    `- 任务数：${report.totalJobs || 0}`,
    `- 失败任务：${report.failedJobs || 0}`,
    `- 真实 token：${report.totalTokens || 0}`,
    report.estimatedTotalTokens ? `- 字符估算 token：${report.estimatedTotalTokens}` : null,
    `- 推荐关注：${followUp}`,
    files.report ? `- 报告：${files.report}` : null,
    files.items ? `- 产物：${files.items}` : null,
    files.summary ? `- 摘要：${files.summary}` : null,
    Array.isArray(result.warnings) && result.warnings.length ? `- 警告：${result.warnings.length} 条，详见日志/产物。` : null,
    '',
    '报告已按 report 邮箱动作归档；这条链路会写 token/耗时账本，用来统计谁更费 token。',
  ].filter(Boolean).join('\n');
}

function mergeEmailRecipients(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    const items = Array.isArray(group) ? group : parseEmailRecipients(group);
    for (const item of items) {
      const email = String(item || '').trim();
      if (!email) {
        continue;
      }
      const key = email.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(email);
    }
  }
  return merged;
}

function parseMailActionProviderOverrides(value) {
  const overrides = new Map();
  for (const part of String(value || '').split(/[,\n]+/)) {
    const text = part.trim();
    if (!text) {
      continue;
    }

    const [actionName, providerName] = text.split('=').map((item) => item.trim());
    if (!actionName || !providerName) {
      continue;
    }

    overrides.set(actionName.toLowerCase(), providerName.toLowerCase());
  }

  return overrides;
}

function normalizeMailProviderName(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (['clawemail-role', 'claw-role', 'role'].includes(provider)) {
    return 'clawemail-role';
  }
  if (!provider || ['default', 'legacy', 'primary', 'smtp', 'clawemail'].includes(provider)) {
    return 'default';
  }

  if (['report', 'evanshine', 'secondary', 'alternate'].includes(provider)) {
    return 'evanshine';
  }

  return provider;
}

const CLAWEMAIL_ACTION_SENDERS = {
  report: ['watchee@claw.163.com', 'watchee.report@claw.163.com'],
  task: ['watchee@claw.163.com', 'watchee.ui@claw.163.com'],
  ui: ['watchee@claw.163.com', 'watchee.ui@claw.163.com'],
  github: ['watchee@claw.163.com', 'watchee.github@claw.163.com'],
  ops: ['watchee@claw.163.com', 'watchee.ops@claw.163.com'],
  replay: ['evasan@claw.163.com', 'evasan.replay@claw.163.com'],
  verify: ['evasan@claw.163.com', 'evasan.account@claw.163.com'],
  account: ['evasan@claw.163.com', 'evasan.account@claw.163.com'],
  shop: ['evasan@claw.163.com', 'evasan.shop@claw.163.com'],
  qa: ['evasan@claw.163.com', 'evasan.qa@claw.163.com'],
  files: ['agent3@claw.163.com', 'agent3.files@claw.163.com'],
  images: ['agent3@claw.163.com', 'agent3.images@claw.163.com'],
  sandbox: ['agent3@claw.163.com', 'agent3.sandbox@claw.163.com'],
  notify: ['agent3@claw.163.com', 'agent3.notify@claw.163.com'],
  daily: ['agent4@claw.163.com', 'agent4.daily@claw.163.com'],
  archive: ['agent4@claw.163.com', 'agent4.archive@claw.163.com'],
  support: ['agent4@claw.163.com', 'agent4.support@claw.163.com'],
  eval: ['agent4@claw.163.com', 'agent4.archive@claw.163.com'],
  monitor: ['hagent@claw.163.com', 'hagent.monitor@claw.163.com'],
  logs: ['hagent@claw.163.com', 'hagent.logs@claw.163.com'],
  security: ['hagent@claw.163.com', 'hagent.security@claw.163.com'],
  backup: ['hagent@claw.163.com', 'hagent.backup@claw.163.com'],
};

function resolveClawEmailSenderForAction(actionName, env = process.env) {
  const action = String(actionName || '').trim().toLowerCase();
  const mapping = CLAWEMAIL_ACTION_SENDERS[action];
  if (!mapping) {
    return null;
  }

  const configuredPrimary = String(
    env.CLAWEMAIL_ROLE_PRIMARY_FROM
    || env.EMAIL_FROM
    || env.SMTP_USER
    || '',
  ).trim();
  const useActionPrimary = String(env.CLAWEMAIL_ROLE_USE_ACTION_PRIMARY || '').toLowerCase() === 'true';
  const primaryFrom = !useActionPrimary && configuredPrimary.endsWith('@claw.163.com')
    ? configuredPrimary
    : mapping[0];

  return {
    action,
    primaryFrom,
    mappedPrimaryFrom: mapping[0],
    roleMailbox: mapping[1],
  };
}

function resolveMailProviderForAction(actionName, env = process.env) {
  const normalizedAction = String(actionName || '').trim().toLowerCase();
  const overrides = parseMailActionProviderOverrides(env.MAIL_ACTION_PROVIDER_OVERRIDES);
  if (normalizedAction && overrides.has(normalizedAction)) {
    return normalizeMailProviderName(overrides.get(normalizedAction));
  }

  if (normalizedAction === 'report' && env.MAIL_ROUTE_REPORT_PROVIDER) {
    return normalizeMailProviderName(env.MAIL_ROUTE_REPORT_PROVIDER);
  }

  if (normalizedAction === 'daily' && env.MAIL_ROUTE_DAILY_PROVIDER) {
    return normalizeMailProviderName(env.MAIL_ROUTE_DAILY_PROVIDER);
  }

  return 'default';
}

function buildSmtpProfile(providerName, env = process.env) {
  const provider = normalizeMailProviderName(providerName);
  if (provider === 'clawemail-role') {
    return {
      name: 'clawemail-role',
      bin: env.CLAWEMAIL_MAIL_CLI_BIN || 'mail-cli',
    };
  }

  if (provider === 'evanshine') {
    return {
      name: 'evanshine',
      host: env.REPORT_SMTP_HOST,
      port: Number(env.REPORT_SMTP_PORT || 587),
      secure: String(env.REPORT_SMTP_SECURE ?? 'false').toLowerCase() !== 'false',
      user: env.REPORT_SMTP_USER,
      pass: env.REPORT_SMTP_PASS,
      from: env.REPORT_EMAIL_FROM || env.REPORT_SMTP_USER,
    };
  }

  return {
    name: 'default',
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.EMAIL_FROM || env.SMTP_USER,
  };
}

function hasSmtpProfileConfig(profile) {
  return Boolean(profile?.host && profile?.user && profile?.pass);
}

async function sendSmtpMail(message, profile, options = {}) {
  const createTransport = options.createTransport || require('nodemailer').createTransport;
  const transport = createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: {
      user: profile.user,
      pass: profile.pass,
    },
  });

  const result = await transport.sendMail({
    from: profile.from || profile.user,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { sent: true, result, action: message.action, provider: profile.name };
}

async function sendClawEmailRoleMail(message, profile, options = {}) {
  const resolved = resolveClawEmailSenderForAction(message?.action, options.env || process.env);
  if (!resolved) {
    return { sent: false, reason: 'missing_clawemail_role', action: message?.action || 'unknown', provider: profile.name };
  }

  const roleProfile = {
    ...profile,
    from: resolved.primaryFrom,
    mappedPrimaryFrom: resolved.mappedPrimaryFrom,
    roleMailbox: resolved.roleMailbox,
  };

  if (options.mailCliSender) {
    const result = await options.mailCliSender(message, roleProfile);
    return {
      sent: result?.sent !== false,
      result,
      action: message.action,
      provider: profile.name,
      from: resolved.primaryFrom,
      roleMailbox: resolved.roleMailbox,
    };
  }

  const { execFile } = require('node:child_process');
  const recipients = Array.isArray(message.to) ? message.to.join(',') : String(message.to || '');
  const args = [
    'compose',
    'send',
    '--from',
    resolved.primaryFrom,
    '--to',
    recipients,
    '--subject',
    message.subject || '',
    '--body',
    message.text || '',
  ];

  const result = await new Promise((resolve, reject) => {
    execFile(profile.bin || 'mail-cli', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
        return;
      }
      resolve(stdout);
    });
  });

  return {
    sent: true,
    result,
    action: message.action,
    provider: profile.name,
    from: resolved.primaryFrom,
    roleMailbox: resolved.roleMailbox,
  };
}

async function sendMailWithRouting(message, env = process.env, options = {}) {
  const providerName = resolveMailProviderForAction(message?.action, env);
  const selectedProfile = buildSmtpProfile(providerName, env);
  if (selectedProfile.name === 'clawemail-role') {
    const result = await sendClawEmailRoleMail(message, selectedProfile, { ...options, env });
    appendMailLedgerEntry(env, {
      ...message,
      ...result,
      assistant: getAssistantName(env),
      traceId: message.traceId || options.traceId || options.timingContext?.traceId,
    });
    return result;
  }

  if (!hasSmtpProfileConfig(selectedProfile)) {
    const result = { sent: false, reason: 'missing_smtp_config', action: message?.action || 'unknown', provider: selectedProfile.name };
    appendMailLedgerEntry(env, {
      ...message,
      ...result,
      assistant: getAssistantName(env),
      traceId: message.traceId || options.traceId || options.timingContext?.traceId,
    });
    return result;
  }

  try {
    const result = await sendSmtpMail(message, selectedProfile, options);
    appendMailLedgerEntry(env, {
      ...message,
      ...result,
      assistant: getAssistantName(env),
      traceId: message.traceId || options.traceId || options.timingContext?.traceId,
    });
    return result;
  } catch (error) {
    if (selectedProfile.name === 'default') {
      throw error;
    }

    const fallbackProfile = buildSmtpProfile(
      env.MAIL_FALLBACK_PROVIDER || 'default',
      env,
    );
    if (!hasSmtpProfileConfig(fallbackProfile) || fallbackProfile.name === selectedProfile.name) {
      throw error;
    }

    const fallbackResult = await sendSmtpMail(message, fallbackProfile, options);
    const result = {
      ...fallbackResult,
      fallbackFrom: selectedProfile.name,
    };
    appendMailLedgerEntry(env, {
      ...message,
      ...result,
      assistant: getAssistantName(env),
      traceId: message.traceId || options.traceId || options.timingContext?.traceId,
    });
    return result;
  }
}

function buildMailboxActionEmailSubject(resolvedAction, fallbackSubject) {
  if (!resolvedAction?.subjectPrefix) {
    return fallbackSubject;
  }

  return `${resolvedAction.subjectPrefix} ${fallbackSubject}`.trim();
}

function buildReplayMessage(job, run) {
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const lines = [
    '失败任务回放提醒',
    `分支：${job.targetRef}`,
    `模式：${job.runMode}`,
    `结论：${run.conclusion || 'unknown'}`,
    runUrl ? `GitHub Actions：${runUrl}` : '',
    artifactsUrl ? `失败截图 / trace / artifact：${artifactsUrl}` : '',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    html: [
      '<h2>失败任务回放提醒</h2>',
      '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">',
      lines.map((line) => escapeHtml(line)).join('\n'),
      '</pre>',
      runUrl ? `<p><a href="${escapeHtml(runUrl)}">GitHub Actions Run</a></p>` : '',
      artifactsUrl ? `<p><a href="${escapeHtml(artifactsUrl)}">Artifacts / Trace</a></p>` : '',
    ].filter(Boolean).join('\n'),
  };
}

function buildFilesMessage(job, run) {
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const lines = [
    '报告附件与 artifact 入口',
    `分支：${job.targetRef}`,
    `模式：${job.runMode}`,
    runUrl ? `GitHub Actions：${runUrl}` : '',
    artifactsUrl ? `Allure / Playwright artifact：${artifactsUrl}` : '',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    html: [
      '<h2>报告附件与 Artifact 入口</h2>',
      '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">',
      lines.map((line) => escapeHtml(line)).join('\n'),
      '</pre>',
      runUrl ? `<p><a href="${escapeHtml(runUrl)}">GitHub Actions Run</a></p>` : '',
      artifactsUrl ? `<p><a href="${escapeHtml(artifactsUrl)}">Allure / Playwright Artifacts</a></p>` : '',
    ].filter(Boolean).join('\n'),
  };
}

function buildBusinessMailboxActionSubject(actionName, job, run) {
  const conclusion = run.conclusion || 'unknown';
  const targetRef = job.targetRef || job.config?.inputs?.target_ref || 'unknown-ref';
  const runMode = job.runMode || job.config?.inputs?.run_mode || 'unknown-mode';
  return `[${actionName}] ${conclusion} - ${targetRef} / ${runMode}`;
}

function buildBusinessMailboxMessage(actionName, resolvedAction, job, run) {
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const lines = [
    resolvedAction.description || `${actionName} 专项测试通知`,
    `动作：${actionName}`,
    `分支：${job.targetRef || job.config?.inputs?.target_ref || 'unknown-ref'}`,
    `模式：${job.runMode || job.config?.inputs?.run_mode || 'unknown-mode'}`,
    `结论：${run.conclusion || 'unknown'}`,
    runUrl ? `GitHub Actions：${runUrl}` : '',
    artifactsUrl ? `Allure / Playwright artifact：${artifactsUrl}` : '',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    html: [
      `<h2>${escapeHtml(resolvedAction.description || `${actionName} 专项测试通知`)}</h2>`,
      '<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">',
      lines.map((line) => escapeHtml(line)).join('\n'),
      '</pre>',
      runUrl ? `<p><a href="${escapeHtml(runUrl)}">GitHub Actions Run</a></p>` : '',
      artifactsUrl ? `<p><a href="${escapeHtml(artifactsUrl)}">Allure / Playwright Artifacts</a></p>` : '',
    ].filter(Boolean).join('\n'),
  };
}

function normalizeMailboxActionList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  return [...new Set(String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function getRequestedMailboxActions(job = {}) {
  const raw = job.mailboxActions
    || job.mailboxAction
    || job.config?.inputs?.mailbox_action
    || '';

  return normalizeMailboxActionList(raw);
}

function buildMailboxActionMessage(actionName, job, run, env = process.env) {
  const resolvedAction = resolveMailboxAction(actionName, env);
  if (!resolvedAction.enabled || !resolvedAction.mailbox) {
    return null;
  }

  let content;
  let fallbackSubject;
  if (actionName === 'report') {
    content = buildEmailRunResultMessage(job, run);
    fallbackSubject = buildEmailRunResultSubject(job, run);
  } else if (actionName === 'replay') {
    content = buildReplayMessage(job, run);
    fallbackSubject = buildEmailRunResultSubject(job, run);
  } else if (actionName === 'files') {
    content = buildFilesMessage(job, run);
    fallbackSubject = buildEmailRunResultSubject(job, run);
  } else if (['account', 'shop', 'support'].includes(actionName)) {
    content = buildBusinessMailboxMessage(actionName, resolvedAction, job, run);
    fallbackSubject = buildBusinessMailboxActionSubject(actionName, job, run);
  } else {
    return null;
  }

  return {
    action: actionName,
    mailbox: resolvedAction.mailbox,
    to: [resolvedAction.mailbox],
    subject: buildMailboxActionEmailSubject(resolvedAction, fallbackSubject),
    text: content.text,
    html: content.html,
  };
}

function buildUiMailboxMessages(job, run, env = process.env) {
  const messages = [];
  const appendedActions = new Set();
  const reportMessage = buildMailboxActionMessage('report', job, run, env);
  if (reportMessage) {
    messages.push(reportMessage);
    appendedActions.add(reportMessage.action);
  }

  if ((run.conclusion || 'unknown') !== 'success') {
    const replayMessage = buildMailboxActionMessage('replay', job, run, env);
    if (replayMessage) {
      messages.push(replayMessage);
      appendedActions.add(replayMessage.action);
    }
  }

  if (buildRunArtifactsUrl(run.html_url || job.actionsUrl || '')) {
    const filesMessage = buildMailboxActionMessage('files', job, run, env);
    if (filesMessage) {
      messages.push(filesMessage);
      appendedActions.add(filesMessage.action);
    }
  }

  for (const actionName of getRequestedMailboxActions(job)) {
    if (appendedActions.has(actionName)) {
      continue;
    }

    const actionMessage = buildMailboxActionMessage(actionName, job, run, env);
    if (actionMessage) {
      messages.push(actionMessage);
      appendedActions.add(actionMessage.action);
    }
  }

  return messages;
}

async function sendMailboxActionEmail(message, env = process.env, options = {}) {
  if (!shouldNotifyEmail(env)) {
    return { sent: false, reason: 'disabled', action: message?.action || 'unknown' };
  }

  const recipients = Array.isArray(message?.to) ? message.to.filter(Boolean) : [];
  if (!recipients.length) {
    return { sent: false, reason: 'missing_recipients', action: message?.action || 'unknown' };
  }

  return sendMailWithRouting({
    ...message,
    to: recipients,
  }, env, options);
}

async function notifyUiMailboxActions(job, run, env = process.env, options = {}) {
  if (!shouldNotifyEmail(env)) {
    return [];
  }

  const messages = buildUiMailboxMessages(job, run, env);
  const emailSender = options.emailSender || ((message, senderEnv) => sendMailboxActionEmail(message, senderEnv, options));

  for (const message of messages) {
    await Promise.resolve(emailSender({
      ...message,
      traceId: message.traceId || job.traceId || options.traceId || options.timingContext?.traceId,
    }, env));
  }

  return messages;
}

async function sendEmailRunResultNotification(job, run, env = process.env, options = {}) {
  if (!shouldNotifyEmail(env)) {
    return { sent: false, reason: 'disabled' };
  }

  const recipients = parseEmailRecipients(env.EMAIL_TO);
  if (!recipients.length) {
    return { sent: false, reason: 'missing_recipients' };
  }

  const message = buildEmailRunResultMessage(job, run);
  return sendMailWithRouting({
    action: 'report',
    traceId: job.traceId || options.traceId || options.timingContext?.traceId,
    to: recipients,
    subject: buildEmailRunResultSubject(job, run),
    text: message.text,
    html: message.html,
  }, env, options);
}

async function sendDailySummaryNotification(runs, env = process.env, options = {}) {
  if (!shouldNotifyEmail(env)) {
    return [];
  }

  const resolvedAction = resolveMailboxAction('daily', env);
  if (!resolvedAction.enabled) {
    return [];
  }

  const usageEntries = options.readUsageLedger
    ? options.readUsageLedger(env)
    : readUsageLedgerEntries(env);
  const savedRuns = Array.isArray(runs) && runs.length
    ? runs
    : readDailySummaryState(env).runs || [];
  const multiAgentSummary = readJsonFileSafe(
    join(env.MULTI_AGENT_LAB_OUTPUT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'multi-agent-lab'), 'summary.json'),
  );
  const summary = buildDailySummary({
    runs: savedRuns,
    usageEntries,
    multiAgentSummary,
  });
  const emailSender = options.emailSender || ((mail, senderEnv) => sendMailboxActionEmail(mail, senderEnv, options));
  const explicitRecipients = mergeEmailRecipients(options.recipientEmail || options.to);
  const fallbackRecipients = explicitRecipients.length
    ? []
    : mergeEmailRecipients(env.DAILY_SUMMARY_EXTERNAL_TO, env.EMAIL_TO);
  const externalRecipients = mergeEmailRecipients(explicitRecipients, fallbackRecipients)
    .filter((email) => email.toLowerCase() !== String(resolvedAction.mailbox || '').toLowerCase());
  const archiveRecipients = resolvedAction.mailbox ? [resolvedAction.mailbox] : [];
  const allRecipients = mergeEmailRecipients(externalRecipients, archiveRecipients);
  if (!allRecipients.length) {
    return [];
  }

  const message = {
    action: 'daily',
    traceId: options.traceId || options.timingContext?.traceId,
    mailbox: resolvedAction.mailbox,
    to: allRecipients,
    externalTo: externalRecipients,
    archiveTo: archiveRecipients,
    subject: buildMailboxActionEmailSubject(resolvedAction, summary.subject),
    text: summary.text,
    html: summary.html,
  };

  await Promise.resolve(emailSender(message, env));
  return [message];
}

async function notifyFeishuRunResult(job, env = process.env, fetchImpl = fetch, options = {}) {
  const feishuSender = options.feishuSender || ((senderEnv, message) => sendFeishuTextMessage(senderEnv, message, fetchImpl));
  if (!job.run?.id) {
    await feishuSender(env, {
      ...job.message,
      content: JSON.stringify({ text: `UI 自动化测试已启动，请查看：${job.actionsUrl}` }),
    });
    return null;
  }

  const waitForCompletion = options.waitForCompletion || waitForWorkflowCompletion;
  const completedRun = await waitForCompletion(job.config, job.run.id, fetchImpl, {
    attempts: Number(env.GITHUB_RUN_NOTIFY_ATTEMPTS || 60),
    intervalMs: Number(env.GITHUB_RUN_NOTIFY_INTERVAL_MS || 10000),
  });

  if (String(env.FEISHU_CARD_ENABLED ?? 'true').toLowerCase() !== 'false') {
    await feishuSender(env, {
      ...job.message,
      msgType: 'interactive',
      content: JSON.stringify(buildFeishuResultCard(job, completedRun)),
    });
  } else {
    const text = formatRunResultMessage(job, completedRun);
    await feishuSender(env, {
      ...job.message,
      content: JSON.stringify({ text }),
    });
  }

  const emailSender = options.emailSender;
  await Promise.resolve(notifyUiMailboxActions(job, completedRun, env, {
    ...options,
    emailSender,
  })).catch((error) => {
    console.error(`Email result notification failed: ${error.message}`);
  });
  appendDailySummaryRun(env, job, completedRun);
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

async function handleFeishuWebhook(payload, env = process.env, dispatch = dispatchWorkflow, parserOverride, schedulerOverride, fallbackParserOverride, parserSourceOverride, fallbackParserSourceOverride, timingContext) {
  const effectiveTimingContext = timingContext?.startedAt
    ? createFeishuTimingContext(timingContext.startedAt, resolveTraceIdFromPayload(payload, timingContext.traceId))
    : createFeishuTimingContext(nowMs(), resolveTraceIdFromPayload(payload));
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
      const parserSource = parserSourceOverride || 'openclaw';
      const parserStartedAt = nowMs();
      logFeishuTiming(env, effectiveTimingContext, 'model:start', {
        agent: 'ui-test-agent',
        source: parserSource,
        purpose: 'parser',
      });
      try {
        command = await parser(text, env);
        logTimedModelFinish(env, effectiveTimingContext, 'model:finish', parserStartedAt, {
          agent: 'ui-test-agent',
          source: parserSource,
          purpose: 'parser',
        });
        commandSource = command ? parserSource : commandSource;
      } catch (parserError) {
        logTimedModelFinish(env, effectiveTimingContext, 'model:error', parserStartedAt, {
          agent: 'ui-test-agent',
          source: parserSource,
          purpose: 'parser',
        });
        if (!isHermesFallbackEnabled(env)) {
          throw parserError;
        }

        const hermesParser = fallbackParserOverride || runHermesParser;
        const fallbackSource = fallbackParserSourceOverride || 'hermes';
        const fallbackStartedAt = nowMs();
        logFeishuTiming(env, effectiveTimingContext, 'model:start', {
          agent: 'ui-test-agent',
          source: fallbackSource,
          purpose: 'parser',
        });
        command = await hermesParser(text, env);
        logTimedModelFinish(env, effectiveTimingContext, 'model:finish', fallbackStartedAt, {
          agent: 'ui-test-agent',
          source: fallbackSource,
          purpose: 'parser',
        });
        commandSource = command ? fallbackSource : commandSource;
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
  const traceId = effectiveTimingContext.traceId;
  const notificationMessage = buildFeishuTextMessage(
    payload,
    `UI 自动化测试已启动：分支 ${command.targetRef}，模式 ${command.runMode}\n链接：${workflowRunUrl || result.actionsUrl}`,
    env,
    { traceId },
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
      traceId,
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
      traceId,
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

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(body);
}

function getRequestPath(url = '') {
  try {
    return new URL(String(url || '/'), 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
  }
}

async function handleDashboardRequest(request, response, env = process.env, options = {}) {
  if (request.method !== 'GET') {
    return false;
  }

  const pathname = getRequestPath(request.url);
  if (pathname === '/dashboard' || pathname === '/console') {
    const state = await buildDashboardState(env, options);
    sendHtml(response, 200, buildDashboardHtml(state));
    return true;
  }

  if (pathname === '/api/dashboard' || pathname === '/api/console/status') {
    sendJson(response, 200, await buildDashboardState(env, options));
    return true;
  }

  return false;
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

function getWechatMpConfig(env = process.env) {
  return {
    appId: env.WECHAT_MP_APP_ID || '',
    token: env.WECHAT_MP_TOKEN || '',
    bindCode: env.WECHAT_MP_BIND_CODE || '',
    allowedOpenIds: String(env.WECHAT_MP_ALLOWED_OPENIDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    replyTimeoutMs: Number(env.WECHAT_MP_REPLY_TIMEOUT_MS || 4500),
    maxReplyChars: Number(env.WECHAT_MP_MAX_REPLY_CHARS || 900),
  };
}

function verifyWechatMpSignature(query = {}, token = '') {
  const signature = String(query.signature || '');
  const timestamp = String(query.timestamp || '');
  const nonce = String(query.nonce || '');
  if (!signature || !timestamp || !nonce || !token) {
    return false;
  }
  const digest = createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
  return digest === signature;
}

function escapeWechatXml(value = '') {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[char]));
}

function extractWechatXmlTag(xml = '', tag = '') {
  const match = String(xml || '').match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) {
    return '';
  }
  return String(match[1] ?? match[2] ?? '').trim();
}

function parseWechatMpXml(xml = '') {
  return {
    toUserName: extractWechatXmlTag(xml, 'ToUserName'),
    fromUserName: extractWechatXmlTag(xml, 'FromUserName'),
    createTime: Number(extractWechatXmlTag(xml, 'CreateTime') || 0),
    msgType: extractWechatXmlTag(xml, 'MsgType'),
    content: extractWechatXmlTag(xml, 'Content'),
    event: extractWechatXmlTag(xml, 'Event'),
    msgId: extractWechatXmlTag(xml, 'MsgId'),
  };
}

function buildWechatMpTextReplyXml(message = {}, content = '') {
  const now = Math.floor(Date.now() / 1000);
  return [
    '<xml>',
    `<ToUserName><![CDATA[${escapeWechatXml(message.fromUserName || '')}]]></ToUserName>`,
    `<FromUserName><![CDATA[${escapeWechatXml(message.toUserName || '')}]]></FromUserName>`,
    `<CreateTime>${now}</CreateTime>`,
    '<MsgType><![CDATA[text]]></MsgType>',
    `<Content><![CDATA[${escapeWechatXml(content || '收到')}]]></Content>`,
    '</xml>',
  ].join('');
}

function buildWechatSyntheticFeishuPayload(message = {}) {
  const text = message.content || (message.event === 'subscribe' ? '你好' : '');
  return {
    header: {
      event_type: 'wechat.mp.message',
    },
    event: {
      sender: {
        sender_id: {
          user_id: message.fromUserName || '',
          open_id: message.fromUserName || '',
        },
      },
      message: {
        message_id: message.msgId || `${message.fromUserName || 'wechat'}:${message.createTime || Date.now()}`,
        chat_id: message.fromUserName || '',
        message_type: 'text',
        content: JSON.stringify({ text }),
      },
    },
  };
}

function buildWechatMpRouteEnv(env = process.env, message = {}) {
  const routeEnv = buildRouteEnv('hermes', env);
  const config = getWechatMpConfig(env);
  routeEnv.FEISHU_ASSISTANT_NAME = env.WECHAT_MP_ASSISTANT_NAME || routeEnv.FEISHU_ASSISTANT_NAME || 'Hermes';
  routeEnv.FEISHU_ALLOWED_USER_IDS = config.allowedOpenIds.join(',');
  routeEnv.FEISHU_ALLOWED_USER_IDS_ENV_KEY = 'WECHAT_MP_ALLOWED_OPENIDS';
  routeEnv.FEISHU_REQUIRE_BINDING = config.allowedOpenIds.length
    ? ''
    : (env.WECHAT_MP_REQUIRE_BINDING || 'true');
  routeEnv.WECHAT_MP_FROM_OPENID = message.fromUserName || '';
  return routeEnv;
}

function isWechatMpBindCommand(text = '', config = getWechatMpConfig()) {
  const normalized = String(text || '').trim();
  if (config.bindCode) {
    const match = normalized.match(/^绑定我\s+(.+)$/);
    return Boolean(match && String(match[1]).trim() === config.bindCode);
  }
  return /^(绑定我|只允许我|限制为我|我的ID|我的id|whoami)$/i.test(normalized);
}

function trimWechatReply(text = '', limit = 900) {
  const value = String(text || '').trim() || '收到。';
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 20))}\n\n（内容较长，已截断）`;
}

function withWechatTimeout(promise, timeoutMs = 4500) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({
        handled: true,
        replyText: '收到，Hermes 正在处理。这个任务可能超过微信公众号被动回复时间限制，请稍后再发“任务状态”或到飞书查看。',
      }), Math.max(1000, timeoutMs));
    }),
  ]);
}

async function handleWechatMpWebhook(request, response, env = process.env, options = {}) {
  const config = getWechatMpConfig(env);
  const url = new URL(String(request.url || '/'), 'http://127.0.0.1');
  const query = Object.fromEntries(url.searchParams.entries());
  if (!verifyWechatMpSignature(query, config.token)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('invalid signature');
    return true;
  }

  if (request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(String(query.echostr || ''));
    return true;
  }

  if (request.method !== 'POST') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('method not allowed');
    return true;
  }

  const rawBody = await readRequestBody(request);
  const message = parseWechatMpXml(rawBody);
  const payload = buildWechatSyntheticFeishuPayload(message);
  const routeEnv = buildWechatMpRouteEnv(env, message);
  const text = extractFeishuText(payload);
  if (isWechatMpBindCommand(text, config)) {
    const senderId = message.fromUserName || '';
    if (!senderId) {
      response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      response.end(buildWechatMpTextReplyXml(message, '没有拿到 openid，暂时不能绑定。'));
      return true;
    }
    const envFile = env.WECHAT_MP_ENV_FILE || env.FEISHU_ENV_FILE || '/etc/hermes-feishu-bridge.env';
    if (envFile) {
      upsertEnvFileValue(envFile, 'WECHAT_MP_ALLOWED_OPENIDS', senderId);
    }
    routeEnv.FEISHU_ALLOWED_USER_IDS = senderId;
    routeEnv.FEISHU_REQUIRE_BINDING = '';
    response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    response.end(buildWechatMpTextReplyXml(message, `已绑定当前公众号用户。\nopenid：${senderId}`));
    return true;
  }
  const routeResolver = options.resolveAgentRoute || resolveAgentRoute;
  const routedReplyBuilder = options.buildRoutedAgentReply || buildRoutedAgentReply;
  const route = await routeResolver(text, routeEnv, options);
  const routed = await withWechatTimeout(
    routedReplyBuilder(payload, routeEnv, options, route),
    config.replyTimeoutMs,
  );
  const replyText = trimWechatReply(routed?.replyText || '收到。', config.maxReplyChars);
  response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  response.end(buildWechatMpTextReplyXml(message, replyText));
  return true;
}

function buildRouteOptions(mode, options = {}) {
  if (mode !== 'hermes') {
    return options;
  }

  return {
    ...options,
    chat: options.chat || runHermesChat,
    hermesChat: options.hermesChat || runHermesChat,
    parser: options.parser || runHermesParser,
    hermesParser: options.hermesParser || runHermesParser,
    parserSource: options.parserSource || 'hermes',
    fallbackParserSource: options.fallbackParserSource || 'hermes',
  };
}

function buildRouteEnv(mode, env = process.env) {
  const fileEnv = readEnvFileValues(env.FEISHU_ENV_FILE);
  if (mode !== 'hermes') {
    return {
      ...env,
      PEER_NAME: env.PEER_NAME || fileEnv.PEER_NAME || '',
      PEER_SSH_HOST: env.PEER_SSH_HOST || fileEnv.PEER_SSH_HOST || '',
      PEER_SSH_USER: env.PEER_SSH_USER || fileEnv.PEER_SSH_USER || '',
      PEER_SSH_PORT: env.PEER_SSH_PORT || fileEnv.PEER_SSH_PORT || '',
      PEER_SSH_KEY: env.PEER_SSH_KEY || fileEnv.PEER_SSH_KEY || '',
    };
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
  routeEnv.PEER_NAME = env.PEER_NAME || fileEnv.PEER_NAME || '';
  routeEnv.PEER_SSH_HOST = env.PEER_SSH_HOST || fileEnv.PEER_SSH_HOST || '';
  routeEnv.PEER_SSH_USER = env.PEER_SSH_USER || fileEnv.PEER_SSH_USER || '';
  routeEnv.PEER_SSH_PORT = env.PEER_SSH_PORT || fileEnv.PEER_SSH_PORT || '';
  routeEnv.PEER_SSH_KEY = env.PEER_SSH_KEY || fileEnv.PEER_SSH_KEY || '';
  return routeEnv;
}

function isAsyncWebhookEnabled(env) {
  return String(env.FEISHU_WEBHOOK_ASYNC ?? 'true').toLowerCase() !== 'false';
}

function isIntentPlannerEnabled(env = process.env, options = {}) {
  if (typeof options.intentPlanner === 'function') {
    return true;
  }
  const flag = String(env.FEISHU_INTENT_PLANNER_ENABLED ?? env.INTENT_PLANNER_ENABLED ?? 'auto').toLowerCase();
  if (['false', '0', 'off', 'no'].includes(flag)) {
    return false;
  }
  if (['true', '1', 'on', 'yes'].includes(flag)) {
    return true;
  }
  const config = buildStreamingChatConfig(env);
  return Boolean(config.baseUrl && config.model && (config.apiKey || config.apiKeys?.length));
}

function isPlannerCandidateRoute(route = {}) {
  if (route.agent === 'chat-agent') {
    return true;
  }
  return route.agent === 'planner-agent'
    && route.action === 'clarify'
    && ['low', 'medium'].includes(String(route.confidence || 'low'));
}

function isStrongRuleRoute(route = {}) {
  if (!isPlannerCandidateRoute(route)) {
    return true;
  }
  return false;
}

function getIntentContextOptions(env = process.env) {
  return {
    filePath: env.INTENT_CONTEXT_FILE || env.FEISHU_INTENT_CONTEXT_FILE,
    ttlMs: Number(env.INTENT_CONTEXT_TTL_MS || env.FEISHU_INTENT_CONTEXT_TTL_MS || 30 * 60 * 1000),
    maxEntries: Number(env.INTENT_CONTEXT_MAX_ENTRIES || env.FEISHU_INTENT_CONTEXT_MAX_ENTRIES || 200),
  };
}

function resolveContextHintRoute(text, env = process.env, options = {}) {
  try {
    const conversationKey = buildConversationKey(options.payload, options.conversationKey);
    const hint = typeof options.intentContextReader === 'function'
      ? options.intentContextReader(conversationKey, { text, env, options })
      : getFreshIntentHint(conversationKey, getIntentContextOptions(env));
    return routeFromContextHint(text, hint);
  } catch (error) {
    console.error(`Intent context read failed: ${error.message}`);
    return null;
  }
}

function shouldWriteIntentContext(route = {}) {
  if (!route || route.agent === 'chat-agent' || route.agent === 'planner-agent' || route.agent === 'ui-test-agent') {
    return false;
  }
  if (route.action === 'clarify' || String(route.action || '').endsWith('-clarify') || route.confidence === 'low') {
    return false;
  }
  if (route.outcome === 'clarify' || route.outcome === 'failed') {
    return false;
  }
  if (route.error || route.failed) {
    return false;
  }
  return Boolean(route.agent && route.action);
}

function buildIntentContextMetadata(route = {}) {
  return {
    agent: route.agent,
    action: route.action,
    confidence: route.confidence || 'high',
    requiresAuth: Boolean(route.requiresAuth),
    source: route.intentSource || 'routed-agent',
  };
}

function shouldRecordRoutedIntentContext(result = {}, route = {}) {
  if (!result?.handled || result.intentContext === false || result.failed) {
    return false;
  }
  if (route.agent === 'ops-agent' && result.outcome === 'clarify') {
    return false;
  }
  return shouldWriteIntentContext(route);
}

function recordIntentContext(payload, route = {}, env = process.env, options = {}) {
  if (!shouldWriteIntentContext(route)) {
    return;
  }
  const metadata = buildIntentContextMetadata(route);
  try {
    if (typeof options.intentContextWriter === 'function') {
      options.intentContextWriter(payload, metadata);
      return;
    }
    const conversationKey = buildConversationKey(payload, options.conversationKey);
    if (!conversationKey) {
      return;
    }
    writeIntentContext(conversationKey, metadata, getIntentContextOptions(env));
  } catch (error) {
    console.error(`Intent context write failed: ${error.message}`);
  }
}

function getPlannerRequiresAuth(agent, action) {
  if (agent === 'chat-agent' || agent === 'capability-agent' || agent === 'planner-agent') {
    return false;
  }
  if (agent === 'doc-agent') {
    return true;
  }
  return Boolean(action && agent);
}

function isSafePlannerRoute(planned = {}) {
  const agent = String(planned.agent || '').trim();
  const action = String(planned.action || '').trim();
  const confidence = String(planned.confidence || 'medium').trim();
  if (!['high', 'medium'].includes(confidence)) {
    return false;
  }
  const allowedAgents = new Set([
    'chat-agent',
    'qa-agent',
    'ops-agent',
    'ui-test-agent',
    'image-agent',
    'memory-agent',
    'doc-agent',
    'capability-agent',
    'planner-agent',
    'clerk-agent',
    'browser-agent',
  ]);
  if (!allowedAgents.has(agent) || !action) {
    return false;
  }
  if (getPlannerRequiresAuth(agent, action) && confidence !== 'high') {
    return false;
  }
  if (agent === 'ops-agent') {
    return new Set(['status', 'health', 'watchdog', 'logs', 'memory-summary', 'disk-summary', 'load-summary']).has(action);
  }
  if (agent === 'browser-agent') {
    return new Set([
      'browser-clarify',
      'browser-capture-plan',
      'protocol-capture-plan',
      'protocol-assets-report',
      'protocol-assets-to-tests',
    ]).has(action);
  }
  if (agent === 'clerk-agent') {
    return new Set([
      'command-center',
      'task-center-brain',
      'task-center-today',
      'todo-summary',
      'token-summary',
      'trend-intel',
      'daily-pipeline-status',
      'mailbox-workbench',
      'mailbox-tasks',
      'mail-ledger',
      'mailbox-daily-report',
      'recent-files',
      'file-channel-workbench',
      'training-data',
    ]).has(action);
  }
  return true;
}

function toPlannerRoute(planned = {}) {
  return {
    agent: String(planned.agent || 'chat-agent'),
    action: String(planned.action || 'chat'),
    confidence: String(planned.confidence || 'medium'),
    reason: String(planned.reason || '').slice(0, 200),
    missing: Array.isArray(planned.missing) ? planned.missing : [],
    intentSource: 'model-planner',
    requiresAuth: getPlannerRequiresAuth(planned.agent, planned.action),
  };
}

async function runIntentPlanner(text, env = process.env, options = {}) {
  const prompt = buildIntentPlannerPrompt(text, getAssistantName(env));
  const startedAt = nowMs();
  const timingContext = options.timingContext;
  logFeishuTiming(env, timingContext, 'intent-planner:start', {
    agent: 'intent-planner',
  });

  let output;
  let modelResult = null;
  if (typeof options.intentPlanner === 'function') {
    output = await options.intentPlanner(prompt, { text, env });
  } else {
    const planner = options.intentPlannerRunner || ((plannerPrompt, plannerOptions) => streamModelText(plannerPrompt, {
      env,
      modelTier: 'simple',
      requestTimeoutMs: Number(env.FEISHU_INTENT_PLANNER_TIMEOUT_MS || env.INTENT_PLANNER_TIMEOUT_MS || 15000),
      ...plannerOptions,
    }));
    modelResult = await planner(prompt, {});
    output = modelResult?.text || modelResult;
  }

  const parsed = output && typeof output === 'object' && output.agent
    ? output
    : parseIntentPlannerOutput(output);
  if (modelResult) {
    logUsageLedger(env, {
      timingContext,
      route: { agent: 'intent-planner', action: 'route' },
      modelResult,
      elapsedMs: elapsedMs(timingContext?.startedAt),
      modelElapsedMs: elapsedMs(startedAt),
      promptChars: prompt.length,
      replyChars: String(modelResult.text || '').length,
    });
  }
  logTimedModelFinish(env, timingContext, 'intent-planner:finish', startedAt, {
    agent: parsed?.agent || 'unknown',
    action: parsed?.action || 'unknown',
    confidence: parsed?.confidence || 'unknown',
  });
  return parsed;
}

async function resolveAgentRoute(text, env = process.env, options = {}) {
  const ruleRoute = routeAgentIntent(text);
  if (ruleRoute.agent === 'chat-agent' && parseSmallTalkMessage(text, env)) {
    return ruleRoute;
  }
  if (!isStrongRuleRoute(ruleRoute)) {
    const contextRoute = resolveContextHintRoute(text, env, options);
    if (contextRoute) {
      return contextRoute;
    }
  }
  if (isStrongRuleRoute(ruleRoute) || !isIntentPlannerEnabled(env, options)) {
    return ruleRoute;
  }

  try {
    const planned = await runIntentPlanner(text, env, options);
    if (!planned || !isSafePlannerRoute(planned)) {
      return ruleRoute;
    }
    return toPlannerRoute(planned);
  } catch (error) {
    logFeishuTiming(env, options.timingContext, 'intent-planner:error', {
      message: error.message,
    });
    return ruleRoute;
  }
}

function isChatStreamingEnabled(env = process.env) {
  if (!truthyEnv(env.FEISHU_CHAT_STREAMING_ENABLED)) {
    return false;
  }

  const config = buildStreamingChatConfig(env);
  return Boolean(config.baseUrl && config.model && (config.apiKey || config.apiKeys?.length));
}

function extractFeishuMessageId(sendResult) {
  return sendResult?.data?.message_id
    || sendResult?.data?.message?.message_id
    || sendResult?.message_id
    || sendResult?.data?.messageId
    || '';
}

function buildFeishuTextUpdateMessage(text, env = process.env, metadata = {}) {
  return {
    msgType: 'text',
    content: JSON.stringify({
      text: appendFeishuReplyFooter(text, env, metadata),
    }),
  };
}

function buildFeishuCardUpdateMessage(text, env = process.env, metadata = {}) {
  return {
    msgType: 'interactive',
    content: JSON.stringify(buildFeishuStreamingCard(text, env, metadata)),
  };
}

function buildImagePrompt(text, route = {}) {
  return String(route.prompt || text || '')
    .replace(/^\/(?:image|img|draw|generate-image)\s+/i, '')
    .trim();
}

function resolveFeishuImageReference(payload, options = {}) {
  const imageKeys = extractFeishuImageKeys(payload);
  const messageId = getFeishuInputMessageId(payload);
  if (imageKeys.length && messageId) {
    return {
      messageId,
      imageKey: imageKeys[0],
      source: 'current-message',
    };
  }

  const memory = recallFeishuImage(payload, options.imageMemory || recentFeishuImages);
  if (memory) {
    return {
      messageId: memory.messageId,
      imageKey: memory.imageKey,
      source: 'recent-message',
    };
  }

  return null;
}

function buildImageResultCard(result, prompt, env = process.env) {
  const assistantName = getAssistantName(env);
  const imageElement = result.imageKey
    ? {
      tag: 'img',
      img_key: result.imageKey,
      alt: {
        tag: 'plain_text',
        content: '生成图片',
      },
    }
    : result.type === 'url'
      ? {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `[打开图片](${result.url})`,
        },
      }
    : {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `[图片 data URL](${result.dataUrl})`,
      },
    };

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: `${assistantName} 图片生成完成`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**模型**：${result.model}`,
            `**提示词**：${String(prompt).slice(0, 500)}`,
          ].join('\n'),
        },
      },
      imageElement,
    ],
  };
}

async function buildImageAgentReply(payload, text, env, options = {}, route = {}) {
  const prompt = buildImagePrompt(text, route);
  if (!prompt) {
    return {
      handled: true,
      replyText: '请告诉我要生成什么图片，比如：生成一张图片：赛博风电商客服机器人海报。',
    };
  }

  const receiptSender = options.receiptSender;
  if (!receiptSender) {
    return {
      handled: true,
      replyText: '收到生图请求，但当前缺少飞书回复通道。',
    };
  }

  const timingContext = options.timingContext;
  const imageRef = route.action === 'edit' || extractFeishuImageKeys(payload).length
    ? resolveFeishuImageReference(payload, options)
    : null;
  if (route.action === 'edit' && !imageRef) {
    return {
      handled: true,
      replyText: '我还没拿到要处理的图片。你可以直接发图片并写“修复这张旧照片”，或者先发图片，再说“修复刚才那张”。',
    };
  }

  await sendTimedFeishuMessage(
    receiptSender,
    buildFeishuTextMessage(payload, imageRef ? `收到，开始处理图片：${prompt}` : `收到，开始生成图片：${prompt}`, env, {
      status: imageRef ? '处理中' : '生成中',
      elapsedMs: elapsedMs(timingContext?.startedAt),
    }),
    env,
    timingContext,
    'image-receipt',
  );

  let result;
  if (imageRef) {
    const imageDownloader = options.imageDownloader || ((messageId, imageKey) => downloadFeishuMessageImage(env, messageId, imageKey));
    const sourceImage = await imageDownloader(imageRef.messageId, imageRef.imageKey);
    const imageEditor = options.imageEditor || ((imagePrompt, editOptions) => editImage(imagePrompt, { env, ...editOptions }));
    result = await imageEditor(prompt, { image: sourceImage, imageRef });
  } else {
    const imageGenerator = options.imageGenerator || ((imagePrompt) => generateImage(imagePrompt, { env }));
    result = await imageGenerator(prompt);
  }
  const imageUploader = options.imageUploader || ((imageResult) => uploadFeishuImage(env, imageResult));
  const imageKey = result.type === 'b64_json' ? await imageUploader(result) : '';
  const dataUrl = result.type === 'b64_json' && !imageKey ? `data:${result.mimeType || 'image/png'};base64,${result.b64Json}` : '';
  await sendTimedFeishuMessage(
    receiptSender,
    buildFeishuCardMessage(payload, buildImageResultCard({
      ...result,
      imageKey,
      dataUrl,
    }, prompt, env), env),
    env,
    timingContext,
    'image-result',
  );

  return {
    handled: true,
    replyText: null,
  };
}

async function buildRoutedChatReply(text, env, options = {}) {
  if (String(env.OPENCLAW_CHAT_ENABLED ?? 'true').toLowerCase() === 'false') {
    return null;
  }

  const detectChatDiagnosisPrefix = (input) => {
    const normalized = String(input || '').trim().toLowerCase();
    if (!normalized || /^(你好|hi|hello|嗨|哈喽)$/.test(normalized)) {
      return '';
    }
    if (/(怎么玩|怎么用|如何用|可以怎么|能拿来干嘛|适合做什么)/.test(normalized)) {
      return '看起来你是在问玩法，我先按好上手的方式跟你说。';
    }
    if (/(为什么|怎么会|为啥|原因|老是|总是|怎么又)/.test(normalized)) {
      return '我理解你是在问问题原因，我先从最可能的几处排查起。';
    }
    if (/(现在|目前|当前|进展|怎么样了|还差|是否|有没有)/.test(normalized)) {
      return '你这是在问当前状态，我先按我现在能确认的部分说。';
    }
    return '你这是在聊想法，我先顺着你的思路一起拆。';
  };

  const prompt = buildChatAgentPrompt(text);
  const chat = options.chat || runOpenClawChat;
  const timingContext = options.timingContext;
  const modelStartedAt = nowMs();
  logFeishuTiming(env, timingContext, 'model:start', {
    agent: 'chat-agent',
    source: getAssistantName(env),
  });
  try {
    const reply = await chat(prompt, env);
    logTimedModelFinish(env, timingContext, 'model:finish', modelStartedAt, {
      agent: 'chat-agent',
      source: getAssistantName(env),
    });
    const prefix = detectChatDiagnosisPrefix(text);
    return prefix ? `${prefix}\n${reply}` : reply;
  } catch (error) {
    logTimedModelFinish(env, timingContext, 'model:error', modelStartedAt, {
      agent: 'chat-agent',
      source: getAssistantName(env),
    });
    if (!isHermesFallbackEnabled(env)) {
      throw error;
    }

    const hermesChat = options.hermesChat || runHermesChat;
    const fallbackStartedAt = nowMs();
    logFeishuTiming(env, timingContext, 'model:start', {
      agent: 'chat-agent',
      source: 'fallback',
    });
    const reply = await hermesChat(prompt, env);
    logTimedModelFinish(env, timingContext, 'model:finish', fallbackStartedAt, {
      agent: 'chat-agent',
      source: 'fallback',
    });
    const prefix = detectChatDiagnosisPrefix(text);
    return prefix ? `${prefix}\n${reply}` : reply;
  }
}

async function streamRoutedChatReply(payload, text, env, options = {}) {
  if (String(env.OPENCLAW_CHAT_ENABLED ?? 'true').toLowerCase() === 'false') {
    return {
      streamed: false,
      replyText: null,
    };
  }

  if (!isChatStreamingEnabled(env)) {
    return {
      streamed: false,
      replyText: null,
    };
  }

  const receiptSender = options.receiptSender;
  const messageUpdater = options.messageUpdater || ((messageId, message) => sendFeishuMessageUpdate(env, messageId, message));
  if (!receiptSender) {
    return {
      streamed: false,
      replyText: null,
    };
  }

  const prompt = buildChatAgentPrompt(text);
  const timingContext = options.timingContext;
  const placeholder = buildFeishuCardMessage(payload, buildFeishuStreamingCard('正在思考...', env, {
    status: '生成中',
    elapsedMs: elapsedMs(timingContext?.startedAt),
    traceId: timingContext?.traceId,
  }), env);
  const sendResult = await sendTimedFeishuMessage(receiptSender, placeholder, env, timingContext, 'stream-placeholder');
  const messageId = extractFeishuMessageId(sendResult);
  if (!messageId) {
    return {
      streamed: false,
      replyText: null,
    };
  }

  const streamChat = options.streamChat || ((streamPrompt, streamOptions) => streamModelText(streamPrompt, {
    env,
    ...streamOptions,
  }));
  const modelStartedAt = nowMs();
  logFeishuTiming(env, timingContext, 'model:start', {
    agent: 'chat-agent',
    source: 'streaming',
  });

  let lastUpdateAt = Number.NEGATIVE_INFINITY;
  let pendingUpdate = Promise.resolve();
  const minIntervalMs = Number(env.FEISHU_STREAM_UPDATE_INTERVAL_MS || 800);
  const waitForUpdate = async () => {
    try {
      await pendingUpdate;
    } catch (error) {
      console.error(`Feishu streaming card update failed: ${error.message}`);
    }
  };
  const update = async (fullText, force = false) => {
    const now = nowMs();
    if (!force && now - lastUpdateAt < minIntervalMs) {
      return;
    }
    lastUpdateAt = now;
    const message = buildFeishuCardUpdateMessage(fullText || '正在思考...', env, {
      status: force ? '完成' : '生成中',
      elapsedMs: elapsedMs(timingContext?.startedAt),
      traceId: timingContext?.traceId,
    });
    if (force) {
      await waitForUpdate();
      pendingUpdate = Promise.resolve(messageUpdater(messageId, message));
      await waitForUpdate();
      return;
    }

    pendingUpdate = pendingUpdate.catch(() => {}).then(() => messageUpdater(messageId, message));
  };

  try {
    const result = await streamChat(prompt, {
      onDelta: async (delta, fullText) => {
        await update(fullText);
      },
    });
    await update(result.text, true);
    logUsageLedger(env, {
      timingContext,
      route: { agent: 'chat-agent', action: 'chat' },
      modelResult: result,
      elapsedMs: elapsedMs(timingContext?.startedAt),
      modelElapsedMs: elapsedMs(modelStartedAt),
      promptChars: prompt.length,
      replyChars: String(result.text || '').length,
    });
    logTimedModelFinish(env, timingContext, 'model:finish', modelStartedAt, {
      agent: 'chat-agent',
      source: result.endpoint || 'streaming',
      model: result.model,
      tier: result.tier,
      total_tokens: result.usage?.total_tokens,
    });
    return {
      streamed: true,
      replyText: result.text,
    };
  } catch (error) {
    logTimedModelFinish(env, timingContext, 'model:error', modelStartedAt, {
      agent: 'chat-agent',
      source: 'streaming',
    });
    console.error(`Feishu streaming chat failed: ${error.message}`);
    return {
      streamed: false,
      replyText: null,
    };
  }
}

const MULTI_INTENT_EXECUTION_ALLOWLIST = new Set([
  'ops-agent:load-summary',
  'ops-agent:memory-summary',
  'ops-agent:disk-summary',
  'clerk-agent:command-center',
  'clerk-agent:task-center-failed',
  'clerk-agent:token-summary',
  'clerk-agent:training-data',
  'qa-agent:training-data',
  'browser-agent:protocol-assets-report',
  'browser-agent:protocol-assets-to-tests',
]);

function isExecutableMultiIntent(route = {}) {
  return MULTI_INTENT_EXECUTION_ALLOWLIST.has(`${route.agent}:${route.action}`);
}

function formatMultiIntentExecutionReply(results = []) {
  const completed = results.filter((item) => item.status === 'completed');
  const skipped = results.filter((item) => item.status === 'skipped');
  const failed = results.filter((item) => item.status === 'failed');
  const lines = [
    '多意图执行结果：',
    `- 已执行：${completed.length}`,
    skipped.length ? `- 已跳过：${skipped.length}（需要单独明确确认）` : null,
    failed.length ? `- 失败：${failed.length}` : null,
  ].filter(Boolean);

  for (const [index, result] of results.entries()) {
    lines.push('', `${index + 1}. ${result.label}`);
    if (result.status === 'completed') {
      lines.push(...String(result.replyText || '已完成').split(/\r?\n/).slice(0, 8));
    } else if (result.status === 'skipped') {
      lines.push(`已跳过：${result.reason || '这个动作不在多意图自动执行白名单里'}`);
    } else {
      lines.push(`执行失败：${redactPeerOutput(result.error || 'unknown error')}`);
    }
  }

  return lines.join('\n');
}

async function runDefaultMultiIntentSubRoute(subRoute = {}, payload, env, options = {}, text = '') {
  if (subRoute.agent === 'ops-agent') {
    const runOpsCheck = options.runOpsCheck || ((action) => runLocalOpsAction(action, env, {
      execFile: options.execFile,
      fetchImpl: options.fetchImpl,
      route: subRoute,
    }));
    return buildOpsAgentReply(subRoute, { runOpsCheck });
  }
  if (subRoute.agent === 'clerk-agent') {
    return buildClerkAgentReply(subRoute, { env });
  }
  if (subRoute.agent === 'qa-agent') {
    return buildQaAgentReply(subRoute);
  }
  if (subRoute.agent === 'browser-agent') {
    return buildBrowserAgentReply({ ...subRoute, rawText: text }, {
      env,
      text,
      protocolAssetReporter: options.protocolAssetReporter || ((request = {}) => {
        const report = buildProtocolAssetReport({ text: request.query || text }, { env });
        return {
          summary: [
            `总数 ${report.total}`,
            `方法 ${Object.entries(report.byMethod || {}).map(([key, value]) => `${key}:${value}`).join('、') || '无'}`,
            `状态 ${Object.entries(report.byStatusClass || {}).map(([key, value]) => `${key}:${value}`).join('、') || '无'}`,
          ].join('；'),
          lines: (report.recent || []).map((item, index) => `${index + 1}. ${item.method} ${item.path} ${item.status} ${item.id}`),
        };
      }),
      protocolTestCaseBuilder: options.protocolTestCaseBuilder || ((request = {}) => buildProtocolTestCases(
        { text: request.query || text },
        { env, limit: 10 },
      )),
    });
  }
  return '这个子意图暂时只能单独执行。';
}

async function executeSafeMultiIntentPlan(route = {}, payload, env, options = {}, text = '') {
  const intents = Array.isArray(route.plan?.intents) ? route.plan.intents.slice(0, 5) : [];
  const executor = options.multiIntentExecutor || ((subRoute) => runDefaultMultiIntentSubRoute(subRoute, payload, env, options, text));
  const results = [];

  for (const intent of intents) {
    const subRoute = {
      ...intent,
      rawText: text,
      requiresAuth: Boolean(intent.requiresAuth),
    };
    const label = `${subRoute.agent}/${subRoute.action}`;
    if (!isExecutableMultiIntent(subRoute)) {
      results.push({
        label,
        status: 'skipped',
        reason: '发邮件、重启、修复、清理、跑测试或长耗时任务需要单独明确指令。',
      });
      continue;
    }
    try {
      const replyText = await Promise.resolve(executor(subRoute));
      results.push({
        label,
        status: 'completed',
        replyText,
      });
    } catch (error) {
      results.push({
        label,
        status: 'failed',
        error: error.message || error,
      });
    }
  }

  return formatMultiIntentExecutionReply(results);
}

async function buildRoutedAgentReply(payload, env, options = {}, route = routeAgentIntent(extractFeishuText(payload))) {
  const result = await buildRoutedAgentReplyResult(payload, env, options, route);
  if (shouldRecordRoutedIntentContext(result, route)) {
    recordIntentContext(payload, route, env, options);
  }
  return result;
}

async function buildRoutedAgentReplyResult(payload, env, options = {}, route = routeAgentIntent(extractFeishuText(payload))) {
  if (route.agent === 'ui-test-agent') {
    return {
      handled: false,
      replyText: '',
    };
  }

  const text = extractFeishuText(payload);
  const diagnosis = buildIntentDiagnosis(text, route);
  if (route.requiresAuth && !isAuthorized(payload, env)) {
    return {
      handled: true,
      intentContext: false,
      replyText: getUnauthorizedMessage(env),
    };
  }

  if (route.agent === 'doc-agent') {
    return {
      handled: true,
      replyText: buildDocAgentReply(text),
    };
  }

  if (route.agent === 'capability-agent') {
    return {
      handled: true,
      replyText: buildCapabilityGuideReply(getAssistantName(env)),
    };
  }

  if (route.agent === 'planner-agent') {
    if (route.action === 'multi-intent-plan') {
      return {
        handled: true,
        replyText: await executeSafeMultiIntentPlan(route, payload, env, options, text),
      };
    }
    return {
      handled: true,
      replyText: buildPlannerClarifyReply(text),
    };
  }

  if (route.agent === 'memory-agent') {
    return {
      handled: true,
      replyText: await buildMemoryAgentReply(route, undefined, {
        assistantName: getAssistantName(env),
        env,
      }),
    };
  }

  if (route.agent === 'ecosystem-agent') {
    if (route.requiresAuth && !isAuthorized(payload, env)) {
      return {
        handled: true,
        intentContext: false,
        replyText: getUnauthorizedMessage(env),
      };
    }

    if (route.action === 'install-safe') {
      const installer = options.ecosystemInstaller || installSupportedEcosystem;
      let state;
      try {
        state = await Promise.resolve(installer({
          env,
          target: route.target,
          stateFile: env.ECOSYSTEM_STATE_FILE,
        }));
      } catch (error) {
        return {
          handled: true,
          failed: true,
          intentContext: false,
          replyText: [
            buildEcosystemAgentReply(route, {
              env,
              assistantName: getAssistantName(env),
            }),
            '',
            `服务器安装执行失败：${redactPeerOutput(error.message || error)}`,
          ].join('\n'),
        };
      }
      return {
        handled: true,
        replyText: buildEcosystemStatusReply({
          target: route.target === 'hermes' ? 'Hermes' : route.target === 'openclaw' ? 'OpenClaw' : getAssistantName(env),
          ...state,
        }),
      };
    }

    if (route.action === 'enable-maintenance') {
      const maintainer = options.ecosystemMaintainer || runMaintenance;
      const state = await Promise.resolve(maintainer({
        env,
        stateFile: env.ECOSYSTEM_STATE_FILE,
      }));
      return {
        handled: true,
        replyText: [
          '生态后台自检已执行一次，并会交给服务器 timer 长期巡检。',
          buildEcosystemStatusReply(state),
        ].join('\n'),
      };
    }

    return {
      handled: true,
      replyText: buildEcosystemStatusReply(readEcosystemState(env.ECOSYSTEM_STATE_FILE) || {
        target: getAssistantName(env),
        installed: [],
        skipped: [],
      }),
    };
  }

  if (route.agent === 'qa-agent') {
    if (route.action === 'dify-testing-assistant') {
      const difyRunner = options.difyTestingAssistantRunner || askDifyTestingAssistant;
      const result = await difyRunner(route.query || text, {
        env,
        fetchImpl: options.fetchImpl,
      });
      return {
        handled: true,
        replyText: buildDifyTestingAssistantReply({ ...route, rawText: text }, result),
      };
    }
    return {
      handled: true,
      replyText: buildQaAgentReply(route),
    };
  }

  if (route.agent === 'browser-agent') {
    return {
      handled: true,
      replyText: await buildBrowserAgentReply({ ...route, rawText: text }, {
        env,
        text,
        browserAutomationRunner: options.browserAutomationRunner,
        browserFactory: options.browserFactory,
        playwrightAdapter: options.playwrightAdapter,
        protocolAssetSaver: options.protocolAssetSaver || ((asset) => saveProtocolAsset(asset, { env })),
        protocolAssetReporter: options.protocolAssetReporter || ((request = {}) => {
          const report = buildProtocolAssetReport({ text: request.query || text }, { env });
          return {
            summary: [
              `总数 ${report.total}`,
              `方法 ${Object.entries(report.byMethod || {}).map(([key, value]) => `${key}:${value}`).join('、') || '无'}`,
              `状态 ${Object.entries(report.byStatusClass || {}).map(([key, value]) => `${key}:${value}`).join('、') || '无'}`,
            ].join('；'),
            lines: (report.recent || []).map((item, index) => `${index + 1}. ${item.method} ${item.path} ${item.status} ${item.id}`),
          };
        }),
        protocolTestCaseBuilder: options.protocolTestCaseBuilder || ((request = {}) => buildProtocolTestCases(
          { text: request.query || text },
          { env, limit: 10 },
        )),
        screenshotPath: options.screenshotPath,
      }),
    };
  }

  if (route.agent === 'clerk-agent') {
    if (route.action === 'token-factory-status') {
      return {
        handled: true,
        replyText: formatTokenFactoryTask(getTokenFactoryTaskStatus(env, route.taskId)),
      };
    }

    if (route.action === 'dashboard-card') {
      if (!options.receiptSender) {
        return {
          handled: true,
          replyText: '当前飞书回复通道不可用，网页看板地址请直接打开 /dashboard。',
        };
      }
      const dashboardStateBuilder = options.dashboardStateBuilder || buildDashboardState;
      const state = await dashboardStateBuilder(env, options);
      await sendTimedFeishuMessage(
        options.receiptSender,
        buildFeishuCardMessage(payload, buildFeishuDashboardCard(state, env), env),
        env,
        options.timingContext,
        'dashboard-card',
      );
      return {
        handled: true,
        replyText: null,
      };
    }

    if (route.action === 'token-factory') {
      if (options.receiptSender) {
        await sendTimedFeishuMessage(
          options.receiptSender,
          buildFeishuTextMessage(payload, '收到，开始跑整套 token 工厂：先高 token 训练场，再多 Agent 训练场。完成后我会给你汇总。', env, {
            status: '运行中',
            elapsedMs: elapsedMs(options.timingContext?.startedAt),
            traceId: options.timingContext?.traceId,
          }),
          env,
          options.timingContext,
          'token-factory-receipt',
        ).catch((error) => {
          console.error(`Feishu token factory receipt failed: ${error.message}`);
        });
      }
      const tokenLabRunner = options.tokenLabRunner || ((runnerOptions) => runTokenLab(runnerOptions));
      const multiAgentLabRunner = options.multiAgentLabRunner || (async (runnerOptions) => {
        const base = await runMultiAgentLab(runnerOptions);
        return {
          summary: {
            totalRounds: Number(base.plan?.rounds?.length || 3),
            totalItems: Number(base.summary?.totalItems || 0),
            totalTokens: Number(base.summary?.totalTokens || 0),
            estimatedTotalTokens: Number(base.summary?.estimatedTotalTokens || 0),
            failedJobs: Number(base.summary?.failedJobs || 0),
            winner: base.summary?.winner || '平手',
          },
          files: base.files || {},
        };
      });
      const emailSender = options.emailSender
        ? (message, senderEnv) => options.emailSender(message, senderEnv)
        : (message, senderEnv) => sendMailboxActionEmail(message, senderEnv, options);
      const starter = options.tokenFactoryStarter || ((starterOptions) => startTokenFactoryTask(starterOptions));
      const started = starter({
        env,
        tokenLabRunner,
        multiAgentLabRunner,
        emailSender,
      });
      if (started.promise && options.trackBackgroundTasks) {
        options.trackBackgroundTasks.push(started.promise);
      }

      return {
        handled: true,
        replyText: buildTokenFactoryBackgroundReply(started.task),
      };
    }

    if (route.action === 'trend-intel') {
      if (options.receiptSender) {
        await sendTimedFeishuMessage(
          options.receiptSender,
          buildFeishuTextMessage(payload, '收到，开始抓今天的 GitHub 热榜、Hacker News 和 RSS 热点。完成后我会给你摘要和产物路径。', env, {
            status: '运行中',
            elapsedMs: elapsedMs(options.timingContext?.startedAt),
            traceId: options.timingContext?.traceId,
          }),
          env,
          options.timingContext,
          'trend-intel-receipt',
        ).catch((error) => {
          console.error(`Feishu trend intel receipt failed: ${error.message}`);
        });
      }
      const collector = options.trendIntelCollector || ((collectorOptions) => collectTrendIntel(collectorOptions.env, collectorOptions.fetchImpl || fetch, collectorOptions));
      const reportBuilder = options.trendIntelReportBuilder || buildTrendIntelReport;
      const writer = options.trendIntelReportWriter || writeTrendIntelReport;
      const outputFile = env.TREND_INTEL_OUTPUT_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'trend-intel', 'latest.json');
      const items = await collector({
        env,
        fetchImpl: options.fetchImpl,
      });
      const report = reportBuilder(items);
      writer(outputFile, report);
      return {
        handled: true,
        replyText: buildTrendIntelReply(report, outputFile),
      };
    }

    if (route.action === 'trend-token-factory') {
      if (options.receiptSender) {
        await sendTimedFeishuMessage(
          options.receiptSender,
          buildFeishuTextMessage(payload, '收到，开始跑趋势 Token 工厂：读取今日热点，批量调用模型分析开源项目、新闻和训练数据价值。完成后我会发报告。', env, {
            status: '运行中',
            elapsedMs: elapsedMs(options.timingContext?.startedAt),
            traceId: options.timingContext?.traceId,
          }),
          env,
          options.timingContext,
          'trend-token-factory-receipt',
        ).catch((error) => {
          console.error(`Feishu trend token factory receipt failed: ${error.message}`);
        });
      }
      const emailSender = options.emailSender
        ? (message, senderEnv) => options.emailSender(message, senderEnv)
        : (message, senderEnv) => sendMailboxActionEmail(message, senderEnv, options);
      const runner = options.trendTokenFactoryRunner || ((runnerOptions) => runTrendTokenFactory(runnerOptions));
      const result = await runner({
        env,
        batchSize: env.TREND_TOKEN_FACTORY_BATCH_SIZE,
        outputDir: env.TREND_TOKEN_FACTORY_OUTPUT_DIR,
        emailSender,
      });
      return {
        handled: true,
        replyText: buildTrendTokenFactoryReply(result),
      };
    }

    if (route.action === 'token-lab') {
      if (options.receiptSender) {
        await sendTimedFeishuMessage(
          options.receiptSender,
          buildFeishuTextMessage(payload, '收到，开始跑高 token 训练场。这个任务会批量调用模型，完成后我会发报告和产物路径。', env, {
            status: '运行中',
            elapsedMs: elapsedMs(options.timingContext?.startedAt),
            traceId: options.timingContext?.traceId,
          }),
          env,
          options.timingContext,
          'token-lab-receipt',
        ).catch((error) => {
          console.error(`Feishu token lab receipt failed: ${error.message}`);
        });
      }
      const tokenLabRunner = options.tokenLabRunner || ((runnerOptions) => runTokenLab(runnerOptions));
      const result = await tokenLabRunner({
        env,
        batchSize: env.QA_TOKEN_LAB_BATCH_SIZE,
        outputDir: env.QA_TOKEN_LAB_OUTPUT_DIR,
        emailSender: options.emailSender
          ? (message, senderEnv) => options.emailSender(message, senderEnv)
          : (message, senderEnv) => sendMailboxActionEmail(message, senderEnv, options),
      });
      const report = result.report || {};
      const files = result.files || {};
      return {
        handled: true,
        replyText: [
          '高 token 训练场已完成。',
          `- 任务数：${report.totalJobs || 0}`,
          `- 真实 token：${report.totalTokens || 0}`,
          report.estimatedTotalTokens ? `- 字符估算 token：${report.estimatedTotalTokens}` : null,
          files.report ? `- 报告：${files.report}` : null,
          files.items ? `- 产物：${files.items}` : null,
          '',
          '摘要已按邮箱动作归档；你可以继续说：文员，统计今天 Hermes 和 OpenClaw 谁更费 token。',
        ].filter(Boolean).join('\n'),
      };
    }

    if (route.action === 'multi-agent-lab') {
      if (options.receiptSender) {
        await sendTimedFeishuMessage(
          options.receiptSender,
          buildFeishuTextMessage(payload, '收到，开始跑多 Agent 训练场。这会多轮调用模型做生成、评审和总结，完成后我会发报告和产物路径。', env, {
            status: '运行中',
            elapsedMs: elapsedMs(options.timingContext?.startedAt),
            traceId: options.timingContext?.traceId,
          }),
          env,
          options.timingContext,
          'multi-agent-lab-receipt',
        ).catch((error) => {
          console.error(`Feishu multi-agent lab receipt failed: ${error.message}`);
        });
      }
      const multiAgentLabRunner = options.multiAgentLabRunner || (async (runnerOptions) => {
        const base = await runMultiAgentLab(runnerOptions);
        return {
          summary: {
            totalRounds: Number(base.plan?.rounds?.length || 3),
            totalItems: Number(base.summary?.totalItems || 0),
            totalTokens: Number(base.summary?.totalTokens || 0),
            estimatedTotalTokens: Number(base.summary?.estimatedTotalTokens || 0),
            failedJobs: Number(base.summary?.failedJobs || 0),
            winner: base.summary?.winner || '平手',
          },
          files: base.files || {},
        };
      });
      const result = await multiAgentLabRunner({
        env,
        batchSize: env.MULTI_AGENT_LAB_BATCH_SIZE || env.QA_TOKEN_LAB_BATCH_SIZE,
        outputDir: env.MULTI_AGENT_LAB_OUTPUT_DIR || env.QA_TOKEN_LAB_OUTPUT_DIR,
        emailSender: options.emailSender
          ? (message, senderEnv) => options.emailSender(message, senderEnv)
          : (message, senderEnv) => sendMailboxActionEmail(message, senderEnv, options),
      });
      const summary = result.summary || {};
      const files = result.files || {};
      return {
        handled: true,
        replyText: [
          '多 Agent 训练场已完成。',
          `- 轮次：${summary.totalRounds || 0}`,
          `- 样本数：${summary.totalItems || 0}`,
          `- 真实 token：${summary.totalTokens || 0}`,
          summary.estimatedTotalTokens ? `- 字符估算 token：${summary.estimatedTotalTokens}` : null,
          summary.failedJobs ? `- 失败样本：${summary.failedJobs}` : null,
          summary.winner ? `- 当前赢家：${summary.winner}` : null,
          files.report ? `- 报告：${files.report}` : null,
          files.items ? `- 产物：${files.items}` : null,
          files.summary ? `- 摘要：${files.summary}` : null,
          '',
          '摘要建议归档到 archive / eval / report；后面可以继续把它扩成真正的 OpenClaw vs Hermes 对打流水线。',
        ].filter(Boolean).join('\n'),
      };
    }

    if (route.action === 'daily-email-invalid-recipient') {
      return {
        handled: true,
        intentContext: false,
        replyText: [
          `我理解你想${diagnosis.intentLabel}。`,
          '这次我先没执行。',
          `原因：你给的邮箱格式不对：${route.invalidRecipient}`,
          diagnosis.nextStep,
        ].filter(Boolean).join('\n'),
      };
    }

    if (route.action === 'daily-email') {
      const messages = await sendDailySummaryNotification([], env, {
        ...options,
        traceId: options.traceId || options.timingContext?.traceId,
        recipientEmail: route.recipientEmail,
      });
      const primaryRecipients = messages[0]?.externalTo?.length
        ? messages[0].externalTo.join(', ')
        : (messages[0]?.archiveTo?.length ? messages[0].archiveTo.join(', ') : 'daily 邮箱');
      const archiveRecipients = messages[0]?.archiveTo?.length
        ? `（已归档到 ${messages[0].archiveTo.join(', ')}）`
        : '';
      const status = messages.length
        ? `已发送日报到 ${primaryRecipients}${archiveRecipients}。`
        : '日报邮件没有发出：请检查 EMAIL_NOTIFY_ENABLED、默认 SMTP、evanshine 第二 SMTP，以及 daily 邮箱动作是否启用。';
      return {
        handled: true,
        intentContext: messages.length ? undefined : false,
        replyText: [
          diagnosis.reason,
          status,
          '',
          await buildClerkAgentReply(route, { env }),
        ].join('\n'),
      };
    }
    if (route.action === 'daily-report' && diagnosis.outcome === 'clarify') {
      return {
        handled: true,
        outcome: 'clarify',
        intentContext: false,
        replyText: [
          `我理解你想${diagnosis.intentLabel}。`,
          '这次我先没执行发送。',
          `原因：${diagnosis.reason}`,
          diagnosis.nextStep,
          '',
          await buildClerkAgentReply(route, { env }),
        ].filter(Boolean).join('\n'),
      };
    }
    return {
      handled: true,
      replyText: await buildClerkAgentReply(route, {
        env,
        publishWechatMpArticle: options.publishWechatMpArticle,
      }),
    };
  }

  if (route.agent === 'image-agent') {
    if (route.requiresAuth && !isAuthorized(payload, env)) {
      return {
        handled: true,
        intentContext: false,
        replyText: getUnauthorizedMessage(env),
      };
    }
    if (route.action === 'image-channel-clarify' || route.action === 'image-channel-switch') {
      return {
        handled: true,
        replyText: route.action === 'image-channel-switch'
          ? await applyImageChannelSwitch(route, env, options)
          : buildImageChannelReply(route),
      };
    }
    return buildImageAgentReply(payload, text, env, options, route);
  }

  if (route.agent === 'model-agent') {
    if (route.requiresAuth && !isAuthorized(payload, env)) {
      return {
        handled: true,
        intentContext: false,
        replyText: getUnauthorizedMessage(env),
      };
    }
    return {
      handled: true,
      replyText: route.action === 'model-channel-switch'
        ? await applyModelChannelSwitch(route, env, options)
        : buildModelChannelReply(route),
    };
  }

  if (route.agent === 'ops-agent') {
    const runOpsCheck = options.runOpsCheck || ((action) => {
      if (action === 'peer-exec') {
        return runPeerSshAction(action, env, {}, route);
      }
      if (String(action).startsWith('peer-')) {
        return runPeerSshAction(action, env, {}, route);
      }
      return runLocalOpsAction(action, env, {
        execFile: options.execFile,
        fetchImpl: options.fetchImpl,
        route,
      });
    });
    const bridgedRunOpsCheck = async (action, currentRoute) => {
      const executableAction = ['peer-memory-summary', 'peer-disk-summary', 'peer-load-summary'].includes(action)
        ? 'peer-status'
        : action;
      return runOpsCheck(executableAction, currentRoute);
    };
    return {
      handled: true,
      outcome: diagnosis.outcome,
      intentContext: diagnosis.outcome === 'clarify' ? false : undefined,
      replyText: diagnosis.outcome === 'clarify'
        ? [
          `我理解你想做的是：${diagnosis.intentLabel}。`,
          '这次我先没执行。',
          `原因：${diagnosis.reason}`,
          diagnosis.nextStep ? `你可以直接说：${diagnosis.nextStep}` : null,
        ].filter(Boolean).join('\n')
        : await buildOpsAgentReply(route, { runOpsCheck: bridgedRunOpsCheck }),
    };
  }

  if (route.agent === 'chat-agent') {
    const streamed = await streamRoutedChatReply(payload, text, env, options);
    if (streamed.streamed) {
      return {
        handled: true,
        replyText: null,
      };
    }

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

function sendTimedFeishuMessage(receiptSender, message, env, timingContext, label) {
  const sendStartedAt = nowMs();
  logFeishuTiming(env, timingContext, 'send:start', { label });
  return Promise.resolve(receiptSender(message)).then((result) => {
    logFeishuTiming(env, timingContext, 'send:finish', {
      label,
      send_elapsed_ms: elapsedMs(sendStartedAt),
    });
    return result;
  }).catch((error) => {
    logFeishuTiming(env, timingContext, 'send:error', {
      label,
      send_elapsed_ms: elapsedMs(sendStartedAt),
    });
    throw error;
  });
}

function sendRoutedFeishuReply(receiptSender, payload, replyText, env, label, timingContext) {
  if (!replyText) {
    return Promise.resolve();
  }

  return sendTimedFeishuMessage(receiptSender, buildFeishuTextMessage(payload, replyText, env, {
    status: '完成',
    elapsedMs: elapsedMs(timingContext?.startedAt),
    traceId: timingContext?.traceId,
  }), env, timingContext, label).catch((error) => {
    console.error(`Feishu ${label} reply failed: ${error.message}`);
  });
}

function runWebhookInBackground(payload, env, options = {}) {
  setTimeout(() => {
    const text = extractFeishuText(payload);
    const receiptSender = options.receiptSender || ((reply) => sendFeishuTextMessage(env, reply));
    const timingContext = options.timingContext?.startedAt
      ? createFeishuTimingContext(options.timingContext.startedAt, resolveTraceIdFromPayload(payload, options.timingContext.traceId))
      : createFeishuTimingContext(nowMs(), resolveTraceIdFromPayload(payload));
    rememberFeishuImage(
      payload,
      options.imageMemory || recentFeishuImages,
      Number(env.FEISHU_IMAGE_MEMORY_TTL_MS || 10 * 60 * 1000),
    );

    if (!hasFeishuReplyTarget(payload)) {
      console.log('Ignored Feishu message without reply target.');
      return;
    }

    if (parseBindCommand(text)) {
      bindAllowedSender(payload, env, options)
        .then((replyText) => sendTimedFeishuMessage(receiptSender, buildFeishuTextMessage(payload, replyText, env, {
          traceId: timingContext.traceId,
        }), env, timingContext, 'bind'))
        .then(() => logFeishuTiming(env, timingContext, 'finish', { outcome: 'bind' }))
        .catch((error) => {
          console.error(`Feishu bind reply failed: ${error.message}`);
        });
      return;
    }

    Promise.resolve(resolveAgentRoute(text, env, { ...options, timingContext, payload })).then((route) => {
      logFeishuTiming(env, timingContext, 'route', {
        agent: route.agent,
        action: route.action,
        source: route.intentSource || 'rules',
        requires_auth: route.requiresAuth,
      });
      if (shouldIgnorePassiveGroupMessage(payload, text, env, route)) {
        console.log('Ignored passive Feishu group message.');
        logFeishuTiming(env, timingContext, 'finish', { outcome: 'ignored_passive_group' });
        return;
      }

      const smallTalkReply = parseSmallTalkMessage(extractFeishuText(payload), env);
      if (smallTalkReply) {
        const message = buildFeishuTextMessage(payload, smallTalkReply, env, {
          traceId: timingContext.traceId,
        });
        sendTimedFeishuMessage(receiptSender, message, env, timingContext, 'small-talk')
          .then(() => logFeishuTiming(env, timingContext, 'finish', { outcome: 'small_talk' }))
          .catch((error) => {
            console.error(`Feishu small talk reply failed: ${error.message}`);
          });
        return;
      }

      if (route.agent !== 'ui-test-agent') {
        Promise.resolve(buildRoutedAgentReply(payload, env, { ...options, receiptSender, timingContext }, route))
          .then(({ replyText }) => sendRoutedFeishuReply(receiptSender, payload, replyText, env, 'routed-agent', timingContext))
          .then(() => logFeishuTiming(env, timingContext, 'finish', { outcome: 'routed_agent' }))
          .catch((error) => {
            console.error(`Feishu routed agent failed: ${error.message}`);
          });
        return;
      }

      if (!isAuthorized(payload, env)) {
        sendTimedFeishuMessage(receiptSender, buildFeishuTextMessage(payload, getUnauthorizedMessage(env), env, {
          traceId: timingContext.traceId,
        }), env, timingContext, 'unauthorized')
          .then(() => logFeishuTiming(env, timingContext, 'finish', { outcome: 'unauthorized' }))
          .catch((error) => {
            console.error(`Feishu unauthorized reply failed: ${error.message}`);
          });
        return;
      }

      if (shouldNotifyFeishu(env) && shouldSendAutomationReceipt(env)) {
        const receipt = buildFeishuTextMessage(
          payload,
          '收到了，正在运行 UI 自动化测试。报告生成后我会发给你。',
          env,
          { traceId: timingContext.traceId },
        );
        sendTimedFeishuMessage(receiptSender, receipt, env, timingContext, 'automation-receipt').catch((error) => {
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
        timingContext,
      ).then(() => {
        logFeishuTiming(env, timingContext, 'finish', { outcome: 'ui_test' });
      }).catch((error) => {
        logFeishuTiming(env, timingContext, 'finish', { outcome: 'error' });
        console.error(`Feishu webhook background job failed: ${error.message}`);
      });
    }).catch((error) => {
      logFeishuTiming(env, timingContext, 'finish', { outcome: 'error' });
      console.error(`Feishu route resolution failed: ${error.message}`);
    });
  }, 0);
}

function createServer(env = process.env, options = {}) {
  const dedupCache = options.dedupCache || new Map();
  return http.createServer(async (request, response) => {
    const timingContext = createFeishuTimingContext();
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (await handleDashboardRequest(request, response, env, options)) {
      return;
    }

    if (getRequestPath(request.url) === '/webhook/wechat/mp') {
      if (await handleWechatMpWebhook(request, response, env, options)) {
        return;
      }
    }

    const routeMode = getFeishuRouteMode(request.url);
    if (request.method !== 'POST' || !routeMode) {
      sendJson(response, 404, { ok: false, message: 'Not found' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      timingContext.traceId = resolveTraceIdFromPayload(payload, timingContext.traceId);
      const effectiveRouteMode = getFeishuPayloadMode(payload, env, routeMode);
      const routeOptions = buildRouteOptions(effectiveRouteMode, options);
      const routeEnv = buildRouteEnv(effectiveRouteMode, env);
      const timedRouteOptions = { ...routeOptions, timingContext };
      logFeishuTiming(routeEnv, timingContext, 'received', {
        mode: effectiveRouteMode,
        event_type: extractFeishuEventType(payload) || 'unknown',
      });
      if (payload?.challenge) {
        const result = await handleFeishuWebhook(
          payload,
          routeEnv,
          timedRouteOptions.dispatch || dispatchWorkflow,
          timedRouteOptions.parser,
          timedRouteOptions.scheduler,
          timedRouteOptions.hermesParser,
          timedRouteOptions.parserSource,
          timedRouteOptions.fallbackParserSource,
          timingContext,
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
        runWebhookInBackground(payload, routeEnv, timedRouteOptions);
        sendJson(response, 200, {
          ok: true,
          message: '飞书指令已收到，正在后台触发 UI 自动化测试',
        });
        return;
      }

      const text = extractFeishuText(payload);
      const route = await resolveAgentRoute(text, routeEnv, { ...timedRouteOptions, payload });
      logFeishuTiming(routeEnv, timingContext, 'route', {
        agent: route.agent,
        action: route.action,
        source: route.intentSource || 'rules',
        requires_auth: route.requiresAuth,
      });
      if (shouldIgnorePassiveGroupMessage(payload, text, routeEnv, route)) {
        console.log('Ignored passive Feishu group message.');
        logFeishuTiming(routeEnv, timingContext, 'finish', { outcome: 'ignored_passive_group' });
        sendJson(response, 200, {
          ok: true,
          ignored: true,
          message: '被动群聊消息已忽略',
        });
        return;
      }

      const routed = await buildRoutedAgentReply(payload, routeEnv, timedRouteOptions, route);
      if (routed.handled) {
        logFeishuTiming(routeEnv, timingContext, 'finish', { outcome: 'routed_agent_sync' });
        sendJson(response, 200, {
          ok: true,
          message: routed.replyText || '消息已处理',
        });
        return;
      }

      const result = await handleFeishuWebhook(
        payload,
        routeEnv,
        timedRouteOptions.dispatch || dispatchWorkflow,
        timedRouteOptions.parser,
        timedRouteOptions.scheduler,
        timedRouteOptions.hermesParser,
        timedRouteOptions.parserSource,
        timedRouteOptions.fallbackParserSource,
        timingContext,
      );
      logFeishuTiming(routeEnv, timingContext, 'finish', { outcome: 'ui_test_sync' });
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
    console.log('WeChat MP path: GET/POST /webhook/wechat/mp');
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildEmailRunResultMessage,
  buildEmailRunResultSubject,
  buildRoutedChatReply,
  buildUiMailboxMessages,
  resolveClawEmailSenderForAction,
  buildFeishuDashboardCard,
  buildFeishuResultCard,
  buildRoutedAgentReply,
  buildRunArtifactsUrl,
  getDailySummarySnapshotFile,
  readDailySummarySnapshot,
  writeDailySummarySnapshot,
  appendDailySummaryRunSnapshot,
  getDailySummaryStateFile,
  readDailySummaryState,
  writeDailySummaryState,
  appendDailySummaryRun,
  buildFeishuCardMessage,
  buildWechatMpTextReplyXml,
  buildFeishuTextMessage,
  buildRouteOptions,
  buildRouteEnv,
  buildWechatMpRouteEnv,
  createServer,
  downloadFeishuMessageImage,
  extractFeishuText,
  extractFeishuImageKeys,
  getFeishuDedupKeys,
  getFeishuRouteMode,
  getWechatMpConfig,
  handleDashboardRequest,
  handleFeishuWebhook,
  handleWechatMpWebhook,
  isDuplicateFeishuEvent,
  isWechatMpBindCommand,
  notifyFeishuRunResult,
  parseWechatMpXml,
  resolveAgentRoute,
  verifyWechatMpSignature,
  scheduleFeishuResultNotification,
  parseOpenClawChatOutput,
  parseSmallTalkMessage,
  parseRunUiTestCommand,
  parseOpenClawCommandOutput,
  notifyUiMailboxActions,
  runHermesChat,
  runHermesParser,
  runOpenClawChat,
  runLocalOpsAction,
  runWebhookInBackground,
  runOpenClawParser,
  sendDailySummaryNotification,
  sendMailboxActionEmail,
  sendFeishuMessageUpdate,
  sendEmailRunResultNotification,
  rememberFeishuImage,
  recallFeishuImage,
  uploadFeishuImage,
  sendFeishuTextMessage,
  shouldNotifyEmail,
};
