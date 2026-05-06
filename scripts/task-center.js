const {
  createTask,
  listRecoverableTasks,
  listTasks,
  readTask,
  updateTask,
} = require('./background-task-store');

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
  const type = options.type || '';
  const statuses = Array.isArray(options.statuses) ? new Set(options.statuses) : null;
  const todayKey = toLocalDayKey(now, timezoneOffsetMinutes);
  return listTasks(env).filter((task) => {
    if (type && task.type !== type) return false;
    if (statuses && !statuses.has(task.status)) return false;
    const createdKey = toLocalDayKey(task.createdAt || task.updatedAt, timezoneOffsetMinutes);
    return createdKey === todayKey;
  });
}

function summarizeTasks(options = {}) {
  const env = options.env || process.env;
  const tasks = listTasks(env);
  const todayTasks = listTodayTasks(options);
  const counts = {
    total: tasks.length,
    today: todayTasks.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
    recoverable: listRecoverableTasks(env, {
      now: options.now || new Date(),
      staleMs: options.staleMs,
    }).length,
  };
  for (const task of tasks) {
    if (Object.prototype.hasOwnProperty.call(counts, task.status)) {
      counts[task.status] += 1;
    }
  }
  const latest = tasks[0] || null;
  return {
    counts,
    latest,
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

module.exports = {
  listFailedTasks,
  listTodayTasks,
  recordTaskEvent,
  summarizeTasks,
  toLocalDayKey,
};

