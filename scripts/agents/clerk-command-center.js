const { join } = require('node:path');
const {
  buildDailySummary,
} = require('../daily-summary');
const {
  readMailLedgerEntries,
} = require('../mail-ledger');
const {
  readUsageLedgerEntries,
} = require('../usage-ledger');
const {
  readDailySummarySnapshot,
} = require('../daily-summary-snapshot');
const {
  summarizeOpsEvents,
} = require('../ops-event-ledger');
const {
  summarizeDailyPlan,
  summarizeDailyPipeline,
  summarizeTaskCenterBrain,
  summarizeTaskCenterDigest,
  summarizeTasks,
} = require('../task-center');

function readJsonFileSafe(filePath, readJsonFile) {
  if (typeof readJsonFile === 'function') {
    return readJsonFile(filePath);
  }
  try {
    return require('node:fs').existsSync(filePath)
      ? JSON.parse(require('node:fs').readFileSync(filePath, 'utf8'))
      : null;
  } catch {
    return null;
  }
}

function safeReadList(reader, fallback = [], warning, warnings = []) {
  try {
    const result = typeof reader === 'function' ? reader() : fallback;
    if (Array.isArray(result)) {
      return result;
    }
    if (warning) warnings.push(warning);
    return fallback;
  } catch {
    if (warning) warnings.push(warning);
    return fallback;
  }
}

function safeReadObject(reader, fallback = {}, warning, warnings = []) {
  try {
    const result = typeof reader === 'function' ? reader() : fallback;
    if (result && typeof result === 'object') {
      return result;
    }
    if (warning) warnings.push(warning);
    return fallback;
  } catch {
    if (warning) warnings.push(warning);
    return fallback;
  }
}

function defaultReadUsageLedger(env) {
  return readUsageLedgerEntries(env, 200);
}

function defaultReadMailLedger(env) {
  return readMailLedgerEntries(env, 80);
}

function defaultReadTrendIntelReport(env, options = {}) {
  const filePath = env.TREND_INTEL_OUTPUT_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'trend-intel', 'latest.json');
  return readJsonFileSafe(filePath, options.readJsonFile);
}

function joinReportPath(baseDir, filename) {
  const base = String(baseDir || '').replace(/[\\/]+$/, '');
  return base ? `${base}/${filename}` : filename;
}

function defaultReadProactiveThinkerReport(env, options = {}) {
  const now = options.now || new Date();
  const day = now instanceof Date && Number.isFinite(now.getTime())
    ? now.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const outputDir = env.PROACTIVE_THINKER_OUTPUT_DIR
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'proactive-thinker');
  const filePath = env.PROACTIVE_THINKER_LATEST_FILE || joinReportPath(outputDir, `${day}.json`);
  const report = readJsonFileSafe(filePath, options.readJsonFile);
  if (!report || typeof report !== 'object') {
    return null;
  }
  return {
    ...report,
    __filePath: filePath,
  };
}

function collectProactiveSignals(report = {}) {
  const sections = report.sections || {};
  return [
    ...(Array.isArray(sections.worldNews?.items) ? sections.worldNews.items : []),
    ...(Array.isArray(sections.hotMonitor?.items) ? sections.hotMonitor.items : []),
    ...(Array.isArray(sections.trendIntel?.items) ? sections.trendIntel.items : []),
    ...(Array.isArray(report.creative?.selected) ? report.creative.selected : []),
  ].slice(0, 5).map((item = {}) => ({
    title: item.title || item.projectName || item.name || item.summary || '未命名线索',
    source: item.source || item.kind || item.platform || '',
    reason: item.reason || item.summary || item.description || item.usefulFor || '',
    link: item.link || item.url || item.html_url || '',
  }));
}

