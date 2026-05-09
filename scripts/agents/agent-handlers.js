const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildAgentEvalTasks,
  buildCustomerServiceCases,
  buildEmailPlaybook,
  buildUiAutomationMatrix,
} = require('../qa-assets');
const {
  buildMemoryContext,
  buildMemorySearchContext,
  isSafeMemoryText,
  rememberMemoryNote,
} = require('./memory-store');
const {
  listCapabilities,
} = require('./capability-registry');
const {
  runGBrainSearch,
} = require('./gbrain-client');
const {
  getUsageLedgerPath,
  readUsageLedgerEntries,
} = require('../usage-ledger');
const {
  buildMailLedgerSummaryReply,
  filterMailLedgerEntriesForDay,
  readMailLedgerEntries,
} = require('../mail-ledger');
const {
  buildMailWorkbenchReportFromEnv,
  formatMailWorkbenchReply,
} = require('../mail-workbench');
const {
  applyMailApprovalAction,
  buildApprovalQueueFromMessages,
  getMailApprovalQueueFile,
  writeMailApprovalQueue,
} = require('../mail-approval-queue');
const {
  resolveMailboxAction,
} = require('../mailbox-action-router');
const {
  buildFileChannelNotice,
  listRecentFiles,
} = require('../file-channel');
const {
  buildDailySummary,
} = require('../daily-summary');
const {
  buildEcosystemStatusReply,
  createEcosystemInstallPlan,
  readEcosystemState,
} = require('../ecosystem-manager');
const {
  buildRegistrationPlan,
  parseRegistrationTaskRequest,
} = require('../browser-registration-runner');
const {
  runBrowserAutomationTask,
} = require('../browser-cdp-executor');
const {
  buildIntentDiagnosis,
} = require('./intent-diagnoser');
const {
  buildProtocolAssetReport,
  buildProtocolTestCases,
  listProtocolAssets,
} = require('../protocol-asset-store');
const {
  listFailedTasks,
  listTodayTasks,
  summarizeTaskCenterBrain,
  summarizeDailyPlan,
  summarizeDailyPipeline,
  summarizeTasks,
} = require('../task-center');
const {
  readDailySummarySnapshot,
} = require('../daily-summary-snapshot');
const {
  publishWechatMpArticle,
} = require('../wechat-mp-publisher');

const OPS_SECRET_PATTERNS = [
  /\bauthorization\s*:\s*\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i,
];

const ALLOWED_OPS_ACTIONS = new Set([
  'status',
  'health',
  'watchdog',
  'logs',
  'restart',
  'repair',
  'exec',
  'memory-summary',
  'disk-summary',
  'disk-audit',
  'cleanup-confirm',
  'load-summary',
  'peer-status',
  'peer-health',
  'peer-logs',
  'peer-restart',
  'peer-repair',
  'peer-exec',
  'peer-memory-summary',
  'peer-disk-summary',
  'peer-load-summary',
  'clarify',
]);

const DANGEROUS_OPS_ACTIONS = new Set(['restart', 'repair', 'peer-restart', 'peer-repair']);

function trimForReply(value, limit = 1200) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isSafeOpsText(value) {
  const text = String(value ?? '');
  return isSafeMemoryText(text) && !OPS_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeReplyField(value, limit = 500) {
  if (!isSafeOpsText(value)) {
    return '[redacted secret-like output]';
  }
  return trimForReply(value, limit);
}

function buildDocAgentReply(text, memoryContext = buildMemoryContext()) {
  return [
    '已完成的主线能力：',
    '- 飞书 OpenClaw/Hermes 机器人接入',
    '- GitHub Actions UI 自动化触发',
    '- Allure/GitHub Actions 报告回传',
    '- 双服务器拆分、watchdog、去重、OpenClaw CLI 串行队列',
    '',
    '我当前参考的记忆摘要：',
    trimForReply(memoryContext, 700),
  ].join('\n');
}

function buildCapabilityGuideReply(assistantName = 'OpenClaw') {
  const capabilities = listCapabilities();
  return [
    `${assistantName} 大神版玩法菜单：你不用背命令，按目标直接说。`,
    '',
    '1) 日常体检（低风险，随问随回）：',
    '- 看我自己：你现在内存多少 / 你硬盘还剩多少 / 你现在卡不卡',
    '- 看对方：看看 Hermes 的服务器状态 / OpenClaw 硬盘还剩多少',
    '- 硬盘清理：看看哪些东西占硬盘 / khoj 可以清理吗（先盘点再确认）',
    '',
    '2) UI 自动化（触发 + 复盘）：',
    '- 帮我跑一下 main 分支的 UI 自动化冒烟测试',
    '- 把这次 Allure 报告整理成一句话',
    '- 整理一下 UI 自动化测试矩阵',
    '',
    '3) 邮箱/日报（文员流）：',
    '- 文员，发送今天日报到邮箱',
    '- 邮箱平台可以怎么玩',
    '- 文员，今天邮箱里有哪些任务',
    '- 默认不会自动发信，要你明确说“发送”才会执行',
    '',
    '4) token 工厂（训练流水线）：',
    '- 文员，今天按 token-factory 跑一轮',
    '- 文员，启动高 token 训练场',
    '- 文员，启动多 Agent 训练场',
    '',
    '5) 知识库（记忆沉淀）：',
    '- 把这段经验沉淀到知识库：UI 自动化失败先看 Allure',
    '- 问脑库 UI 自动化报告怎么发邮箱',
    '- Obsidian 存储和 GBrain 工作流怎么结合',
    '',
    '6) 互修（高风险动作，需明确指令）：',
    '- 修复 Hermes / 修复 OpenClaw / 重启你自己',
    '- 模糊说法不会执行，会先让你确认',
    '',
    '7) 测试资产（可复用产物）：',
    '- 帮我生成一批电商客服训练数据',
    '- 帮我做一轮 OpenClaw 和 Hermes 的能力评测',
    '- 把报告和截图走文件通道：文员，把失败样本归档到 files',
    '- 请根据需求文档生成测试用例',
    '- 帮我分析这个缺陷原因',
    '- Dify 工作流问答：回归测试策略怎么设计',
    '',
    '补充能力：',
    '- 画一张商品主图：生成一张图片：极简科技风商品主图',
    '- 修一张图：把刚才那张旧照片修复清晰',
    '- 微信 Bridge 计划：帮我整理微信 Bridge 的第一版入口',
    '',
    `已注册能力：${capabilities.map((capability) => capability.name).join('、')}`,
  ].join('\n');
}

function buildBrainGuideReply(assistantName = 'OpenClaw') {
  return [
    `${assistantName} 的长期记忆建议这样搭：`,
    '',
    'Obsidian：给你自己看的项目笔记库，适合放服务器接手手册、测试经验、邮箱规划、模型对比。',
    'GBrain：给 Agent 用的“脑库层”，后面接 MCP/技能后，可以把 Markdown、检索、知识图谱和定时任务接进 OpenClaw/Hermes。',
    '',
    '推荐分工：',
    '- OpenClaw：保留讯飞 CodingPlan，做稳定对照和 UI 自动化入口',
    '- Hermes：继续用 LongCat，做自然语言总控、资料生成、评测和知识整理',
    '- Obsidian/GBrain：沉淀长期记忆，不直接保存密钥',
    '',
    '你可以直接说：把这段经验沉淀到知识库：xxx',
  ].join('\n');
}

function buildEcosystemAgentReply(route = {}, options = {}) {
  const target = route.target === 'hermes'
    ? 'Hermes'
    : route.target === 'openclaw'
      ? 'OpenClaw'
      : (options.assistantName || '当前机器人');
  const env = options.env || process.env;
  const state = (options.readState || readEcosystemState)(env.ECOSYSTEM_STATE_FILE) || {};
  const plan = createEcosystemInstallPlan({ target: route.target || 'self' });
  const baseState = {
    target,
    installed: state.installed || [],
    skipped: state.skipped || plan.plugins
      .filter((plugin) => !plan.autoInstallIds.includes(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        reason: `${plugin.installMode}：${plugin.notes}`,
      })),
  };

  if (route.action === 'install-safe') {
    return [
      `${target} 生态技能安装策略已就绪。`,
      '',
      buildEcosystemStatusReply(baseState),
      '',
      '会自动落地的：GBrain 旁路脑库、项目文档/记忆/QA 资产同步、生态状态文件。',
      '先登记不强装的：G Stack 概念、Hermes WebUI 候选、awesome 目录、自进化实验项目。',
      '服务器侧会用 ecosystem-manager 执行可信项安装，并用 systemd timer 做自检巡检。',
    ].join('\n');
  }

  if (route.action === 'enable-maintenance') {
    return [
      `${target} 后台自检方案：`,
      '- 每天检查 GBrain/生态状态、桥服务健康、token worker、watchdog。',
      '- 发现缺插件时先写候选建议，不直接跑陌生安装脚本。',
      '- 记忆自我净化只整理重复、过期、非敏感经验，不保存密钥。',
      '',
      buildEcosystemStatusReply(baseState),
    ].join('\n');
  }

  return buildEcosystemStatusReply(baseState);
}

