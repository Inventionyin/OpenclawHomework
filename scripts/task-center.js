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
  proactive: ['token-factory', 'ui-automation', 'daily-digest', 'news-digest', 'token-lab'],
  news: ['news-digest'],
  ui: ['ui-automation'],
  token: ['token-factory', 'token-lab'],
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

module.exports = {
  formatTaskType,
  listFailedTasks,
  listTodayTasks,
  recordTaskEvent,
  summarizeDailyPlan,
  summarizeTaskCenterDigest,
  summarizeTasks,
  toLocalDayKey,
};