function summarizeProactiveThinker(report = null) {
  if (!report || typeof report !== 'object') {
    return {
      status: 'missing',
      summary: '暂无主动思考器报告。',
      generatedAt: '',
      pendingConfirmationCount: 0,
      pendingConfirmations: [],
      reportPath: '',
      topSignals: [],
    };
  }
  const pendingConfirmations = Array.isArray(report.pendingConfirmations)
    ? report.pendingConfirmations
    : [];
  return {
    status: report.status || 'unknown',
    summary: report.summary || '',
    generatedAt: report.generatedAt || '',
    pendingConfirmationCount: pendingConfirmations.length,
    pendingConfirmations: pendingConfirmations.slice(0, 5),
    reportPath: report.files?.markdown || report.files?.md || report.__filePath || '',
    topSignals: collectProactiveSignals(report),
  };
}

function toLocalDayKey(input, timezoneOffsetMinutes = 480) {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const shifted = new Date(date.getTime() + Number(timezoneOffsetMinutes || 0) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function summarizeUsage(entries = []) {
  return {
    entries,
    realTokens: entries.reduce((total, entry) => total + Number(entry.totalTokens || 0), 0),
    estimatedTokens: entries.reduce((total, entry) => total + Number(entry.estimatedTotalTokens || 0), 0),
    totalTokens: entries.reduce((total, entry) => total
      + Number(entry.totalTokens ?? entry.estimatedTotalTokens ?? 0), 0),
  };
}

function summarizeMail(entries = [], options = {}) {
  const now = options.now || new Date();
  const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes ?? options.env?.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES ?? 480);
  const todayKey = toLocalDayKey(now, timezoneOffsetMinutes);
  const todayEntries = entries.filter((entry) => toLocalDayKey(entry.timestamp || entry.createdAt || entry.sentAt || now, timezoneOffsetMinutes) === todayKey);
  return {
    entries,
    todayEntries,
  };
}

function formatMailArchiveSummary(mailSummary = {}) {
  const todayEntries = Array.isArray(mailSummary.todayEntries) ? mailSummary.todayEntries : [];
  if (!todayEntries.length) {
    return '暂无今日邮件流水；发送日报时会归档到 daily 邮箱动作。';
  }

  const archiveTargets = Array.from(new Set(todayEntries
    .map((entry) => String(entry.archiveTo || entry.archive_to || entry.mailbox || '').trim())
    .filter(Boolean)));
  const recipients = Array.from(new Set(todayEntries
    .map((entry) => String(entry.recipient || entry.to || entry.toEmail || '').trim())
    .filter(Boolean)));
  const targetText = archiveTargets.length
    ? `归档邮箱：${archiveTargets.slice(0, 5).join('、')}。`
    : '归档邮箱：暂无明确地址。';
  const recipientText = recipients.length
    ? `外发收件人：${recipients.slice(0, 5).join('、')}。`
    : '';
  return [`今天邮件动作 ${todayEntries.length} 条。`, targetText, recipientText].filter(Boolean).join('');
}

function formatDigestBlockers(digest = {}) {
  const failed = Array.isArray(digest.failedItems) ? digest.failedItems : [];
  const recoverable = Array.isArray(digest.recoverableItems) ? digest.recoverableItems : [];
  return [
    ...failed.slice(0, 3).map((task) => {
      const type = task.type === 'news-digest'
        ? '新闻摘要'
        : task.type === 'ui-automation'
          ? 'UI 自动化'
          : task.type === 'daily-digest'
            ? '主动日报'
            : task.type === 'token-factory'
              ? 'token 工厂'
              : task.type || '任务';
      const error = task.error ? `：${task.error}` : '：失败待复盘';
      return `${type} ${task.id || 'unknown'}${error}`;
    }),
    ...recoverable.slice(0, 3).map((task) => {
      const type = task.type === 'token-factory'
        ? 'token 工厂'
        : task.type === 'ui-automation'
          ? 'UI 自动化'
          : task.type || '任务';
      return `${type} ${task.id || 'unknown'}：可恢复`;
    }),
  ];
}

function mergeTaskDigest(taskSummary = {}, digest = {}) {
  if (!digest || typeof digest !== 'object') {
    return taskSummary;
  }
  const merged = { ...taskSummary };
  if (digest.today?.summaryText) {
    merged.todaySummaryText = digest.today.summaryText;
  }
  if (digest.history?.summaryText) {
    merged.historySummaryText = digest.history.summaryText;
  }
  if (digest.failureReview?.summaryText) {
    merged.failureReviewText = digest.failureReview.summaryText;
  }
  if (Array.isArray(digest.failureReview?.items) && digest.failureReview.items.length) {
    merged.failureItems = digest.failureReview.items;
  }
  if (Array.isArray(digest.failureReview?.recommendations) && digest.failureReview.recommendations.length) {
    merged.failureRecommendations = digest.failureReview.recommendations;
  }
  if (Array.isArray(digest.nextPlan?.items) && digest.nextPlan.items.length) {
    merged.tomorrowPlanText = digest.nextPlan.items;
    merged.nextPlanItems = digest.nextPlan.items;
  }
  if (Array.isArray(digest.nextPlan?.quickCommands) && digest.nextPlan.quickCommands.length) {
    merged.quickCommands = digest.nextPlan.quickCommands;
  }
  if (digest.today?.byType) {
    merged.byType = digest.today.byType;
  }
  if (digest.today?.counts) {
    merged.counts = digest.today.counts;
  }
  if (digest.todaySummary) {
    merged.todaySummaryText = digest.todaySummary;
  }
  if (Array.isArray(digest.tomorrowPlan) && digest.tomorrowPlan.length) {
    merged.tomorrowPlanText = digest.tomorrowPlan;
  }
  const blockers = formatDigestBlockers(digest);
  if (blockers.length) {
    merged.blockers = blockers;
  } else if (Array.isArray(merged.failureItems) && merged.failureItems.length) {
    merged.blockers = formatDigestBlockers({
      failedItems: merged.failureItems,
      recoverableItems: digest.recoverableItems,
    });
  }
  if (Array.isArray(digest.nextSuggestedActions) && digest.nextSuggestedActions.length) {
    merged.quickCommands = digest.nextSuggestedActions;
  }
  return merged;
}

function loadMultiAgentSummary(env = process.env, options = {}) {
  return readJsonFileSafe(
    join(env.MULTI_AGENT_LAB_OUTPUT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'multi-agent-lab'), 'summary.json'),
    options.readJsonFile,
  );
}

