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
  summarizeDailyPlan,
  summarizeDailyPipeline,
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
  if (digest.todaySummary) {
    merged.todaySummaryText = digest.todaySummary;
  }
  if (Array.isArray(digest.tomorrowPlan) && digest.tomorrowPlan.length) {
    merged.tomorrowPlanText = digest.tomorrowPlan;
  }
  const blockers = formatDigestBlockers(digest);
  if (blockers.length) {
    merged.blockers = blockers;
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
  const digestReader = options.summarizeTaskCenterDigest || (!options.summarizeTasks ? summarizeTaskCenterDigest : null);
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
  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];

  return {
    env,
    plan: {
      ...plan,
      tomorrowPlan: Array.isArray(plan.tomorrowPlan) ? plan.tomorrowPlan : [],
      byType: Array.isArray(plan.byType) ? plan.byType : [],
      counts: plan.counts || {},
    },
    tasks: {
      ...mergeTaskDigest(tasks, taskDigest),
      byType: Array.isArray(tasks.byType) ? tasks.byType : [],
      counts: tasks.counts || {},
    },
    pipeline,
    usage: summarizeUsage(usageEntries),
    mail: summarizeMail(mailEntries, { env, now }),
    snapshot: {
      runs,
      latestRun: runs.at(-1) || null,
    },
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
  const nextActions = (Array.isArray(state.tasks.quickCommands) && state.tasks.quickCommands.length)
    ? state.tasks.quickCommands
    : defaultNextActions;

  return [
    '文员总控：今天一屏看懂。',
    '',
    '今日总结：',
    todaySummaryText,
    formatTypeHighlights(state.tasks.byType),
    '',
    '明日计划：',
    ...tomorrowPlanItems.map((item) => `- ${item}`),
    '',
    '当前卡点：',
    ...(blockers.length ? blockers.map((item) => `- ${item}`) : ['- 暂无明确卡点，按计划推进。']),
    '',
    '运行信号：',
    formatPipelineSignal(state.pipeline),
    ...(state.pipeline?.failureDiagnosis ? [`- ${state.pipeline.failureDiagnosis}`] : []),
    ...(state.pipeline?.nextAction ? [`- 下一步：${state.pipeline.nextAction}`] : []),
    `- ${state.snapshot.latestRun ? formatLatestRun(state.snapshot.latestRun) : '日报快照：暂无最近 run'}`,
    `- 模型账本：${state.usage.entries.length ? `${state.usage.entries.length} 条，约 ${state.usage.totalTokens} tokens` : '暂无可用记录'}`,
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
  const tomorrowPlan = Array.isArray(plan.tomorrowPlan) ? plan.tomorrowPlan : [];

  return [
    '文员日报预览：',
    plan.todaySummaryText || '今天还没有可用任务摘要。',
    ...tomorrowPlan.map((item) => `- ${item}`),
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
};
