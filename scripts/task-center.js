const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  createTask,
  listRecoverableTasks,
  listTasks,
  readTask,
  updateTask,
} = require('./background-task-store');

const TYPE_LABELS = {
  'token-factory': 'token 工厂',
  'ui-automation': 'UI 自动化',
  'daily-digest': '主动日报',
  'news-digest': '新闻摘要',
  'token-lab': 'token 训练场',
  'daily-pipeline': '每日流水线',
  'trend-token-factory': '趋势 token 工厂',
};

function normalizeTaskType(type) {
  return String(type || '').trim();
}

function formatTaskType(type) {
  return TYPE_LABELS[normalizeTaskType(type)] || normalizeTaskType(type) || '未分类任务';
}

function filterTasks(tasks = [], options = {}) {
  const type = options.type || '';
  if (!type) {
    return tasks.slice();
  }
  const allowedTypes = Array.isArray(type) ? new Set(type.map(normalizeTaskType)) : new Set([normalizeTaskType(type)]);
  return tasks.filter((task) => allowedTypes.has(normalizeTaskType(task.type)));
}

function toLocalDayKey(input, timezoneOffsetMinutes = 480) {
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const shifted = new Date(date.getTime() + Number(timezoneOffsetMinutes || 0) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function listTodayTasks(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes ?? env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES ?? 480);
  const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
  const todayKey = toLocalDayKey(now, timezoneOffsetMinutes);
  return filterTasks(listTasks(env), options).filter((task) => {
    if (statuses && !statuses.has(task.status)) return false;
    const createdKey = toLocalDayKey(task.createdAt || task.updatedAt, timezoneOffsetMinutes);
    return createdKey === todayKey;
  });
}

function summarizeTasks(options = {}) {
  const env = options.env || process.env;
  const tasks = filterTasks(listTasks(env), options);
  const todayTasks = listTodayTasks(options);
  const recoverableTasks = listRecoverableTasks(env, {
    now: options.now || new Date(),
    staleMs: options.staleMs,
  }).filter((task) => {
    const type = options.type || '';
    if (!type) {
      return true;
    }
    const allowedTypes = Array.isArray(type) ? new Set(type.map(normalizeTaskType)) : new Set([normalizeTaskType(type)]);
    return allowedTypes.has(normalizeTaskType(task.type));
  });
  const counts = {
    total: tasks.length,
    today: todayTasks.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
    recoverable: recoverableTasks.length,
  };
  const byTypeMap = new Map();
  for (const task of tasks) {
    if (Object.prototype.hasOwnProperty.call(counts, task.status)) {
      counts[task.status] += 1;
    }
    const type = normalizeTaskType(task.type) || 'unknown';
    const current = byTypeMap.get(type) || {
      type,
      label: formatTaskType(type),
      total: 0,
      today: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
    };
    current.total += 1;
    if (todayTasks.some((item) => item.id === task.id)) {
      current.today += 1;
    }
    if (Object.prototype.hasOwnProperty.call(current, task.status)) {
      current[task.status] += 1;
    }
    byTypeMap.set(type, current);
  }
  const latest = tasks[0] || null;
  const byType = Array.from(byTypeMap.values())
    .sort((a, b) => (
      b.failed - a.failed
      || b.running - a.running
      || b.today - a.today
      || b.total - a.total
      || a.type.localeCompare(b.type)
    ));
  return {
    counts,
    byType,
    latest,
    recoverableTasks,
    todayTasks,
  };
}

function listFailedTasks(options = {}) {
  const env = options.env || process.env;
  const limit = Number(options.limit || 20);
  return listTasks(env)
    .filter((task) => task.status === 'failed')
    .slice(0, limit);
}

function getTaskTimestamp(task = {}) {
  return task.createdAt || task.updatedAt || '';
}

function listHistoricalTasks(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes ?? env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES ?? 480);
  const historyDays = Math.max(1, Number(options.historyDays || 7));
  const limit = Math.max(1, Number(options.limit || 50));
  const sinceMs = now.getTime() - historyDays * 24 * 60 * 60 * 1000;
  const tasks = filterTasks(listTasks(env), options)
    .map(normalizeTaskShape)
    .filter((task) => {
      const timestamp = Date.parse(getTaskTimestamp(task));
      return !Number.isFinite(timestamp) || timestamp >= sinceMs;
    })
    .slice(0, limit);
  const buckets = new Map();
  for (const task of tasks) {
    const day = toLocalDayKey(getTaskTimestamp(task), timezoneOffsetMinutes) || 'unknown';
    const bucket = buckets.get(day) || {
      day,
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
      unknown: 0,
      types: {},
      items: [],
    };
    bucket.total += 1;
    if (Object.prototype.hasOwnProperty.call(bucket, task.status)) {
      bucket[task.status] += 1;
    } else {
      bucket.unknown += 1;
    }
    const type = normalizeTaskType(task.type) || 'unknown';
    bucket.types[type] = (bucket.types[type] || 0) + 1;
    bucket.items.push(task);
    buckets.set(day, bucket);
  }
  const bucketList = Array.from(buckets.values())
    .sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;

  return {
    items: tasks,
    buckets: bucketList,
    historyDays,
    limit,
    summaryText: `近 ${historyDays} 天历史任务 ${tasks.length} 个，完成 ${completed} 个，失败 ${failed} 个。`,
  };
}