function buildClerkCommandCenterState(options = {}) {
  const env = options.env || process.env;
  const warnings = [];
  const now = options.now || new Date();
  const plan = safeReadObject(() => (options.summarizeDailyPlan || summarizeDailyPlan)({
    env,
    now,
  }), {
    todaySummaryText: '今天还没有可用任务摘要。',
    tomorrowPlan: ['先查看任务中枢，确认今天要推进的主线。'],
    byType: [],
    counts: {},
  }, 'daily_plan_unavailable', warnings);
  const tasks = safeReadObject(() => (options.summarizeTasks || summarizeTasks)({
    env,
    now,
  }), {
    counts: {},
    byType: [],
    latest: null,
    recoverableTasks: [],
    todayTasks: [],
  }, 'task_center_unavailable', warnings);
  const digestReader = options.summarizeTaskCenterBrain
    || (!options.summarizeTasks ? summarizeTaskCenterBrain : null)
    || options.summarizeTaskCenterDigest
    || (!options.summarizeTasks ? summarizeTaskCenterDigest : null);
  const taskDigest = digestReader
    ? safeReadObject(() => digestReader({
      env,
      now,
    }), {}, 'task_center_digest_unavailable', warnings)
    : {};
  const pipeline = safeReadObject(() => (options.summarizeDailyPipeline || summarizeDailyPipeline)({
    env,
    now,
    type: 'daily-pipeline',
  }), {}, 'daily_pipeline_unavailable', warnings);
  const usageEntries = safeReadList(
    () => (options.readUsageLedger || defaultReadUsageLedger)(env, 200),
    [],
    'usage_ledger_unavailable',
    warnings,
  );
  const mailEntries = safeReadList(
    () => (options.readMailLedger || defaultReadMailLedger)(env, 80),
    [],
    'mail_ledger_unavailable',
    warnings,
  );
  const snapshot = safeReadObject(
    () => (options.readDailySummarySnapshot || readDailySummarySnapshot)(env),
    { runs: [] },
    'daily_snapshot_unavailable',
    warnings,
  );
  const trendIntel = safeReadObject(
    () => (options.readTrendIntelReport || defaultReadTrendIntelReport)(env, options),
    { total: 0, learningRadar: { items: [] } },
    '',
    warnings,
  );
  const proactiveThinkerReport = safeReadObject(
    () => (options.readProactiveThinkerReport || defaultReadProactiveThinkerReport)(env, { ...options, now }),
    null,
    '',
    warnings,
  );
  const opsEvents = safeReadObject(
    () => (options.summarizeOpsEvents || summarizeOpsEvents)(env, {
      until: now.toISOString(),
      limit: 500,
      sampleSize: 5,
    }),
    {},
    'ops_events_unavailable',
    warnings,
  );
  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];

  const mergedTasks = mergeTaskDigest(tasks, taskDigest);

  return {
    env,
    plan: {
      ...plan,
      tomorrowPlan: Array.isArray(plan.tomorrowPlan) ? plan.tomorrowPlan : [],
      byType: Array.isArray(plan.byType) ? plan.byType : [],
      counts: plan.counts || {},
    },
    tasks: {
      ...mergedTasks,
      byType: Array.isArray(mergedTasks.byType) ? mergedTasks.byType : [],
      counts: mergedTasks.counts || {},
    },
    pipeline,
    usage: summarizeUsage(usageEntries),
    mail: summarizeMail(mailEntries, { env, now }),
    snapshot: {
      runs,
      latestRun: runs.at(-1) || null,
    },
    trendIntel: {
      ...trendIntel,
      total: Number(trendIntel.total || 0),
      learningRadar: {
        ...(trendIntel.learningRadar || {}),
        items: Array.isArray(trendIntel.learningRadar?.items) ? trendIntel.learningRadar.items : [],
      },
    },
    proactiveThinker: summarizeProactiveThinker(proactiveThinkerReport),
    opsEvents,
    multiAgentSummary: loadMultiAgentSummary(env, options),
    warnings,
  };
}

