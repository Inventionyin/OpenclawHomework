const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} = require('node:path');

const SECRET_PATTERNS = [
  /\bauthorization\b/i,
  /\bapi[_-]?key\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bpassword\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
];

function getFileChannelRoot(env = process.env) {
  return resolve(env.FILE_CHANNEL_ROOT || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'file-channel'));
}

function getFileChannelIndexPath(env = process.env) {
  const root = getFileChannelRoot(env);
  const rawIndexPath = env.FILE_CHANNEL_INDEX || join(root, 'incoming-files.json');
  const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : join(root, rawIndexPath);
  return assertInsideRoot(indexPath, root);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assertInsideRoot(candidatePath, root) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(candidatePath);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedPath;
  }
  throw new Error(`File path is outside file channel root: ${candidatePath}`);
}

function resolveSafeFilePath(inputPath, env = process.env) {
  const root = getFileChannelRoot(env);
  const rawPath = String(inputPath || '').trim();
  if (!rawPath) {
    throw new Error('File path is required');
  }

  const candidate = isAbsolute(rawPath)
    ? rawPath
    : join(root, rawPath);
  const safePath = assertInsideRoot(candidate, root);
  const relativePath = normalizeRelativePath(relative(root, safePath));
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(`File path is outside file channel root: ${inputPath}`);
  }

  return {
    root,
    safePath,
    relativePath,
  };
}

function readIndex(env = process.env) {
  const indexPath = getFileChannelIndexPath(env);
  if (!existsSync(indexPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(files, env = process.env) {
  const indexPath = getFileChannelIndexPath(env);
  ensureDir(getFileChannelRoot(env));
  ensureDir(dirname(indexPath));
  writeFileSync(indexPath, `${JSON.stringify(files, null, 2)}\n`, 'utf8');
}

function sanitizeId(value, fallback = `file-${Date.now()}`) {
  const id = String(value || '').trim();
  if (!id) return fallback;
  return id.replace(/[^\w:.-]/g, '-').slice(0, 120);
}

function looksSecretLike(key, value) {
  const joined = `${key || ''} ${value || ''}`;
  return SECRET_PATTERNS.some((pattern) => pattern.test(joined));
}

function redactSecrets(value, key = '') {
  if (value == null) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    return looksSecretLike(key, text) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, key));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSecrets(entryValue, entryKey),
    ]));
  }
  return '[redacted]';
}

function registerIncomingFile(input = {}, env = process.env) {
  const pathValue = input.path || input.relativePath || input.safePath || input.filePath;
  const resolved = resolveSafeFilePath(pathValue, env);
  const now = input.receivedAt || new Date().toISOString();
  const file = {
    id: sanitizeId(input.id),
    name: String(input.name || basename(resolved.safePath)).trim(),
    relativePath: resolved.relativePath,
    safePath: resolved.safePath,
    mimeType: String(input.mimeType || input.type || '').trim(),
    size: Number.isFinite(Number(input.size)) ? Number(input.size) : 0,
    source: String(input.source || 'external-bridge').trim(),
    receivedAt: now,
    metadata: redactSecrets(input.metadata || {}),
  };

  const files = readIndex(env).filter((item) => item.id !== file.id);
  files.push(file);
  files.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  writeIndex(files, env);
  return file;
}

function listRecentFiles(options = {}, env = process.env) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
  let files = readIndex(env)
    .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));

  if (options.id) {
    const id = String(options.id);
    files = files.filter((file) => file.id === id);
  }
  if (options.path) {
    const { relativePath } = resolveSafeFilePath(options.path, env);
    files = files.filter((file) => file.relativePath === relativePath);
  }

  return files.slice(0, limit).map((file) => ({
    ...file,
    metadata: redactSecrets(file.metadata || {}),
  }));
}

function formatMetadata(metadata = {}) {
  const sanitized = redactSecrets(metadata);
  const entries = Object.entries(sanitized)
    .filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return entries.length ? ['元数据：', ...entries] : [];
}

function buildFileChannelNotice(file = {}) {
  const relativePath = normalizeRelativePath(file.relativePath || file.path || '');
  const safeHint = relativePath ? `${relativePath}` : '(未登记路径)';
  return [
    '收到外部文件：',
    `- ID: ${sanitizeId(file.id, 'unknown')}`,
    `- 名称: ${file.name || basename(relativePath) || 'unknown'}`,
    `- 路径: ${safeHint}`,
    file.mimeType ? `- 类型: ${file.mimeType}` : '',
    file.size ? `- 大小: ${file.size} bytes` : '',
    ...formatMetadata(file.metadata || {}),
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildFileChannelNotice,
  getFileChannelIndexPath,
  getFileChannelRoot,
  listRecentFiles,
  redactSecrets,
  registerIncomingFile,
  resolveSafeFilePath,
};