function normalizeFailureReason(task = {}) {
  const error = String(task.error || task.summary?.error || '').toLowerCase();
  if (!error.trim()) return 'unknown_failure';
  if (/(timeout|timed out|超时|rss|fetch|network|econn|socket)/i.test(error)) return 'network_timeout';
  if (/(quota|rate|limit|429|额度|限流|too many requests)/i.test(error)) return 'quota_or_rate_limit';
  if (/(auth|unauthorized|forbidden|permission|token|401|403|权限|未授权)/i.test(error)) return 'auth_or_permission';
  if (/(github|actions|runner|workflow|allure|playwright|cypress|ci)/i.test(error)) return 'ci_or_ui_runner';
  return 'other_failure';
}

function summarizeFailureReview(options = {}) {
  const env = options.env || process.env;
  const limit = Math.max(1, Number(options.limit || 20));
  const failed = filterTasks(listTasks(env), options)
    .map(normalizeTaskShape)
    .filter((task) => task.status === 'failed')
    .slice(0, limit);
  const byReasonMap = new Map();
  for (const task of failed) {
    const reason = normalizeFailureReason(task);
    const current = byReasonMap.get(reason) || {
      reason,
      count: 0,
      latestTaskId: '',
      examples: [],
    };
    current.count += 1;
    if (!current.latestTaskId) current.latestTaskId = task.id;
    if (current.examples.length < 3) {
      current.examples.push({
        id: task.id,
        type: task.type,
        error: task.error || '失败待复盘',
      });
    }
    byReasonMap.set(reason, current);
  }
  const byReason = Array.from(byReasonMap.values())
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const recommendations = [];
  if (byReason.some((row) => row.reason === 'network_timeout')) {
    recommendations.push('网络/RSS/接口超时：先确认数据源连通性，再加重试或降级源。');
  }
  if (byReason.some((row) => row.reason === 'quota_or_rate_limit')) {
    recommendations.push('额度/限流：检查 token 池自动切换和低价模型兜底。');
  }
  if (byReason.some((row) => row.reason === 'auth_or_permission')) {
    recommendations.push('权限问题：优先检查飞书绑定、GitHub token、邮箱 key 和服务器环境变量。');
  }
  if (byReason.some((row) => row.reason === 'ci_or_ui_runner')) {
    recommendations.push('CI/UI 失败：先打开 GitHub Actions 与 Allure/trace，再补一轮 smoke。');
  }
  if (!recommendations.length) {
    recommendations.push(failed.length ? '先查看最近失败任务日志，补充可复现线索后再重试。' : '暂无失败任务，保持每日流水线巡检。');
  }

  return {
    items: failed,
    byReason,
    latestFailure: failed[0] || null,
    recommendations,
    summaryText: failed.length
      ? `最近失败任务 ${failed.length} 个，主要原因：${byReason.slice(0, 3).map((row) => `${row.reason} ${row.count} 个`).join('，')}。`
      : '最近没有失败任务。',
  };
}