function formatTypeHighlights(byType = []) {
  if (!byType.length) {
    return '任务类型：暂无分布。';
  }
  return `任务类型：${byType.slice(0, 4).map((row) => `${row.label || row.type || '未分类'}：今天 ${row.today || row.total || 0} 个`).join('，')}。`;
}

function formatLatestRun(run) {
  if (!run) {
    return '最近 UI 快照：暂无';
  }
  const link = run.artifactsUrl || run.runUrl || '';
  const mode = [run.targetRef, run.runMode].filter(Boolean).join(' / ');
  return `最近 UI 快照：${run.conclusion || 'unknown'}${mode ? `（${mode}）` : ''}${link ? ` ${link}` : ''}`;
}

function formatUiAutomationSignal(run) {
  if (!run) {
    return '- UI 自动化状态：暂无最近 Actions/Allure 记录';
  }
  const mode = [run.targetRef, run.runMode].filter(Boolean).join(' / ');
  const link = run.artifactsUrl || run.runUrl || '';
  return `- UI 自动化状态：最近 ${run.conclusion || 'unknown'}${mode ? `（${mode}）` : ''}${link ? ` ${link}` : ''}`;
}

function formatTrendRadarSignal(trendIntel = {}) {
  const items = Array.isArray(trendIntel.learningRadar?.items) ? trendIntel.learningRadar.items : [];
  if (!items.length && !Number(trendIntel.total || 0)) {
    return ['- 开源学习雷达：暂无可用报告'];
  }
  const lines = [`- 开源学习雷达：${Number(trendIntel.total || items.length || 0)} 条`];
  const first = items[0] || {};
  if (first.projectName || first.title) {
    const nextStep = first.nextStep ? `，下一步：${first.nextStep}` : '';
    const usefulFor = first.usefulFor ? `，用途：${first.usefulFor}` : '';
    const link = first.link ? ` ${first.link}` : '';
    lines.push(`- 雷达首选：${first.projectName || first.title}${usefulFor}${nextStep}${link}`);
  }
  return lines;
}

