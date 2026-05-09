const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

function getTaskDir(env = process.env) {
  return env.TOKEN_FACTORY_TASK_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'tasks', 'token-factory');
}

function createTaskId(now = new Date()) {
  return `tf-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function taskPath(id, env = process.env) {
  return join(getTaskDir(env), `${id}.json`);
}

function writeTask(task, env = process.env) {
  const dir = getTaskDir(env);
  ensureDir(dir);
  writeFileSync(taskPath(task.id, env), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return task;
}

function readTask(id, env = process.env) {
  const file = taskPath(id, env);
  if (!existsSync(file)) {
    return null;
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function createTask(input = {}, env = process.env) {
  const now = input.now || new Date().toISOString();
  return writeTask({
    id: input.id || createTaskId(new Date(now)),
    type: input.type || 'token-factory',
    status: input.status || 'queued',
    createdAt: now,
    updatedAt: now,
    summary: input.summary || {},
    files: input.files || {},
    error: input.error || '',
  }, env);
}

function updateTask(id, patch = {}, env = process.env) {
  const current = readTask(id, env);
  if (!current) {
    throw new Error(`Task not found: ${id}`);
  }
  return writeTask({
    ...current,
    ...patch,
    id,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  }, env);
}

function listTasks(env = process.env) {
  const dir = getTaskDir(env);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(dir, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function isStaleRunningTask(task, now = new Date(), staleMs = 30 * 60 * 1000) {
  if (task?.status !== 'running') {
    return false;
  }
  const updatedAt = Date.parse(task.updatedAt || task.createdAt || '');
  if (!Number.isFinite(updatedAt)) {
    return true;
  }
  return now.getTime() - updatedAt >= staleMs;
}

function normalizeRecoverableTypes(options = {}) {
  const rawTypes = options.types || options.recoverableTypes || ['token-factory'];
  const values = Array.isArray(rawTypes) ? rawTypes : String(rawTypes || '').split(',');
  return new Set(values
    .map((type) => String(type || '').trim())
    .filter(Boolean));
}

function listRecoverableTasks(env = process.env, options = {}) {
  const now = options.now || new Date();
  const staleMs = Number(options.staleMs || 30 * 60 * 1000);
  const allowedTypes = normalizeRecoverableTypes(options);
  return listTasks(env)
    .filter((task) => (
      allowedTypes.has(String(task.type || '').trim())
      && (
        task.status === 'queued'
        || task.status === 'interrupted'
        || isStaleRunningTask(task, now, staleMs)
      )
    ))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function getLatestTask(env = process.env) {
  return listTasks(env)[0] || null;
}

module.exports = {
  createTask,
  getLatestTask,
  getTaskDir,
  listRecoverableTasks,
  listTasks,
  readTask,
  updateTask,
};