function buildNextStepPlan(options = {}) {
  const summary = options.summary || summarizeTasks(options);
  const todayTasks = (summary.todayTasks || []).map(normalizeTaskShape);
  const failureReview = options.failureReview || summarizeFailureReview(options);
  const recoverableItems = (summary.recoverableTasks || []).map(normalizeTaskShape);
  const activeTypes = new Set(todayTasks.map((task) => task.type));
  const items = [];

  if (failureReview.items?.length) {
    items.push(`优先复盘失败任务：${failureReview.items.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  if (recoverableItems.length) {
    items.push(`恢复可续跑任务：${recoverableItems.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  if (!activeTypes.has('ui-automation')) {
    items.push('补一轮 UI 自动化 contracts 或 smoke，并归档 Actions/Allure 链接。');
  }
  if (!activeTypes.has('daily-digest')) {
    items.push('生成今日总结并发送到 daily 邮箱归档。');
  }
  if (!activeTypes.has('news-digest')) {
    items.push('跑一次新闻摘要，验证实时 RSS 源和降级源。');
  }
  if (!items.length) {
    items.push('今日主线无明显阻塞，继续按定时流水线推进并记录复盘结论。');
  }

  const quickCommands = [
    failureReview.items?.length ? '文员，查看失败任务' : null,
    recoverableItems.length ? '文员，继续昨天 token-factory 任务' : null,
    '文员，启动今天的自动流水线',
    '文员，发送今天日报到邮箱',
  ].filter(Boolean);

  return {
    items,
    quickCommands,
  };
}

function buildExecutionLoopSummary(input = {}) {
  const today = input.today || {};
  const history = input.history || {};
  const failureReview = input.failureReview || {};
  const nextPlan = input.nextPlan || {};
  const todayTasks = Array.isArray(today.tasks) ? today.tasks : [];
  const failureItems = Array.isArray(failureReview.items) ? failureReview.items : [];
  const nextItems = Array.isArray(nextPlan.items) ? nextPlan.items : [];
  const quickCommands = Array.isArray(nextPlan.quickCommands) ? nextPlan.quickCommands : [];
  const counts = today.counts || {};
  const latestTask = todayTasks[0] || null;
  const currentStatus = [
    `完成 ${Number(counts.completed || 0)}`,
    `失败 ${Number(counts.failed || 0)}`,
    `运行中 ${Number(counts.running || 0)}`,
    `可恢复 ${Number(counts.recoverable || 0)}`,
  ].join('，');

  return {
    todayTask: {
      day: today.day || '',
      summaryText: today.summaryText || '今天还没有可用任务摘要。',
      latestTaskId: latestTask?.id || '',
      activeTaskCount: todayTasks.length,
    },
    currentStatus,
    history: history.summaryText || '暂无历史任务摘要。',
    failureReview: failureReview.summaryText || (failureItems.length
      ? `失败任务 ${failureItems.length} 个。`
      : '暂无失败任务。'),
    blockers: failureItems.slice(0, 5).map((task) => ({
      id: task.id,
      type: task.type,
      error: task.error || '失败待复盘',
    })),
    nextPlan: nextItems.length
      ? nextItems
      : ['先查看任务中枢，再按失败项、UI 自动化、日报归档推进。'],
    dailyReport: {
      summaryText: today.summaryText || '今天还没有可用任务摘要。',
      failureText: failureReview.summaryText || '暂无失败任务。',
      planItems: nextItems,
      quickCommands: quickCommands.length
        ? quickCommands
        : ['文员，发送今天日报到邮箱', '文员，查看失败任务'],
    },
  };
}

function recordTaskEvent(input = {}, options = {}) {
  const env = options.env || process.env;
  const now = input.now || options.now || new Date().toISOString();
  const event = String(input.event || 'updated');
  const taskId = String(input.taskId || '').trim();
  const status = input.status || event;
  const summaryPatch = input.summaryPatch && typeof input.summaryPatch === 'object' ? input.summaryPatch : {};
  const filesPatch = input.filesPatch && typeof input.filesPatch === 'object' ? input.filesPatch : {};
  const eventRow = {
    at: now,
    event,
    note: input.note || '',
  };

  let task = taskId ? readTask(taskId, env) : null;
  if (!task) {
    task = createTask({
      id: taskId || undefined,
      type: input.type || 'token-factory',
      status: status || 'queued',
      now,
      summary: summaryPatch,
      files: filesPatch,
      error: input.error || '',
    }, env);
  }

  const events = Array.isArray(task.events) ? task.events.slice() : [];
  events.push(eventRow);
  return updateTask(task.id, {
    status: status || task.status,
    summary: { ...(task.summary || {}), ...summaryPatch },
    files: { ...(task.files || {}), ...filesPatch },
    error: input.error !== undefined ? String(input.error || '') : task.error,
    events,
    updatedAt: now,
  }, env);
}

function summarizeDailyPlan(options = {}) {
  const summary = summarizeTasks(options);
  const todayTasks = summary.todayTasks || [];
  const failedTasks = todayTasks.filter((task) => task.status === 'failed');
  const runningTasks = todayTasks.filter((task) => task.status === 'running');
  const completedTasks = todayTasks.filter((task) => task.status === 'completed');
  const recoverableTasks = summary.recoverableTasks || [];
  const byType = summary.byType || [];

  const todaySummaryText = [
    `今天任务 ${summary.counts.today} 个，完成 ${completedTasks.length} 个，失败 ${failedTasks.length} 个，运行中 ${runningTasks.length} 个。`,
    byType.length
      ? `重点类型：${byType.slice(0, 3).map((row) => `${row.label} ${row.today || row.total} 个`).join('，')}。`
      : '今天还没有新的任务记录。',
  ].join('');

  const tomorrowPlan = [];
  if (failedTasks.length) {
    tomorrowPlan.push(`优先复盘失败任务：${failedTasks.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  if (recoverableTasks.length) {
    tomorrowPlan.push(`恢复中断或超时任务：${recoverableTasks.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  const hasUiWork = byType.some((row) => row.type === 'ui-automation');
  if (!hasUiWork || byType.find((row) => row.type === 'ui-automation')?.completed === 0) {
    tomorrowPlan.push('补一轮 UI 自动化冒烟或 contracts 任务，顺手归档 Allure/Actions 链接。');
  }
  if (!byType.some((row) => row.type === 'daily-digest')) {
    tomorrowPlan.push('让文员再出一版今日总结，确认日报和明日计划能稳定外发。');
  }
  if (!tomorrowPlan.length) {
    tomorrowPlan.push('延续当前节奏，继续补强主动任务覆盖和失败复盘。');
  }

  return {
    ...summary,
    todaySummaryText,
    tomorrowPlan,
  };
}

const PROACTIVE_TYPE_MAP = {
  proactive: ['token-factory', 'trend-token-factory', 'ui-automation', 'daily-digest', 'news-digest', 'token-lab'],
  news: ['news-digest'],
  ui: ['ui-automation'],
  token: ['token-factory', 'trend-token-factory', 'token-lab'],
  daily: ['daily-digest'],
};

function resolveProactiveTypes(input) {
  const seeds = Array.isArray(input) ? input : [];
  const resolved = new Set();
  for (const item of seeds) {
    const key = normalizeTaskType(item);
    if (!key) continue;
    if (PROACTIVE_TYPE_MAP[key]) {
      for (const type of PROACTIVE_TYPE_MAP[key]) {
        resolved.add(type);
      }
      continue;
    }
    resolved.add(key);
  }
  if (!resolved.size) {
    for (const type of PROACTIVE_TYPE_MAP.proactive) {
      resolved.add(type);
    }
  }
  return Array.from(resolved);
}

function normalizeTaskShape(task = {}) {
  const safeTask = task && typeof task === 'object' ? task : {};
  return {
    ...safeTask,
    id: String(safeTask.id || '').trim() || 'unknown-task',
    type: normalizeTaskType(safeTask.type) || 'unknown',
    status: String(safeTask.status || '').trim() || 'unknown',
    error: String(safeTask.error || ''),
  };
}

function readJsonObjectSafe(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { value: null, error: '' };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      value: parsed && typeof parsed === 'object' ? parsed : null,
      error: parsed && typeof parsed === 'object' ? '' : 'state_file_not_object',
    };
  } catch (error) {
    return { value: null, error: `state_file_unreadable: ${error.message}` };
  }
}

function getDailyPipelineStateFile(env = process.env, options = {}) {
  return options.stateFile
    || env.DAILY_AGENT_PIPELINE_STATE_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'daily-agent-pipeline-state.json');
}

function normalizeStageStatuses(stages = []) {
  if (!Array.isArray(stages)) return [];
  return stages
    .map((stage) => ({
      id: String(stage?.id || '').trim(),
      status: String(stage?.status || '').trim() || 'unknown',
      reason: String(stage?.reason || '').trim(),
    }))
    .filter((stage) => stage.id);
}

function parseStageIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function numberFromSources(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function findDailyPipelineTask(env = process.env, options = {}) {
  const day = String(options.day || '').trim();
  const candidates = listTasks(env)
    .filter((task) => normalizeTaskType(task.type) === 'daily-pipeline');
  if (!day) {
    return candidates[0] || null;
  }
  return candidates.find((task) => String(task.summary?.day || '').trim() === day)
    || candidates.find((task) => task.id === `daily-pipeline-${day}`)
    || null;
}

function buildPipelineFailureDiagnosis(summary) {
  const failedStageIds = Array.isArray(summary.failedStageIds) ? summary.failedStageIds : [];
  if (!failedStageIds.length && !summary.error) {
    return '';
  }
  const reasonById = new Map((summary.stageStatuses || [])
    .filter((stage) => failedStageIds.includes(stage.id))
    .map((stage) => [stage.id, stage.reason || '失败待复盘']));
  const stageText = failedStageIds
    .slice(0, 3)
    .map((id) => `${id}${reasonById.get(id) ? `：${reasonById.get(id)}` : ''}`)
    .join('，');
  const errorText = summary.error ? `；任务错误：${String(summary.error).slice(0, 300)}` : '';
  return `失败诊断：${stageText || '流水线任务失败'}${errorText}`;
}

function buildPipelineNextAction(summary) {
  const failedStageIds = Array.isArray(summary.failedStageIds) ? summary.failedStageIds : [];
  if (!summary.source?.task && !summary.source?.state) {
    return '尚无每日流水线运行记录，先说：文员，试跑今天的自动流水线。';
  }
  if (summary.failedStages > 0 || failedStageIds.length) {
    const target = failedStageIds.length ? failedStageIds.slice(0, 2).join('、') : '失败阶段';
    return `先修复 ${target}，再说：文员，启动今天的自动流水线。`;
  }
  if (summary.totalStages && summary.completedStages < summary.totalStages) {
    return '流水线阶段未跑满，先查看对应 systemd/journal 日志，再补跑今天的自动流水线。';
  }
  return '今天流水线已跑通，明天继续定时执行；想复盘可以说：文员，生成今日总结和明日计划。';
}

function summarizeDailyPipeline(options = {}) {
  const env = options.env || process.env;
  const taskSummary = summarizeTasks({
    ...options,
    env,
    type: 'daily-pipeline',
  });
  const task = findDailyPipelineTask(env, options) || taskSummary.latest || null;
  const stateFile = getDailyPipelineStateFile(env, options);
  const stateRead = readJsonObjectSafe(stateFile);
  const state = stateRead.value || null;
  const notes = [];
  if (stateRead.error) {
    notes.push(stateRead.error);
  }

  const stateStages = normalizeStageStatuses(state?.stageStatuses);
  const taskFailedStageIds = parseStageIds(task?.summary?.failedStageIds);
  const stateFailedStageIds = stateStages.length
    ? stateStages.filter((stage) => stage.status === 'failed').map((stage) => stage.id)
    : [];
  const failedStageIds = stateFailedStageIds.length
    ? parseStageIds(stateFailedStageIds)
    : taskFailedStageIds;

  const stateDay = String(state?.lastRunDay || '').trim();
  const taskDay = String(task?.summary?.day || '').trim();
  const day = stateDay || taskDay || String(options.day || '').trim();
  if (stateDay && taskDay && stateDay !== taskDay) {
    notes.push(`state_task_day_conflict: ${stateDay} != ${taskDay}`);
  }

  const summary = {
    ...taskSummary,
    day,
    lastRunAt: String(state?.lastRunAt || task?.updatedAt || task?.createdAt || '').trim(),
    taskId: task?.id || null,
    status: task?.status || '',
    totalStages: numberFromSources(state?.totalStages, task?.summary?.totalStages),
    completedStages: numberFromSources(state?.completedStages, task?.summary?.completedStages),
    failedStages: numberFromSources(state?.failedStages, task?.summary?.failedStages, failedStageIds.length),
    failedStageIds,
    stageStatuses: stateStages,
    source: {
      task: Boolean(task),
      state: Boolean(state),
    },
    stateFile,
    error: String(task?.error || ''),
    notes,
  };
  summary.failureDiagnosis = buildPipelineFailureDiagnosis(summary);
  summary.nextAction = buildPipelineNextAction(summary);
  return summary;
}

function summarizeTaskCenterDigest(options = {}) {
  const proactiveTypes = resolveProactiveTypes(options.proactiveTypes);
  const summary = summarizeTasks({ ...options, type: proactiveTypes });
  const todayTasks = (summary.todayTasks || []).map(normalizeTaskShape);
  const failedItems = todayTasks.filter((task) => task.status === 'failed');
  const recoverableItems = (summary.recoverableTasks || [])
    .map(normalizeTaskShape)
    .filter((task) => proactiveTypes.includes(task.type));
  const activeTypes = Array.from(new Set(
    todayTasks
      .filter((task) => proactiveTypes.includes(task.type))
      .map((task) => task.type),
  ));
  const todaySummary = summarizeDailyPlan({ ...options, type: proactiveTypes }).todaySummaryText;

  const tomorrowPlan = [];
  if (failedItems.length) {
    tomorrowPlan.push(`复盘失败任务 ${failedItems.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  if (recoverableItems.length) {
    tomorrowPlan.push(`优先恢复可续跑任务 ${recoverableItems.slice(0, 2).map((task) => `${formatTaskType(task.type)} ${task.id}`).join('、')}。`);
  }
  if (!activeTypes.includes('daily-digest')) {
    tomorrowPlan.push('补齐今日总结生成链路，确保日报稳定产出。');
  }
  if (!activeTypes.includes('news-digest')) {
    tomorrowPlan.push('安排一轮新闻摘要主动任务，验证数据源与重试机制。');
  }
  if (!tomorrowPlan.length) {
    tomorrowPlan.push('延续当前主动任务节奏，按类型轮询并记录复盘结论。');
  }

  const nextSuggestedActions = [];
  if (failedItems.length) {
    nextSuggestedActions.push('先处理 failedItems，优先修复可快速重试的问题。');
  }
  if (recoverableItems.length) {
    nextSuggestedActions.push('拉起 recoverableItems，补写中断原因和恢复结果。');
  }
  if (!nextSuggestedActions.length) {
    nextSuggestedActions.push('暂无阻塞项，按 tomorrowPlan 执行并保持任务类型覆盖。');
  }

  return {
    todaySummary,
    tomorrowPlan,
    activeTypes,
    failedItems,
    recoverableItems,
    nextSuggestedActions,
    summary,
  };
}

function summarizeTaskCenterBrain(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const timezoneOffsetMinutes = Number(options.timezoneOffsetMinutes ?? env.MAIL_LEDGER_TIMEZONE_OFFSET_MINUTES ?? 480);
  const proactiveTypes = resolveProactiveTypes(options.proactiveTypes);
  const baseOptions = {
    ...options,
    env,
    now,
    timezoneOffsetMinutes,
    type: proactiveTypes,
  };
  const summary = summarizeTasks(baseOptions);
  const dailyPlan = summarizeDailyPlan(baseOptions);
  const todayTasks = (summary.todayTasks || []).map(normalizeTaskShape);
  const history = listHistoricalTasks(baseOptions);
  const failureReview = summarizeFailureReview(baseOptions);
  const nextPlan = buildNextStepPlan({
    ...baseOptions,
    summary,
    failureReview,
  });
  const todayDay = toLocalDayKey(now, timezoneOffsetMinutes);

  const result = {
    today: {
      day: todayDay,
      summaryText: dailyPlan.todaySummaryText,
      counts: summary.counts,
      byType: summary.byType,
      tasks: todayTasks,
    },
    history,
    failureReview,
    nextPlan,
    meta: {
      generatedAt: now.toISOString(),
      timezoneOffsetMinutes,
      proactiveTypes,
      historyDays: history.historyDays,
    },
  };
  result.executionLoop = buildExecutionLoopSummary(result);
  return result;
}

module.exports = {
  buildNextStepPlan,
  formatTaskType,
  listFailedTasks,
  listHistoricalTasks,
  listTodayTasks,
  recordTaskEvent,
  summarizeDailyPlan,
  summarizeDailyPipeline,
  summarizeFailureReview,
  summarizeTaskCenterBrain,
  summarizeTaskCenterDigest,
  summarizeTasks,
  toLocalDayKey,
};