function formatPipelineSignal(pipeline = {}) {
  if (!pipeline || (!pipeline.source?.task && !pipeline.source?.state && !pipeline.totalStages)) {
    return '- 每日流水线：暂无运行记录';
  }
  const parts = [];
  if (pipeline.day) parts.push(pipeline.day);
  if (pipeline.totalStages) parts.push(`${Number(pipeline.completedStages || 0)}/${Number(pipeline.totalStages || 0)} 阶段完成`);
  if (pipeline.failedStages) parts.push(`失败 ${pipeline.failedStages}`);
  const stageText = Array.isArray(pipeline.failedStageIds) && pipeline.failedStageIds.length
    ? `；失败阶段：${pipeline.failedStageIds.slice(0, 3).join('、')}`
    : '';
  return `- 每日流水线：${parts.join('，') || '已有记录'}${stageText}`;
}

function formatOpsEventSignals(opsEvents = {}) {
  const totals = opsEvents.totals || {};
  if (!Number(totals.total || 0)) {
    return ['- 运维事件：暂无可用记录'];
  }
  const lines = [
    `- 运维事件：${Number(totals.total || 0)} 条，失败 ${Number(totals.failed || 0)}，退化 ${Number(totals.degraded || 0)}`,
  ];
  const byModule = Object.entries(opsEvents.byModule || {})
    .sort(([, a], [, b]) => (
      Number(b.failed || 0) - Number(a.failed || 0)
      || Number(b.degraded || 0) - Number(a.degraded || 0)
      || Number(b.total || 0) - Number(a.total || 0)
    ))
    .slice(0, 3);
  if (byModule.length) {
    lines.push(`- 事件模块：${byModule.map(([name, row]) => `${name} ${row.total || 0} 条/失败 ${row.failed || 0}/退化 ${row.degraded || 0}`).join('；')}`);
  }
  const failures = Array.isArray(opsEvents.failureSamples) ? opsEvents.failureSamples : [];
  if (failures.length) {
    const first = failures[0];
    lines.push(`- 最近异常：${first.module || 'unknown'} ${first.event || 'unknown'} ${first.runId || ''}${first.reason ? `：${first.reason}` : ''}`.trim());
  }
  const slowest = Array.isArray(opsEvents.slowest) ? opsEvents.slowest : [];
  if (slowest.length) {
    const first = slowest[0];
    lines.push(`- 最慢事件：${first.module || 'unknown'} ${first.event || 'unknown'} ${first.runId || ''} ${Number(first.durationMs || 0)}ms`.trim());
  }
  return lines;
}

function formatProactiveThinkerSignals(proactiveThinker = {}) {
  if (!proactiveThinker || proactiveThinker.status === 'missing') {
    return ['- 主动思考器：暂无报告'];
  }
  const pendingCount = Number(proactiveThinker.pendingConfirmationCount || 0);
  const statusText = proactiveThinker.status === 'awaiting_confirmation'
    ? `待确认 ${pendingCount} 项`
    : proactiveThinker.status === 'completed'
      ? '已完成'
      : proactiveThinker.status || 'unknown';
  const lines = [`- 主动思考器：${statusText}${proactiveThinker.summary ? `，${proactiveThinker.summary}` : ''}`];
  const firstPending = Array.isArray(proactiveThinker.pendingConfirmations) ? proactiveThinker.pendingConfirmations[0] : null;
  if (firstPending?.title) {
    lines.push(`- 待确认首项：${firstPending.title}${firstPending.suggestedPrompt ? `；建议：${firstPending.suggestedPrompt}` : ''}`);
    lines.push('- 处理指令：文员，哪些需要我确认？');
  }
  if (proactiveThinker.reportPath) {
    lines.push(`- 主动思考报告：${proactiveThinker.reportPath}`);
  }
  return lines;
}