function buildPlannerClarifyReply(text = '') {
  return [
    '我可以继续，但这个需求有点大，我先帮你拆成可执行方向。',
    '',
    '你可以直接说其中一种：',
    '- 升级自然语言：让 OpenClaw/Hermes 更会聊天、更会判断任务',
    '- 优化服务器：看硬盘、内存、日志、重启和互修',
    '- 强化 UI 自动化：补用例、跑 GitHub Actions、整理 Allure 报告',
    '- 建知识库：把经验写进 Obsidian/GBrain 风格的长期记忆',
    '- 生成 QA 数据：电商客服训练数据、Agent 评测题、邮箱测试玩法',
    '',
    `我刚收到的是：${trimForReply(text, 120)}`,
  ].join('\n');
}

function buildMultiIntentPlanReply(route = {}) {
  const plan = route.plan || {};
  const intents = Array.isArray(plan.intents) ? plan.intents : [];
  const lines = [
    '多意图计划：我识别到你这句话里有多个低风险任务，会按顺序拆开处理。',
    `- 置信度：${plan.confidence || route.confidence || 'medium'}`,
  ];

  if (intents.length) {
    lines.push('', '执行顺序：');
    intents.forEach((intent, index) => {
      lines.push(`${index + 1}. ${intent.agent || 'unknown'} / ${intent.action || 'unknown'}：${sanitizeReplyField(intent.reason || '待处理')}`);
    });
  }

  if (Array.isArray(plan.blocked) && plan.blocked.length) {
    lines.push('', `已拦截：${plan.blocked.map((item) => sanitizeReplyField(item)).join('、')}`);
  }

  lines.push('', '高风险操作不会混在多意图里执行；重启、修复、清理、shell 命令都需要你单独明确确认。');
  return lines.join('\n');
}

function formatClueCard(diagnosis = {}, fallback = {}) {
  const card = diagnosis.clueCard || {};
  const target = card.targetUrl || fallback.target || '未提供 URL';
  const signals = Array.isArray(card.matchedSignals) && card.matchedSignals.length
    ? card.matchedSignals.join('、')
    : '未命中特定信号';
  const evidence = card.evidence || {};
  const evidenceText = [
    evidence.urlHost ? `host=${sanitizeReplyField(evidence.urlHost, 120)}` : null,
    evidence.assetCount !== undefined ? `资产=${evidence.assetCount}` : null,
    evidence.caseCount !== undefined ? `用例=${evidence.caseCount}` : null,
    evidence.networkCount !== undefined ? `接口=${evidence.networkCount}` : null,
    evidence.consoleCount !== undefined ? `console=${evidence.consoleCount}` : null,
  ].filter(Boolean).join('，') || '等待执行后补证据';
  return [
    '线索定位：',
    `定位结果：${sanitizeReplyField(diagnosis.intentLabel || '浏览器/CDP 页面定位', 120)}`,
    `- 目标：${sanitizeReplyField(target, 300)}`,
    `- 执行方式：${sanitizeReplyField(card.executionMode || fallback.executionMode || '浏览器/CDP 分析', 120)}`,
    `当前状态：${sanitizeReplyField(card.status || fallback.status || '待执行', 80)}${card.reasonCode ? `（${sanitizeReplyField(card.reasonCode, 80)}）` : ''}`,
    `证据：${evidenceText}`,
    `- 命中依据：${signals}`,
    `下一步建议：${sanitizeReplyField(card.nextStep || diagnosis.nextStep || fallback.nextStep || '给出目标 URL 后执行截图、console 和接口抓包。', 300)}`,
    `可直接回复：${sanitizeReplyField(card.suggestedReply || fallback.suggestedReply || '真实执行 <你的URL> 并截图抓接口', 300)}`,
  ].join('\n');
}

function formatCountMap(map = {}, limit = 6) {
  return Object.entries(map || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, count]) => `${key}=${count}`)
    .join('、');
}

function formatProtocolAssetReportLines(report = {}) {
  const lines = [];
  const byHost = formatCountMap(report.byHost);
  const byStatus = formatCountMap(report.byStatusClass);
  const byMethod = formatCountMap(report.byMethod);
  if (byHost) {
    lines.push(`- 按域名：${byHost}`);
  }
  if (byStatus) {
    lines.push(`- 按状态：${byStatus}`);
  }
  if (byMethod) {
    lines.push(`- 按方法：${byMethod}`);
  }
  if (Array.isArray(report.abnormal) && report.abnormal.length) {
    lines.push('', '异常优先排查：');
    report.abnormal.slice(0, 5).forEach((item, index) => {
      const host = item.host ? `${item.host}` : '';
      lines.push(`${index + 1}. ${item.method || 'GET'} ${host}${item.path || '/'} ${item.status || '-'}`);
    });
  }
  if (Array.isArray(report.nextActions) && report.nextActions.length) {
    lines.push('', '建议动作：');
    report.nextActions.slice(0, 4).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }
  return lines;
}