function buildClerkCommandCenterReply(options = {}) {
  const state = buildClerkCommandCenterState(options);
  const defaultNextActions = [
    '文员，发送今天日报到邮箱',
    '文员，查看失败任务',
    '文员，今天机器人发了哪些邮件',
    '文员，启动多 Agent 训练场',
  ];
  const enhancedSummaryText = state.tasks.todaySummaryText || state.tasks.todaySummary || '';
  const todaySummaryText = enhancedSummaryText || state.plan.todaySummaryText || '今天还没有可用任务摘要。';
  const enhancedTomorrowPlan = Array.isArray(state.tasks.tomorrowPlanText)
    ? state.tasks.tomorrowPlanText
    : (Array.isArray(state.tasks.tomorrowPlan) ? state.tasks.tomorrowPlan : []);
  const tomorrowPlanItems = enhancedTomorrowPlan.length
    ? enhancedTomorrowPlan
    : (state.plan.tomorrowPlan.length
      ? state.plan.tomorrowPlan
      : ['先查看任务中枢，确认今天要推进的主线。']);
  const blockers = Array.isArray(state.tasks.blockers) ? state.tasks.blockers : [];
  const historySummaryText = state.tasks.historySummaryText || '历史任务：暂无可用历史摘要。';
  const failureReviewText = state.tasks.failureReviewText || (blockers.length
    ? `失败复盘：${blockers.slice(0, 3).join('；')}`
    : '失败复盘：暂无明确失败项。');
  const failureRecommendations = Array.isArray(state.tasks.failureRecommendations)
    ? state.tasks.failureRecommendations
    : [];
  const nextActions = (Array.isArray(state.tasks.quickCommands) && state.tasks.quickCommands.length)
    ? state.tasks.quickCommands
    : defaultNextActions;

  return [
    '文员总控：今天一屏看懂。',
    '',
    '今日任务：',
    '今日总结：',
    todaySummaryText,
    formatTypeHighlights(state.tasks.byType),
    '',
    '历史任务：',
    historySummaryText,
    '',
    '失败复盘：',
    failureReviewText,
    ...(failureRecommendations.length ? failureRecommendations.slice(0, 3).map((item) => `- ${item}`) : []),
    '当前卡点：',
    ...(blockers.length ? blockers.map((item) => `- ${item}`) : ['- 暂无明确卡点，按计划推进。']),
    '',
    '下一步计划：',
    '明日计划：',
    ...tomorrowPlanItems.map((item) => `- ${item}`),
    '',
    '运行信号：',
    formatPipelineSignal(state.pipeline),
    ...(state.pipeline?.failureDiagnosis ? [`- ${state.pipeline.failureDiagnosis}`] : []),
    ...(state.pipeline?.nextAction ? [`- 下一步：${state.pipeline.nextAction}`] : []),
    formatUiAutomationSignal(state.snapshot.latestRun),
    `- ${state.snapshot.latestRun ? formatLatestRun(state.snapshot.latestRun) : '日报快照：暂无最近 run'}`,
    ...formatTrendRadarSignal(state.trendIntel),
    ...formatProactiveThinkerSignals(state.proactiveThinker),
    ...formatOpsEventSignals(state.opsEvents),
    `- 模型账本：${state.usage.entries.length ? `${state.usage.entries.length} 条，约 ${state.usage.totalTokens} tokens（真实 ${state.usage.realTokens} / 字符估算 ${state.usage.estimatedTokens}）` : '暂无可用记录'}`,
    `- 邮件流水：${state.mail.todayEntries.length ? `今天 ${state.mail.todayEntries.length} 条` : '暂无可用记录'}`,
    ...(state.warnings.length ? [`- 降级提示：${state.warnings.join('、')}`] : []),
    '',
    '可复制指令：',
    ...nextActions.map((item) => `- ${item}`),
  ].join('\n');
}

function loadDailySummaryArtifacts(env = process.env, options = {}) {
  const usageEntries = safeReadList(() => (options.readUsageLedger || defaultReadUsageLedger)(env));
  const snapshot = safeReadObject(() => (options.readDailySummarySnapshot || readDailySummarySnapshot)(env));
  return {
    runs: Array.isArray(snapshot.runs) ? snapshot.runs : [],
    usageEntries,
    multiAgentSummary: loadMultiAgentSummary(env, options),
  };
}

function buildClerkDailyReportReply(route = {}, options = {}) {
  const env = options.env || process.env;
  const artifacts = {
    ...loadDailySummaryArtifacts(env, options),
    recipientEmail: route.recipientEmail || '',
  };
  const summary = (options.buildDailySummary || buildDailySummary)(artifacts);
  const plan = safeReadObject(() => (options.summarizeDailyPlan || summarizeDailyPlan)({
    env,
    now: options.now || new Date(),
  }), {
    todaySummaryText: '今天还没有可用任务摘要。',
    tomorrowPlan: [],
  });
  const taskDigestReader = options.summarizeTaskCenterBrain
    || (!options.summarizeTasks ? summarizeTaskCenterBrain : null);
  const taskDigest = taskDigestReader
    ? safeReadObject(() => taskDigestReader({
      env,
      now: options.now || new Date(),
    }), {})
    : {};
  const executionLoop = taskDigest.executionLoop || {};
  const executionDailyReport = executionLoop.dailyReport || {};
  const mailEntries = safeReadList(() => (options.readMailLedger || defaultReadMailLedger)(env, 80));
  const mailSummary = summarizeMail(mailEntries, { env, now: options.now || new Date() });
  const usageSummary = summarizeUsage(artifacts.usageEntries || []);
  const executionPlan = Array.isArray(executionLoop.nextPlan) ? executionLoop.nextPlan : [];
  const pipeline = safeReadObject(() => (options.summarizeDailyPipeline || summarizeDailyPipeline)({
    env,
    now: options.now || new Date(),
  }), {});
  const pipelineNextAction = pipeline.nextAction ? [pipeline.nextAction] : [];
  const tomorrowPlan = [...(executionPlan.length
    ? executionPlan
    : (Array.isArray(plan.tomorrowPlan) ? plan.tomorrowPlan : [])), ...pipelineNextAction];
  const todaySummaryText = executionLoop.todayTask?.summaryText
    || executionDailyReport.summaryText
    || plan.todaySummaryText
    || '今天还没有可用任务摘要。';
  const failureLines = [
    executionLoop.failureReview
      || executionDailyReport.failureText
      || taskDigest.failureReview?.summaryText
      || (Array.isArray(taskDigest.failureReview?.items) && taskDigest.failureReview.items.length
      ? `失败任务 ${taskDigest.failureReview.items.length} 个。`
      : '暂无失败任务或失败诊断记录。'),
    pipeline.failureDiagnosis || '',
  ].filter(Boolean);
  const failureText = Array.from(new Set(failureLines)).join('\n');
  const quickCommands = Array.isArray(executionDailyReport.quickCommands)
    ? executionDailyReport.quickCommands
    : [];

  return [
    '文员日报预览：',
    '',
    '今日总结：',
    todaySummaryText,
    ...(executionLoop.currentStatus ? [`当前状态：${executionLoop.currentStatus}`] : []),
    '',
    '明日计划：',
    ...tomorrowPlan.map((item) => `- ${item}`),
    '',
    '失败诊断：',
    failureText,
    '',
    'token 消耗：',
    artifacts.usageEntries.length
      ? `调用 ${artifacts.usageEntries.length} 条，合计约 ${usageSummary.totalTokens} tokens（真实 ${usageSummary.realTokens} / 字符估算 ${usageSummary.estimatedTokens}）。`
      : '暂无模型账本记录。',
    '',
    '邮件归档：',
    formatMailArchiveSummary(mailSummary),
    ...(quickCommands.length ? [
      '',
      '快捷指令：',
      ...quickCommands.slice(0, 5).map((item) => `- ${item}`),
    ] : []),
    '',
    summary.text,
    '',
    '服务器部分仍建议只引用状态摘要，不在日报阶段执行修复。',
  ].join('\n');
}

module.exports = {
  buildClerkCommandCenterReply,
  buildClerkCommandCenterState,
  buildClerkDailyReportReply,
  loadDailySummaryArtifacts,
  summarizeProactiveThinker,
};