async function buildBrowserAgentReply(route = {}, options = {}) {
  const rawText = route.rawText || options.text || '';
  const baseDiagnosis = buildIntentDiagnosis(rawText, route);
  if (route.action === 'protocol-assets-to-tests') {
    const builder = options.protocolTestCaseBuilder || ((request = {}) => buildProtocolTestCases(
      { text: request.query || '' },
      { env: request.env || process.env },
    ));
    const result = await builder({
      query: route.rawText || options.text || '',
      env: options.env || process.env,
    });
    const cases = Array.isArray(result?.cases) ? result.cases : [];
    const diagnosis = {
      ...baseDiagnosis,
      clueCard: {
        ...(baseDiagnosis.clueCard || {}),
        status: cases.length ? 'ok' : 'empty',
        reasonCode: cases.length ? 'protocol_cases_ready' : 'no_assets',
        evidence: {
          ...(baseDiagnosis.clueCard?.evidence || {}),
          assetCount: Number(result?.totalAssets || 0),
          caseCount: cases.length,
        },
        nextStep: cases.length
          ? '优先把这些用例接到 UI 自动化或接口契约测试里。'
          : '先说“真实执行 + URL + 抓接口”，生成协议资产后再转测试用例。',
        suggestedReply: cases.length
          ? '把这些协议测试用例接到 UI 自动化'
          : '真实执行 https://evanshine.me 并截图抓接口',
      },
    };
    const preview = cases.slice(0, 5).map((item, index) => {
      const method = sanitizeReplyField(item.method || 'GET', 20);
      const path = sanitizeReplyField(item.path || '/', 120);
      const status = sanitizeReplyField(item.expectedStatus || '-', 20);
      const source = item.sourceAssetId ? ` 来源 ${sanitizeReplyField(item.sourceAssetId, 80)}` : '';
      return `${index + 1}. ${method} ${path} -> ${status}${source}`;
    });
    return [
      formatClueCard(diagnosis, { executionMode: '协议资产转测试用例' }),
      '',
      '协议资产已整理成测试用例：',
      `- 共生成 ${cases.length} 条，来源资产 ${Number(result?.totalAssets || cases.length)} 条`,
      ...(result?.savedFile ? [`- 保存：${sanitizeReplyField(result.savedFile, 240)}`] : []),
      ...(preview.length ? ['', ...preview] : ['', '暂无可用协议资产。先说：真实执行 URL 并抓接口']),
    ].join('\n');
  }

  if (route.action === 'protocol-assets-report') {
    const reporter = options.protocolAssetReporter || ((request = {}) => {
      const query = String(request.query || '').toLowerCase();
      const reportQuery = query.includes('登录') ? { text: 'login 登录' } : {};
      const report = buildProtocolAssetReport(reportQuery, { env: request.env || process.env });
      const assets = query.includes('登录')
        ? listProtocolAssets({ env: request.env || process.env })
          .filter((item) => /login|登录/i.test(String(item.summary?.normalizedPath || item.url || item.summaryText || '')))
        : listProtocolAssets({ env: request.env || process.env });
      const top = assets.slice(0, 8);
      return {
        summary: `最近协议资产 ${report.total} 条`,
        report,
        lines: top.map((item, index) => {
          const method = item.summary?.method || item.method || 'GET';
          const host = item.summary?.host ? `${item.summary.host}` : '';
          const path = item.summary?.normalizedPath || item.url || '/';
          const status = item.summary?.status || item.status || '-';
          return `${index + 1}. ${method} ${host}${path} ${status}`;
        }),
      };
    });
    const report = await reporter({
      query: route.rawText || options.text || '',
      env: options.env || process.env,
    });
    const summary = sanitizeReplyField(report?.summary || '协议资产库暂时为空');
    const lines = Array.isArray(report?.lines) ? report.lines : [];
    const structuredReport = report?.report || null;
    const structuredLines = structuredReport ? formatProtocolAssetReportLines(structuredReport) : [];
    const diagnosis = {
      ...baseDiagnosis,
      clueCard: {
        ...(baseDiagnosis.clueCard || {}),
        status: lines.length ? 'ok' : 'empty',
        reasonCode: lines.length ? 'protocol_assets_found' : 'no_assets',
        evidence: {
          ...(baseDiagnosis.clueCard?.evidence || {}),
          assetCount: lines.length,
        },
        nextStep: lines.length
          ? '先看状态码异常、登录/验证码相关接口，再决定是否转成测试用例。'
          : '先说“真实执行 + URL + 抓接口”，让浏览器/CDP 写入协议资产。',
        suggestedReply: lines.length
          ? '把最近抓到的接口整理成测试用例'
          : '真实执行 https://evanshine.me 并截图抓接口',
      },
    };
    return [
      formatClueCard(diagnosis, { executionMode: '协议资产检索' }),
      '',
      '协议资产报告：',
      `- 概览：${summary}`,
      ...(structuredLines.length ? ['', ...structuredLines.map((line) => sanitizeReplyField(line, 800))] : []),
      ...(lines.length ? ['', ...lines.map((line) => sanitizeReplyField(line, 800))] : []),
    ].join('\n');
  }

  const runner = options.browserAutomationRunner || runBrowserAutomationTask;
  const dryRun = route.action === 'browser-live-run' ? false : route.dryRun !== false;
  const result = await runner({
    text: rawText,
    dryRun,
    env: options.env || process.env,
    browserFactory: options.browserFactory,
    playwrightAdapter: options.playwrightAdapter,
    protocolAssetSaver: options.protocolAssetSaver,
    screenshotPath: options.screenshotPath,
  });
  const plan = result.plan || {};
  const artifacts = result.artifacts || {};
  const savedAssets = Array.isArray(artifacts.savedProtocolAssets) ? artifacts.savedProtocolAssets : [];
  const protocolAssets = Array.isArray(artifacts.protocolAssets) ? artifacts.protocolAssets : result.networkAssets || [];
  const diagnosis = {
    ...baseDiagnosis,
    clueCard: {
      ...(baseDiagnosis.clueCard || {}),
      targetUrl: plan.url || result.request?.url || baseDiagnosis.clueCard?.targetUrl || '',
      status: plan.blocked || result.mode === 'blocked' ? 'blocked' : (result.mode === 'live' || result.executed ? 'ok' : 'planned'),
      reasonCode: plan.blocked || result.mode === 'blocked' ? 'allowlist_or_policy_blocked' : (result.mode || 'dry-run'),
      reasonText: result.reason || plan.reason || baseDiagnosis.reason,
      evidence: {
        ...(baseDiagnosis.clueCard?.evidence || {}),
        networkCount: protocolAssets.length,
        consoleCount: Array.isArray(result.consoleMessages) ? result.consoleMessages.length : 0,
        assetCount: savedAssets.length,
      },
      nextStep: plan.blocked || result.mode === 'blocked'
        ? '确认这是你的自有域名或学校 CTF 靶场地址后，把域名加入白名单；不要对京东/拼多多真实站点做自动化。'
        : (result.mode === 'live' || result.executed)
          ? '优先看 console 错误、失败接口和已入库协议资产，再转测试用例。'
          : '确认计划后说“真实执行 + URL + 截图/抓接口”。',
      suggestedReply: plan.blocked || result.mode === 'blocked'
        ? '这是我的自有域名/学校靶场，允许加入白名单：<域名>'
        : (result.mode === 'live' || result.executed)
          ? '最近抓到哪些接口'
          : `真实执行 ${plan.url || result.request?.url || '<你的URL>'} 并截图抓接口`,
    },
  };
  const lines = [
    formatClueCard(diagnosis, {
      target: plan.url || result.request?.url,
      executionMode: dryRun ? 'dry-run 计划' : '真实浏览器/CDP 执行',
    }),
    '',
    '浏览器自动化计划：',
    `- 模式：${result.mode || 'dry-run'}`,
    `- 目标：${plan.url || result.request?.url || '未提供 URL，会先做页面检查计划'}`,
  ];

  if (plan.blocked || result.mode === 'blocked') {
    lines.push(`- 状态：已拦截`);
    lines.push(`- 原因：${sanitizeReplyField(result.reason || plan.reason || '目标不在允许列表')}`);
    return lines.join('\n');
  }

  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (steps.length) {
    lines.push('', '步骤：');
    steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${sanitizeReplyField(step.type || 'step')} - ${sanitizeReplyField(step.detail || step.url || '')}`);
    });
  }

  if (result.mode === 'live' || result.executed) {
    lines.push('', '执行结果：');
    lines.push(`- Console：${Array.isArray(result.consoleMessages) ? result.consoleMessages.length : 0}`);
    lines.push(`- 抓到接口：${protocolAssets.length}`);
    lines.push(`- 接口入库：${savedAssets.length}`);
    if (artifacts.screenshotPath) {
      lines.push(`- 截图：${sanitizeReplyField(artifacts.screenshotPath, 800)}`);
    }
    if (savedAssets.length) {
      lines.push(`- 资产：${savedAssets.map((asset) => sanitizeReplyField(asset.id || asset.file || asset.path || 'saved', 200)).join('、')}`);
    }
    return lines.join('\n');
  }

  lines.push('', '当前先以 dry-run 生成可执行计划；接下来接 Playwright/CDP 后，会把 console、network/HAR、截图和失败点写入协议资产库。');
  return lines.join('\n');
}

function defaultReadUsageLedger(env = process.env, limit = 200) {
  return readUsageLedgerEntries(env, limit);
}

function defaultReadMailLedger(env = process.env, limit = 80) {
  return readMailLedgerEntries(env, limit);
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

function getTrendIntelReportPath(env = process.env) {
  return env.TREND_INTEL_OUTPUT_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'trend-intel', 'latest.json');
}

function defaultReadTrendIntelReport(env = process.env) {
  return readJsonFileSafe(getTrendIntelReportPath(env));
}

function loadDailySummaryArtifacts(env = process.env, options = {}) {
  const readUsage = options.readUsageLedger || defaultReadUsageLedger;
  const usageEntries = readUsage(env);
  const snapshotReader = options.readDailySummarySnapshot || readDailySummarySnapshot;
  let snapshot = null;
  try {
    snapshot = typeof snapshotReader === 'function' ? snapshotReader(env) : null;
  } catch {
    snapshot = null;
  }
  const multiAgentSummary = (options.readJsonFile || readJsonFileSafe)(
    join(env.MULTI_AGENT_LAB_OUTPUT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'multi-agent-lab'), 'summary.json'),
  );

  return {
    runs: Array.isArray(snapshot?.runs) ? snapshot.runs : [],
    usageEntries,
    multiAgentSummary,
  };
}

function summarizeUsageLedger(entries = []) {
  const summary = new Map();
  for (const entry of entries) {
    const assistant = String(entry.assistant || 'unknown');
    const model = String(entry.model || 'unknown');
    const key = `${assistant} / ${model}`;
    const current = summary.get(key) || {
      assistant,
      model,
      calls: 0,
      totalTokens: 0,
      tokenCalls: 0,
      estimatedTotalTokens: 0,
      estimatedTokenCalls: 0,
      usageMissingCalls: 0,
      modelElapsedMs: 0,
    };
    current.calls += 1;
    if (entry.totalTokens !== undefined && entry.totalTokens !== null) {
      current.totalTokens += Number(entry.totalTokens || 0);
      current.tokenCalls += 1;
    }
    if (entry.usageMissing || entry.totalTokens === undefined || entry.totalTokens === null) {
      current.usageMissingCalls += 1;
    }
    if (entry.estimatedTotalTokens !== undefined && entry.estimatedTotalTokens !== null) {
      current.estimatedTotalTokens += Number(entry.estimatedTotalTokens || 0);
      current.estimatedTokenCalls += 1;
    }
    current.modelElapsedMs += Number(entry.modelElapsedMs || 0);
    summary.set(key, current);
  }

  return Array.from(summary.values())
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

function toLocalUsageDayKey(input, timezoneOffsetMinutes = 480) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() + Number(timezoneOffsetMinutes || 0) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function getRelativeUsageDayKey(now = new Date(), dayOffset = 0, timezoneOffsetMinutes = 480) {
  const shifted = new Date(now.getTime() + Number(timezoneOffsetMinutes || 0) * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  return shifted.toISOString().slice(0, 10);
}

function filterUsageLedgerByRange(entries = [], route = {}, options = {}) {
  const dayRange = route.dayRange || route.range || '';
  if (!['today', 'yesterday'].includes(dayRange)) {
    return entries;
  }

  const env = options.env || process.env;
  const timezoneOffsetMinutes = Number(env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES || env.USAGE_LEDGER_TIMEZONE_OFFSET_MINUTES || 480);
  const targetDay = getRelativeUsageDayKey(options.now || new Date(), dayRange === 'yesterday' ? -1 : 0, timezoneOffsetMinutes);
  return entries.filter((entry) => {
    const timestamp = entry.timestamp || entry.createdAt || entry.time;
    return timestamp && toLocalUsageDayKey(timestamp, timezoneOffsetMinutes) === targetDay;
  });
}

function describeUsageRange(route = {}) {
  if (route.dayRange === 'today') return '今天';
  if (route.dayRange === 'yesterday') return '昨天';
  return '最近';
}

function buildTokenSummaryReply(entries = [], options = {}) {
  const route = options.route || {};
  const filteredEntries = filterUsageLedgerByRange(entries, route, options);
  const rangeLabel = describeUsageRange(route);

  if (!filteredEntries.length) {
    return [
      `文员统计：${route.dayRange ? `${rangeLabel}没有可用的 token/耗时账本记录。` : '现在还没有可用的 token/耗时账本记录。'}`,
      '你先和 Hermes/OpenClaw 普通聊几句，之后我就能对比谁更费 token、谁更慢。',
    ].join('\n');
  }

  const rows = summarizeUsageLedger(filteredEntries);
  const lines = [
    `文员统计：${rangeLabel} ${filteredEntries.length} 次普通聊天用量如下。`,
  ];

  rows.forEach((row, index) => {
    const avgTokens = row.tokenCalls ? Math.round(row.totalTokens / row.tokenCalls) : 0;
    const avgMs = row.calls ? Math.round(row.modelElapsedMs / row.calls) : 0;
    const tokenText = row.tokenCalls
      ? `${row.totalTokens} tokens，平均 ${avgTokens} tokens/次`
      : row.estimatedTokenCalls
        ? `未返回 token，字符估算约 ${row.estimatedTotalTokens} tokens`
        : '未返回 token';
    const missingText = row.usageMissingCalls && row.tokenCalls
      ? `，${row.usageMissingCalls} 次未返回 token`
      : '';
    lines.push(`${index + 1}. ${row.assistant} / ${row.model}：${row.calls} 次，${tokenText}${missingText}，模型平均耗时 ${avgMs}ms`);
  });

  const top = rows[0];
  const tokenRows = rows.filter((row) => row.tokenCalls > 0);
  if (tokenRows.length) {
    const tokenTop = tokenRows.sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)[0];
    lines.push(`目前样本里 token 用量最高的是：${tokenTop.assistant} / ${tokenTop.model}。`);
  } else if (top) {
    lines.push('这些记录的模型接口未返回 token，已用字符数做粗略估算；精确计费仍以平台后台为准。');
  }
  return lines.join('\n');
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

function buildClerkFileChannelReply(env = process.env, options = {}) {
  const files = (options.listFiles || listRecentFiles)({ limit: 5 }, env);
  const root = env.FILE_CHANNEL_ROOT || 'data/file-channel';
  const lines = [
    '文件通道工作台：',
    `- 根目录：${root}`,
    '- 用途：收 UI 自动化报告、失败截图、trace、训练样本、微信 Bridge 转来的附件。',
    '- 文字消息仍走飞书/OpenClaw；文件只登记安全路径，再通知我读取。',
    '',
    '可以这样说：',
    '- 文员，最近文件通道收到哪些文件',
    '- 文员，把失败截图归档到 files',
    '- 文员，帮我整理文件通道里的最新报告',
  ];

  if (!files.length) {
    lines.push('', '最近文件：暂无登记。');
    return lines.join('\n');
  }

  lines.push('', '最近文件：');
  files.forEach((file, index) => {
    lines.push(`${index + 1}. ${file.name || file.id} - ${file.relativePath || 'unknown'} (${file.source || 'unknown'})`);
  });
  return lines.join('\n');
}

function buildClerkRecentFilesReply(env = process.env, options = {}) {
  const files = (options.listFiles || listRecentFiles)({ limit: 8 }, env);
  if (!files.length) {
    return [
      '文件通道最近还没有登记文件。',
      '后续微信 Bridge 或外部上传器把文件保存到 FILE_CHANNEL_ROOT 后，会在这里出现。',
    ].join('\n');
  }

  return [
    '文件通道最近文件：',
    ...files.map((file, index) => `${index + 1}. ${buildFileChannelNotice(file).replace(/\n/g, '\n   ')}`),
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

function buildTaskCenterBrainReply(options = {}) {
  const warnings = [];
  let brain = {};
  try {
    const result = (options.summarizeTaskCenterBrain || summarizeTaskCenterBrain)({
      env: options.env || process.env,
      now: options.now || new Date(),
    });
    brain = result && typeof result === 'object' ? result : {};
  } catch {
    warnings.push('task_center_brain_unavailable');
    brain = {};
  }
  let pipeline = {};
  try {
    const result = (options.summarizeDailyPipeline || summarizeDailyPipeline)({
      env: options.env || process.env,
      now: options.now || new Date(),
      type: 'daily-pipeline',
    });
    pipeline = result && typeof result === 'object' ? result : {};
  } catch {
    warnings.push('daily_pipeline_unavailable');
    pipeline = {};
  }
  const today = brain.today || {};
  const history = brain.history || {};
  const failureReview = brain.failureReview || {};
  const nextPlan = brain.nextPlan || {};
  const failureItems = Array.isArray(failureReview.items) ? failureReview.items : [];
  const nextItems = Array.isArray(nextPlan.items) ? nextPlan.items : [];
  const quickCommands = Array.isArray(nextPlan.quickCommands) ? nextPlan.quickCommands : [];
  const pipelineParts = [];
  if (pipeline.day) pipelineParts.push(pipeline.day);
  if (pipeline.totalStages) pipelineParts.push(`${Number(pipeline.completedStages || 0)}/${Number(pipeline.totalStages || 0)} 阶段完成`);
  if (pipeline.failedStages) pipelineParts.push(`失败 ${pipeline.failedStages}`);
  const lines = [
    '任务中枢主控脑：',
    `- 今日：${today.summaryText || '暂无'}`,
    `- 历史：${history.summaryText || '暂无历史摘要'}`,
    `- 失败复盘：${failureReview.summaryText || '暂无失败任务'}`,
    '当前卡点：',
    ...(failureItems.length
      ? failureItems.slice(0, 5).map((item) => `- ${sanitizeReplyField(`${item.id || 'unknown'} ${item.type || ''}${item.error ? `：${item.error}` : ''}`, 260)}`)
      : ['- 暂无明确卡点。']),
    '运行信号：',
    `- 每日流水线：${pipelineParts.join('，') || '暂无运行记录'}`,
    ...(pipeline.nextAction ? [`- 下一步：${sanitizeReplyField(pipeline.nextAction, 300)}`] : []),
    '下一步计划：',
    ...(nextItems.length ? nextItems.slice(0, 5).map((item) => `- ${sanitizeReplyField(item, 260)}`) : ['- 先查看任务中枢，再按失败项、UI 自动化、日报归档推进。']),
    '快捷指令：',
    ...(quickCommands.length ? quickCommands.slice(0, 5).map((item) => `- ${sanitizeReplyField(item, 180)}`) : [
      '- 文员，查看失败任务',
      '- 文员，启动今天的自动流水线',
    ]),
    ...(warnings.length ? [`降级提示：${warnings.join('、')}`] : []),
  ];
  return lines.join('\n');
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

function buildTaskCenterTodayReply(options = {}) {
  const env = options.env || process.env;
  const tasks = (options.listTodayTasks || listTodayTasks)({
    env,
    now: options.now || new Date(),
    type: 'token-factory',
  });
  if (!tasks.length) {
    return [
      '任务中枢（今天）：当前还没有 token-factory 任务。',
      '你可以说：文员，今天按 token-factory 跑一轮。',
    ].join('\n');
  }
  const lines = ['任务中枢（今天 token-factory）：'];
  tasks.slice(0, 8).forEach((task, index) => {
    lines.push(`${index + 1}. ${task.id} | ${task.status} | ${task.updatedAt || task.createdAt || 'unknown'}`);
  });
  return lines.join('\n');
}

function buildTaskCenterFailedReply(options = {}) {
  const env = options.env || process.env;
  const tasks = (options.listFailedTasks || listFailedTasks)({ env, limit: 8 });
  if (!tasks.length) {
    return '任务中枢：当前没有失败任务。';
  }
  return [
    '任务中枢（失败任务）：',
    ...tasks.map((task, index) => `${index + 1}. ${task.id} | ${task.updatedAt || task.createdAt || 'unknown'}${task.error ? ` | ${task.error}` : ''}`),
  ].join('\n');
}

function buildTaskCenterContinueYesterdayReply(options = {}) {
  const env = options.env || process.env;
  const summary = (options.summarizeTasks || summarizeTasks)({
    env,
    now: options.now || new Date(),
    type: 'token-factory',
  });
  const recoverable = Number(summary?.counts?.recoverable || 0);
  const failed = Number(summary?.counts?.failed || 0);
  const latest = summary?.latest || null;
  return [
    '任务中枢（继续昨天任务建议）：',
    `- 可恢复任务：${recoverable}`,
    `- 失败任务：${failed}`,
    latest ? `- 最新任务：${latest.id}（${latest.status}）` : '- 最新任务：暂无',
    recoverable
      ? '- 建议：可直接触发 token-factory-worker 的恢复逻辑继续跑。'
      : '- 建议：没有可恢复任务，直接新开一轮 token-factory。',
  ].join('\n');
}

function buildClerkContinueContextReply(options = {}) {
  const env = options.env || process.env;
  const brain = (options.summarizeTaskCenterBrain || summarizeTaskCenterBrain)({
    env,
    now: options.now || new Date(),
  }) || {};
  const today = brain.today || {};
  const failureReview = brain.failureReview || {};
  const nextPlan = brain.nextPlan || {};
  const trendReport = (options.readTrendIntelReport || defaultReadTrendIntelReport)(env) || {};
  const radarItems = Array.isArray(trendReport.learningRadar?.items)
    ? trendReport.learningRadar.items
    : [];
  const nextItems = Array.isArray(nextPlan.items) ? nextPlan.items : [];
  const quickCommands = Array.isArray(nextPlan.quickCommands) ? nextPlan.quickCommands : [];
  const lines = [
    '我按最近上下文继续，先给你一个可执行顺序。',
    `- 当前主线：${today.summaryText || '任务中枢暂时没有今日摘要。'}`,
    `- 失败复盘：${failureReview.summaryText || '最近没有明确失败项。'}`,
  ];

  if (radarItems.length) {
    const first = radarItems[0] || {};
    const projectName = sanitizeReplyField(first.projectName || first.title || '未命名项目', 160);
    const usefulFor = first.usefulFor ? `，对你有用：${sanitizeReplyField(first.usefulFor, 160)}` : '';
    const nextStep = first.nextStep ? `，下一步：${sanitizeReplyField(first.nextStep, 220)}` : '';
    lines.push(`- 最近热点：${projectName}${usefulFor}${nextStep}`);
  } else {
    lines.push('- 最近热点：还没有可用趋势雷达，建议先说“文员，今天开源热榜”。');
  }

  lines.push('接下来建议：');
  if (nextItems.length) {
    nextItems.slice(0, 4).forEach((item, index) => {
      lines.push(`${index + 1}. ${sanitizeReplyField(item, 220)}`);
    });
  } else {
    lines.push('1. 先查看任务中枢，再按失败项、UI 自动化、日报归档的顺序推进。');
  }

  lines.push('你可以直接发：');
  if (quickCommands.length) {
    quickCommands.slice(0, 3).forEach((command) => {
      lines.push(`- ${sanitizeReplyField(command, 160)}`);
    });
  } else {
    lines.push('- 文员，查看任务中枢主控脑');
    lines.push('- 文员，启动今天的自动流水线');
    lines.push('- 文员，烧 token 分析今天 GitHub 热门项目');
  }

  return lines.join('\n');
}

function buildClerkTodoSummaryReply(options = {}) {
  const plan = (options.summarizeDailyPlan || summarizeDailyPlan)({
    env: options.env || process.env,
    now: options.now || new Date(),
  });
  return [
    '文员待办整理：',
    plan.todaySummaryText,
    ...plan.tomorrowPlan.map((item) => `- ${item}`),
    '- 我可以读取记忆和任务中枢整理清单，但不会重启、清理硬盘或互修服务器。',
    '',
    '你可以继续说：文员，整理今天项目待办。',
  ].join('\n');
}

function buildDailyPipelineReply(route = {}, options = {}) {
  const dryRun = Boolean(route.dryRun);
  const runner = options.runDailyPipeline;
  const result = runner ? (runner({
    env: options.env || process.env,
    now: options.now || new Date(),
    dryRun,
    route,
  }) || {}) : {};
  const mode = result.mode || (dryRun ? 'dry-run' : 'run');
  const lines = [
    dryRun
      ? '每日流水线试跑：已委托执行器做 dry-run。'
      : '每日流水线：已委托执行器启动今天的自动流水线。',
  ];

  if (!runner) {
    lines.push('- 执行器：未注入 runner，本次只完成自然语言委托。');
  }
  if (result.accepted === false) {
    lines.push('- 状态：执行器未接受。');
  }
  if (result.taskId) {
    lines.push(`- 任务：${result.taskId}`);
  }
  lines.push(`- 模式：${mode}`);
  if (result.summary) {
    lines.push(`- 摘要：${sanitizeReplyField(result.summary, 400)}`);
  }
  if (Array.isArray(result.steps) && result.steps.length) {
    lines.push('- 步骤：');
    result.steps.slice(0, 8).forEach((step, index) => {
      lines.push(`${index + 1}. ${sanitizeReplyField(step, 200)}`);
    });
  }
  lines.push('- 边界：文员只负责委托和汇报，不在这里写部署逻辑。');
  return lines.join('\n');
}

function formatPipelineStageBreakdown(summary = {}) {
  const stages = Array.isArray(summary.stageStatuses)
    ? summary.stageStatuses
    : (Array.isArray(summary.stages) ? summary.stages : []);
  if (!stages.length) return [];
  return [
    '阶段进度：',
    ...stages.slice(0, 8).map((stage, index) => {
      const reason = stage.reason ? `（${sanitizeReplyField(stage.reason, 120)}）` : '';
      return `${index + 1}. ${sanitizeReplyField(stage.id || 'unknown', 120)}：${sanitizeReplyField(stage.status || 'unknown', 80)}${reason}`;
    }),
  ];
}

function formatPipelineFailureLines(summary = {}) {
  const lines = [];
  if (summary.failureDiagnosis) {
    lines.push('失败诊断：');
    lines.push(`- ${sanitizeReplyField(summary.failureDiagnosis.replace(/^失败诊断：/, ''), 500)}`);
  } else if (Array.isArray(summary.failedStageIds) && summary.failedStageIds.length) {
    lines.push('失败诊断：');
    lines.push(`- 失败阶段：${summary.failedStageIds.map((id) => sanitizeReplyField(id, 120)).join('、')}`);
  }
  if (summary.nextAction) {
    lines.push('下一步：');
    lines.push(`- ${sanitizeReplyField(summary.nextAction, 500)}`);
  }
  return lines;
}

function buildDailyPipelineStatusReply(options = {}) {
  const summaryReader = options.summarizeDailyPipeline
    || (options.summarizeTasks ? options.summarizeTasks : summarizeDailyPipeline);
  const summary = (summaryReader || summarizeTasks)({
    env: options.env || process.env,
    now: options.now || new Date(),
    type: 'daily-pipeline',
  }) || {};
  const counts = summary.counts || {};
  const lines = [
    '每日流水线状态：',
    summary.day ? `- 日期：${summary.day}` : null,
    `- 总任务：${counts.total || 0}`,
    `- 今天任务：${counts.today || 0}`,
    `- 运行中：${counts.running || 0}`,
    `- 失败：${counts.failed || 0}`,
    `- 可恢复：${counts.recoverable || 0}`,
    summary.latest ? `- 最新任务：${summary.latest.id}（${summary.latest.status}）` : '- 最新任务：暂无',
    summary.totalStages ? `- 阶段：${summary.completedStages || 0}/${summary.totalStages} 完成，失败 ${summary.failedStages || 0}` : null,
    ...formatPipelineStageBreakdown(summary),
    ...formatPipelineFailureLines(summary),
  ].filter(Boolean);
  return lines.join('\n');
}

function loadClerkCommandCenter(options = {}) {
  if (options.clerkCommandCenter) {
    return options.clerkCommandCenter;
  }
  return require('./clerk-command-center');
}

function buildClerkPlatformRegistrationReply(route = {}) {
  const parsed = parseRegistrationTaskRequest(route.rawText || '');
  const plan = buildRegistrationPlan(parsed);
  if (!plan.allowed) {
    return [
      '平台注册执行器当前不会直接执行这个请求。',
      `原因：${plan.reason}`,
      '只允许自有平台、测试环境或沙箱平台，并且默认先给 dry-run 计划。',
    ].join('\n');
  }

  return [
    `平台注册执行器：${plan.platformId}`,
    `- 模式：${plan.mode}`,
    `- 测试邮箱：${plan.selectedMailbox?.email || '未选中'}`,
    '- 计划步骤：',
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n');
}

function buildClerkTrainingDataReply() {
  const customerCases = buildCustomerServiceCases();
  const agentTasks = buildAgentEvalTasks();
  const emailPlaybook = buildEmailPlaybook();
  return [
    `文员训练数据工作流：已准备电商客服训练数据 ${customerCases.length} 条、Agent 评测题 ${agentTasks.length} 条、邮箱动作 ${emailPlaybook.length} 个。`,
    '',
    '我建议今天这样用：',
    '- 先抽退款、物流、优惠券、账号验证码、AI 客服转人工这 5 类做小样本评测',
    '- 用 Hermes/LongCat 生成客服回复，再按“安抚用户、下一步、无敏感信息、无编造订单状态”打分',
    '- 好样本归档到 agent4.archive@claw.163.com',
    '- 评测结果发到 agent4.archive@claw.163.com',
    '',
    '数据位置：data/qa-assets/customer-service-cases.json',
  ].join('\n');
}

function buildClerkWorkbenchReply(options = {}) {
  const env = options.env || process.env;
  const entries = (options.readUsageLedger || defaultReadUsageLedger)(env);
  const tokenIntro = entries.length
    ? `账本：最近已有 ${entries.length} 条 token/耗时记录，可以直接统计。`
    : '账本：暂时没有记录，普通聊几句后就能统计 token/耗时。';
  const customerCases = buildCustomerServiceCases();
  const uiMatrix = buildUiAutomationMatrix();

  return [
    '文员工作台：今天我能把这些串起来。',
    `- ${tokenIntro}`,
    `- QA：电商客服训练数据 ${customerCases.length} 条，UI 自动化矩阵 ${uiMatrix.length} 条。`,
    `- 日报：收件默认发到 ${resolveMailboxAction('daily', env).mailbox || 'daily 邮箱'}。`,
    `- 归档：失败样本和训练语料走 ${resolveMailboxAction('archive', env).mailbox || 'archive 邮箱'}。`,
    '- report / daily 的发信通道可以优先走 evanshine 第二 SMTP，失败时自动回退默认 SMTP。',
    '',
    '你可以自然语言继续说：',
    '- 文员，统计今天 Hermes 和 OpenClaw 谁更费 token',
    '- 文员，邮箱平台怎么结合起来玩',
    '- 文员，帮我生成一批电商平台客服训练数据',
    '- 文员，发送今天日报到邮箱',
    '- 文员，今天机器人发了哪些邮件',
  ].join('\n');
}

async function buildWechatMpArticleReply(route = {}, options = {}) {
  const publisher = options.publishWechatMpArticle || publishWechatMpArticle;
  const mode = route.action === 'wechat-mp-direct-publish'
    ? 'direct'
    : route.action === 'wechat-mp-publish-latest'
      ? 'publish-latest'
      : 'draft';
  try {
    const result = await publisher({
      mode,
      idea: route.idea || route.rawText || '',
    }, {
      env: options.env || process.env,
      now: options.now,
    });
    const lines = [
      '公众号文章处理完成：',
      `- 标题：${sanitizeReplyField(result.title || '未返回标题', 120)}`,
      `- 草稿 media_id：${sanitizeReplyField(result.mediaId || '未返回', 120)}`,
    ];
    if (result.publishId) {
      lines.push(`- 发布状态：已提交发布，publish_id：${sanitizeReplyField(result.publishId, 120)}`);
    } else if (mode === 'draft') {
      lines.push('- 发布状态：已生成草稿，等待你审核或继续说“公众号发布刚才那篇”。');
    } else {
      lines.push('- 发布状态：已处理，但微信接口没有返回 publish_id，请到公众号后台确认。');
    }
    return lines.join('\n');
  } catch (error) {
    return [
      '公众号文章处理失败：',
      `- 原因：${sanitizeReplyField(error.message || error, 500)}`,
      '- 常见原因：公众号未认证/接口权限不足、AppSecret 不正确、IP 白名单缺服务器 IP、缺少封面 media_id。',
      '- 建议先说：文员，公众号草稿：写一篇测试文章。草稿成功后再尝试直接发布。',
    ].join('\n');
  }
}

function buildClerkAgentReply(route = {}, options = {}) {
  if (route.action === 'token-summary') {
    const entries = (options.readUsageLedger || defaultReadUsageLedger)(options.env || process.env);
    return buildTokenSummaryReply(entries, { ...options, route });
  }

  if (route.action === 'workbench') {
    return buildClerkWorkbenchReply(options);
  }

  if (route.action === 'mailbox-workbench') {
    return buildClerkMailboxWorkbenchReply(options.env || process.env, options);
  }

  if (route.action === 'mailbox-approvals') {
    const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(options.env || process.env, options);
    const queueFile = getMailApprovalQueueFile(options.env || process.env);
    const queue = buildApprovalQueueFromMessages(workbench.inbox || [], { now: (options.now || new Date()).toISOString() });
    writeMailApprovalQueue(queue, queueFile);
    return formatMailWorkbenchReply(workbench, { mode: 'pending' });
  }

  if (route.action === 'mailbox-approval-action') {
    return buildMailboxApprovalActionReply(route, options);
  }

  if (route.action === 'mailbox-daily-report') {
    const workbench = (options.buildMailWorkbenchReportFromEnv || buildMailWorkbenchReportFromEnv)(options.env || process.env, options);
    return [
      'ClawEmail 每日报告预览：',
      '',
      formatMailWorkbenchReply(workbench),
      '',
      '这份报告可以直接进入主动日报模板；要真实外发，请说：文员，发送今天日报到邮箱。',
    ].join('\n');
  }

  if (route.action === 'file-channel-workbench') {
    return buildClerkFileChannelReply(options.env || process.env, options);
  }

  if (route.action === 'recent-files') {
    return buildClerkRecentFilesReply(options.env || process.env, options);
  }

  if (route.action === 'mailbox-registration-playbook') {
    return buildClerkMailboxRegistrationReply(options.env || process.env);
  }

  if (route.action === 'verification-test-plan') {
    return buildClerkVerificationTestPlanReply(options.env || process.env);
  }

  if (route.action === 'platform-registration-runner') {
    return buildClerkPlatformRegistrationReply(route);
  }

  if (route.action === 'mailbox-tasks') {
    return buildClerkMailboxTasksReply(options.env || process.env);
  }

  if (route.action === 'mail-ledger') {
    const entries = (options.readMailLedger || defaultReadMailLedger)(options.env || process.env);
    const todayEntries = filterMailLedgerEntriesForDay(entries, {
      timezoneOffsetMinutes: Number((options.env || process.env).MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES || 480),
      now: options.now,
    });
    return buildMailLedgerSummaryReply(todayEntries);
  }

  if (route.action === 'training-data') {
    return buildClerkTrainingDataReply();
  }

  if (route.action === 'token-lab') {
    return [
      '文员高 token 训练场：',
      '- 用 LongCat 批量生成电商客服、Agent 评测、UI 自动化、邮箱调度样本。',
      '- 每次模型调用都会写入 token/耗时账本；没有 usage 时会做字符估算。',
      '- 产物会写到 data/qa-token-lab，并把摘要归档到 archive/eval/report 邮箱动作。',
      '- 默认小批量运行；要加大火力可以配置 QA_TOKEN_LAB_BATCH_SIZE。',
      '',
      '启动口令：文员，启动高 token 训练场。',
    ].join('\n');
  }

  if (route.action === 'trend-intel') {
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

  if (route.action === 'trend-token-factory') {
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

  if (route.action === 'daily-pipeline') {
    return buildDailyPipelineReply(route, options);
  }

  if (route.action === 'daily-pipeline-status') {
    return buildDailyPipelineStatusReply(options);
  }

  if (['wechat-mp-draft', 'wechat-mp-direct-publish', 'wechat-mp-publish-latest'].includes(route.action)) {
    return buildWechatMpArticleReply(route, options);
  }

  if (route.action === 'token-factory') {
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

  if (route.action === 'token-factory-status') {
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

  if (route.action === 'task-center-today') {
    return buildTaskCenterTodayReply(options);
  }

  if (route.action === 'task-center-failed') {
    return buildTaskCenterFailedReply(options);
  }

  if (route.action === 'task-center-continue-yesterday') {
    return buildTaskCenterContinueYesterdayReply(options);
  }

  if (route.action === 'continue-context') {
    return buildClerkContinueContextReply(options);
  }

  if (route.action === 'task-center-brain') {
    return buildTaskCenterBrainReply(options);
  }

  if (route.action === 'multi-agent-lab') {
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

  if (route.action === 'todo-summary') {
    return buildClerkTodoSummaryReply(options);
  }

  if (route.action === 'command-center') {
    return loadClerkCommandCenter(options).buildClerkCommandCenterReply(route, options);
  }

  if (route.action === 'daily-report') {
    return loadClerkCommandCenter(options).buildClerkDailyReportReply(route, options);
  }

  if (route.action === 'daily-email') {
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

  if (route.action === 'knowledge-summary') {
    return [
      '文员知识沉淀：',
      '- 适合沉淀排查经验、测试结论、模型对比、邮箱玩法。',
      '- 不保存密钥、密码、token、邮箱授权码。',
      '- 可以写入本地 memory，再同步到 GBrain。',
    ].join('\n');
  }

  return [
    '我这边按文员模式工作，适合帮你做整理和跟进，不会乱动高风险操作。',
    '- 我可以统计 Hermes/OpenClaw 的 token 和耗时',
    '- 我可以整理待办、日报、周报',
    '- 我可以汇总 UI 自动化和 Allure 结果',
    '- 我可以做邮箱报告归档和知识库沉淀',
    '',
    '默认我不执行重启、清理硬盘、互修服务器这类高风险动作。',
  ].join('\n');
}

function buildImageChannelReply(route = {}) {
  const config = route.config || {};
  const lines = [];
  if (route.action === 'image-channel-switch') {
    lines.push('我识别到你要切换生图通道。');
    lines.push(`- URL：${config.url || '未提供'}`);
    lines.push(`- Key：${config.maskedApiKey || '未提供'}`);
    lines.push(`- Model：${config.model || 'auto'}`);
    lines.push(`- Size：${config.size || '1024x1024'}`);
    lines.push(`- Scope：${config.scope || 'both'}`);
    lines.push('下一步会写入对应桥服务环境变量、重启服务，并自动测试 /v1/models 和生图接口。');
    return lines.join('\n');
  }

  lines.push('我注意到你发了生图通道配置，但这次先不替换。');
  lines.push(`- 置信度：${route.confidence || 'low'}`);
  if (config.url) lines.push(`- URL：${config.url}`);
  if (config.maskedApiKey) lines.push(`- Key：${config.maskedApiKey}`);
  if (route.missing?.length) lines.push(`- 缺少字段：${route.missing.join(', ')}`);
  lines.push('你可以直接说：切换生图通道 url: https://... key: sk-...');
  return lines.join('\n');
}

function buildModelChannelReply(route = {}) {
  const config = route.config || {};
  const lines = [];
  if (route.action === 'model-channel-switch') {
    lines.push('我识别到你要切换聊天模型通道。');
    lines.push(`- URL：${config.url || '未提供'}`);
    lines.push(`- Key：${config.maskedApiKey || '未提供'}`);
    lines.push(`- Model：${config.model || '未指定，沿用当前默认模型'}`);
    if (config.simpleModel) lines.push(`- Simple：${config.simpleModel}`);
    if (config.thinkingModel) lines.push(`- Thinking：${config.thinkingModel}`);
    lines.push(`- Endpoint：${config.endpointMode || 'chat_completions'}`);
    lines.push(`- Scope：${config.scope || 'current'}`);
    lines.push('下一步会写入当前桥服务的流式聊天环境变量、重启服务，并用 /v1/models 做轻量探测。');
    return lines.join('\n');
  }

  lines.push('我注意到你发了聊天模型通道配置，但这次先不替换。');
  lines.push(`- 置信度：${route.confidence || 'low'}`);
  if (config.url) lines.push(`- URL：${config.url}`);
  if (config.maskedApiKey) lines.push(`- Key：${config.maskedApiKey}`);
  if (config.model) lines.push(`- Model：${config.model}`);
  if (route.missing?.length) lines.push(`- 缺少字段：${route.missing.join(', ')}`);
  lines.push('你可以直接说：切换聊天模型通道 url: https://... key: ak_... model: LongCat-Flash-Chat');
  return lines.join('\n');
}

function buildMemoryAgentReply(route, memoryContext = buildMemoryContext(), options = {}) {
  if (route.action === 'brain-guide') {
    return buildBrainGuideReply(options.assistantName || 'OpenClaw');
  }

  if (route.action === 'remember') {
    try {
      rememberMemoryNote(
        options.noteFile || join(process.cwd(), 'data', 'memory', 'runbook-notes.md'),
        route.note,
      );
      return `已记住：${route.note}`;
    } catch (error) {
      return `不能保存疑似密钥或敏感信息：${error.message}`;
    }
  }

  if (route.action === 'search') {
    const searchMemoryContext = options.searchMemoryContext || buildMemorySearchContext;
    return searchMemoryContext(route.query);
  }

  if (route.action === 'brain-search') {
    const brainSearch = options.brainSearch || ((query) => runGBrainSearch(query, {
      env: options.env,
      cwd: options.gbrainCwd,
      gbrainBin: options.gbrainBin,
    }));
    return Promise.resolve()
      .then(() => brainSearch(route.query))
      .catch((error) => {
      const searchMemoryContext = options.searchMemoryContext || buildMemorySearchContext;
      return [
        'GBrain 暂时不可用，先回退到本地记忆搜索。',
        `原因：${sanitizeReplyField(error.message || error, 300)}`,
        '',
        searchMemoryContext(route.query),
      ].join('\n');
      });
  }

  return [
    '当前记忆摘要：',
    trimForReply(memoryContext, 1400),
  ].join('\n');
}

async function defaultRunOpsCheck() {
  return {
    service: 'bridge-service',
    active: 'unknown',
    health: 'not configured in local mode',
    watchdog: 'unknown',
    commit: 'unknown',
  };
}

function buildQaAgentReply(route = {}) {
  const customerCases = buildCustomerServiceCases();
  const agentTasks = buildAgentEvalTasks();
  const uiMatrix = buildUiAutomationMatrix();
  const emailPlaybook = buildEmailPlaybook();

  if (route.action === 'customer-service-data') {
    return [
      `已准备好一批电商客服训练数据：${customerCases.length} 条。`,
      '你可以直接让我继续做：',
      '- 抽 20 条给 AI 客服回答并评分',
      '- 把退款/物流/优惠券场景各扩展 100 条',
      '- 找出客服语料里还缺哪些场景',
      '',
      '数据位置：data/qa-assets/customer-service-cases.json',
      '建议归档邮箱：agent4.archive@claw.163.com',
    ].join('\n');
  }

  if (route.action === 'agent-eval') {
    return [
      `已准备好 OpenClaw/Hermes Agent 评测题：${agentTasks.length} 条。`,
      '可以这样玩：',
      '- 跑一轮 OpenClaw 和 Hermes 对比',
      '- 只测 UI 自动化、服务器运维、邮箱调度三类',
      '- 生成评分报告并发到 agent4.archive@claw.163.com',
      '',
      '数据位置：data/qa-assets/agent-eval-tasks.json',
    ].join('\n');
  }

  if (route.action === 'ui-matrix') {
    return [
      `已整理 UI 自动化测试矩阵：${uiMatrix.length} 条。`,
      '优先建议从 P0 开始：登录、邮箱验证码、搜索、加购、下单、AI 客服入口。',
      '你可以继续说：把 P0 转成 Playwright 用例 / 只看 AI 客服相关用例 / 生成 GitHub Actions 跑法。',
      '',
      '数据位置：data/qa-assets/ui-automation-matrix.json',
    ].join('\n');
  }

  if (route.action === 'email-playbook') {
    return [
      `邮箱平台玩法已经整理好：${emailPlaybook.length} 个动作入口。`,
      '最自然的用法：',
      '- 用 verify 邮箱测注册验证码',
      '- 把失败样本归档到 archive',
      '- 把 Agent 评测结果发到 eval',
      '- 每天发一封测试日报到 daily',
      '',
      '数据位置：data/qa-assets/email-playbook.json',
      '说明文档：docs/QA数据资产与邮箱平台玩法.md',
    ].join('\n');
  }

  return [
    '当前 QA 数据资产可以这样用：',
    `- 电商客服训练数据：${customerCases.length} 条`,
    `- Agent 评测题：${agentTasks.length} 条`,
    `- UI 自动化矩阵：${uiMatrix.length} 条`,
    `- 邮箱平台玩法：${emailPlaybook.length} 个动作`,
    '',
    '你可以直接说：帮我生成一批电商平台客服训练数据 / 做一轮 Agent 评测 / 整理 UI 自动化测试矩阵 / 邮箱平台可以怎么玩。',
  ].join('\n');
}

function buildDifyTestingAssistantFallback(result = {}, route = {}) {
  const reason = sanitizeReplyField(result.reason || 'unavailable', 120);
  const detail = sanitizeReplyField(result.message || 'Dify 测试助理暂不可用。', 500);
  const query = sanitizeReplyField(route.query || route.rawText || '', 240);
  return [
    'Dify 测试助理暂不可用，先用本地结构化模板继续。',
    `- 状态：${reason}`,
    `- 详情：${detail}`,
    query ? `- 原始需求：${query}` : null,
    '',
    '测试目标：围绕用户需求明确本次要验证的业务目标和质量风险。',
    '测试范围：功能主流程、异常分支、数据边界、权限/登录态、关键兼容性。',
    '测试用例：先拆 P0 冒烟用例，再补 P1 回归用例；每条用例要包含前置条件、步骤、预期结果。',
    '执行步骤：Dify 负责生成方案；OpenClaw/Hermes 执行浏览器/API/GitHub Actions 验证；文员汇总报告。',
    '预期结果：核心流程可稳定通过，失败点能定位到页面、接口、日志或测试数据。',
    '实际结果：等待真实执行结果回填。',
    '问题清单：执行失败后记录复现步骤、截图/trace、接口响应、日志摘要。',
    '改进建议：优先修复阻塞 P0 的缺陷，再补自动化断言和报告归档。',
  ].filter(Boolean).join('\n');
}

function buildDifyTestingAssistantReply(route = {}, result = {}) {
  if (result?.ok) {
    return [
      'Dify 测试助理结果：',
      trimForReply(result.answer || '', 2400),
      '',
      '下一步建议：如果这份方案要落地执行，可以继续说“交给 OpenClaw 跑冒烟验证”或“把这些用例转成 Playwright”。',
    ].join('\n');
  }

  return buildDifyTestingAssistantFallback(result, route);
}

function targetLabel(target) {
  if (target === 'hermes') return 'Hermes';
  if (target === 'openclaw') return 'OpenClaw';
  if (target === 'peer') return '对方';
  return '我这台';
}

function buildClarifyReply(route) {
  const actionText = String(route.action || '').includes('repair') ? '修复' : '重启';
  const target = targetLabel(route.target);
  return [
    `你是想让我${actionText}${target === '我这台' ? '我自己' : target}吗？`,
    `为了避免误操作，请发更明确的一句，比如：${actionText}你自己 / ${actionText} Hermes / ${actionText} OpenClaw。`,
  ].join('\n');
}

function buildLowConfidenceOpsReply() {
  return [
    '我没完全听懂你想让我看哪台服务器，或者要做什么操作。',
    '可以这样说：',
    '- 你现在内存多少',
    '- 你硬盘还剩多少',
    '- 看看 Hermes 的服务器状态',
    '- 重启你自己',
    '- 修复 OpenClaw',
  ].join('\n');
}

function buildSummaryReply(route, result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const target = route.target && route.target !== 'self'
    ? targetLabel(route.target)
    : '我这台服务器';
  const lines = [
    `${target}目前${safeResult.active === 'active' ? '正常' : '状态需要留意'}。`,
  ];

  if (safeResult.memory) {
    lines.push(`内存：${sanitizeReplyField(safeResult.memory.total || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.memory.used || 'unknown')}，可用 ${sanitizeReplyField(safeResult.memory.free || 'unknown')}`);
  }
  if (safeResult.disk) {
    lines.push(`硬盘：${sanitizeReplyField(safeResult.disk.size || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.disk.used || 'unknown')}，剩余 ${sanitizeReplyField(safeResult.disk.available || 'unknown')}，使用率 ${sanitizeReplyField(safeResult.disk.usePercent || 'unknown')}`);
  }
  if (safeResult.load) {
    lines.push(`负载：${sanitizeReplyField(safeResult.load.loadAverage || 'unknown')}，CPU：${sanitizeReplyField(safeResult.load.cpu || 'unknown')}`);
  }

  lines.push(`服务：${sanitizeReplyField(safeResult.service || 'unknown')}（${sanitizeReplyField(safeResult.active || 'unknown')}）`);
  lines.push(`代码版本：${sanitizeReplyField(safeResult.commit || 'unknown')}`);
  return lines.join('\n');
}

function buildDiskAuditReply(result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const candidates = Array.isArray(safeResult.audit?.candidates) ? safeResult.audit.candidates : [];
  const lines = [
    '硬盘占用盘点：',
  ];

  if (safeResult.disk) {
    lines.push(`硬盘：${sanitizeReplyField(safeResult.disk.size || 'unknown')} 总量，已用 ${sanitizeReplyField(safeResult.disk.used || 'unknown')}，剩余 ${sanitizeReplyField(safeResult.disk.available || 'unknown')}，使用率 ${sanitizeReplyField(safeResult.disk.usePercent || 'unknown')}`);
  }

  if (candidates.length === 0) {
    lines.push('暂时没有找到白名单内可建议清理的候选项。');
    return lines.join('\n');
  }

  candidates.forEach((candidate, index) => {
    const id = candidate.id || index + 1;
    const risk = candidate.risk === 'safe' ? '可清理' : '需确认';
    lines.push(`${id}. ${sanitizeReplyField(candidate.name || 'unknown')} ${sanitizeReplyField(candidate.size || 'unknown')} - ${sanitizeReplyField(candidate.path || 'unknown')}（${risk}）`);
    if (candidate.recommendation) {
      lines.push(`   ${sanitizeReplyField(candidate.recommendation)}`);
    }
  });

  lines.push('要执行请回复：确认清理第 1 个 / 清理 khoj。');
  return lines.join('\n');
}

function buildCleanupConfirmReply(result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  if (!safeResult.cleaned) {
    return [
      '还没有可执行的清理项。',
      safeResult.detail ? `原因：${sanitizeReplyField(safeResult.detail)}` : '请先说“看看哪些东西占硬盘”，让我先生成候选清单。',
    ].join('\n');
  }

  const cleaned = safeResult.cleaned;
  const before = cleaned.beforeAvailable || 'unknown';
  const after = cleaned.afterAvailable || 'unknown';
  return [
    `已清理 ${sanitizeReplyField(cleaned.name || 'unknown')}。`,
    `路径：${sanitizeReplyField(cleaned.path || 'unknown')}`,
    `硬盘剩余：${sanitizeReplyField(before)} -> ${sanitizeReplyField(after)}`,
    cleaned.detail ? `详情：${sanitizeReplyField(cleaned.detail)}` : null,
  ].filter(Boolean).join('\n');
}

async function buildOpsAgentReply(route, options = {}) {
  if (!ALLOWED_OPS_ACTIONS.has(route.action)) {
    return '不支持的运维指令。';
  }

  if (route.action === 'clarify' || route.confidence === 'low') {
    return buildLowConfidenceOpsReply();
  }

  if (DANGEROUS_OPS_ACTIONS.has(route.action) && route.confidence && route.confidence !== 'high') {
    return buildClarifyReply(route);
  }

  let result;
  try {
    result = await (options.runOpsCheck || defaultRunOpsCheck)(route.action, route);
  } catch (error) {
    return [
      '服务器状态暂时不可用。',
      `原因：${sanitizeReplyField(error.message || error)}`,
    ].join('\n');
  }

  const safeResult = result && typeof result === 'object' ? result : {};
  if (route.action === 'disk-audit') {
    return buildDiskAuditReply(safeResult);
  }
  if (route.action === 'cleanup-confirm') {
    return buildCleanupConfirmReply(safeResult);
  }
  if (/summary$/.test(route.action)) {
    return buildSummaryReply(route, safeResult);
  }

  return [
    '服务器状态摘要：',
    safeResult.target ? `目标：${sanitizeReplyField(safeResult.target || 'unknown')}` : null,
    safeResult.operation ? `操作：${sanitizeReplyField(safeResult.operation || 'unknown')}` : null,
    `服务：${sanitizeReplyField(safeResult.service || 'unknown')}`,
    `服务状态：${sanitizeReplyField(safeResult.active || 'unknown')}`,
    `健康检查：${sanitizeReplyField(safeResult.health || 'unknown')}`,
    `watchdog：${sanitizeReplyField(safeResult.watchdog || 'unknown')}`,
    `代码版本：${sanitizeReplyField(safeResult.commit || 'unknown')}`,
    safeResult.detail ? `详情：${sanitizeReplyField(safeResult.detail, 1000)}` : null,
  ].filter(Boolean).join('\n');
}

function buildChatAgentPrompt(text, memoryContext = '') {
  const parts = [
    '请基于以上记忆，用中文自然回答用户，像一个会一起做项目的助手。',
    '不要编造实时服务器状态；如果用户要实时状态，建议他说“你现在内存多少”“你硬盘还剩多少”或“看看服务器状态”。',
    '如果用户在聊想法，先正常解释和拆解，不要机械要求用户先查 /status。',
    `用户消息：${text}`,
  ];

  if (memoryContext) {
    parts.unshift(memoryContext, '');
  }

  return parts.join('\n');
}

module.exports = {
  ALLOWED_OPS_ACTIONS,
  buildCapabilityGuideReply,
  buildBrainGuideReply,
  buildBrowserAgentReply,
  buildChatAgentPrompt,
  buildClerkAgentReply,
  buildClerkFileChannelReply,
  buildClerkMailboxWorkbenchReply,
  buildClerkMailboxRegistrationReply,
  buildClerkMailboxTasksReply,
  buildClerkPlatformRegistrationReply,
  buildClerkTrainingDataReply,
  buildClerkVerificationTestPlanReply,
  buildClerkWorkbenchReply,
  buildImageChannelReply,
  buildModelChannelReply,
  buildMultiIntentPlanReply,
  buildDocAgentReply,
  buildEcosystemAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  buildPlannerClarifyReply,
  buildDifyTestingAssistantReply,
  buildQaAgentReply,
  isSafeOpsText,
  sanitizeReplyField,
  trimForReply,
};
