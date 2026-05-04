const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const SECRET_PATTERNS = [
  /\bGITHUB_TOKEN\s*=/i,
  /\bghp_[A-Za-z0-9_]+/,
  /\bApp Secret\b/i,
  /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY)["']?\s*[:=]/i,
];

function readTextFile(filePath, fallback = '') {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return readFileSync(filePath, 'utf8');
}

function readJsonMemory(filePath, fallback = {}) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isSafeMemoryText(text) {
  const value = String(text ?? '');
  return !SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function rememberMemoryNote(filePath, note, now = new Date()) {
  if (!isSafeMemoryText(note)) {
    throw new Error('Refusing to store secret-like memory.');
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const existing = readTextFile(filePath, '# Runbook Notes\n');
  const entry = `\n## ${now.toISOString()}\n\n${String(note).trim()}\n`;
  writeFileSync(filePath, `${existing.trim()}\n${entry}`, 'utf8');
}

function stringifySafeJsonMemory(value) {
  const text = JSON.stringify(value, null, 2);
  if (!isSafeMemoryText(text)) {
    return JSON.stringify({ redacted: true }, null, 2);
  }
  return text;
}

function redactUnsafeTextMemory(text) {
  if (!isSafeMemoryText(text)) {
    return '[redacted secret-like memory content]';
  }
  return text;
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flattenJsonLines(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJsonLines(item, `${prefix}[${index}]`));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return flattenJsonLines(item, nextPrefix);
    });
  }

  return [`${prefix}: ${String(value ?? '')}`];
}

function readMemorySearchSources(memoryDir) {
  return [
    {
      file: 'user-profile.json',
      lines: flattenJsonLines(readJsonMemory(join(memoryDir, 'user-profile.json'), {})),
    },
    {
      file: 'project-state.json',
      lines: flattenJsonLines(readJsonMemory(join(memoryDir, 'project-state.json'), {})),
    },
    {
      file: 'incident-log.md',
      lines: readTextFile(join(memoryDir, 'incident-log.md'), '').split(/\r?\n/),
    },
    {
      file: 'runbook-notes.md',
      lines: readTextFile(join(memoryDir, 'runbook-notes.md'), '').split(/\r?\n/),
    },
  ];
}

function searchMemory(query, options = {}) {
  const memoryDir = options.memoryDir || join(process.cwd(), 'data', 'memory');
  const limit = Number(options.limit || 8);
  const terms = String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0 || !isSafeMemoryText(query)) {
    return [];
  }

  const termPatterns = terms.map((term) => new RegExp(escapeRegExp(term), 'i'));
  const matches = [];
  for (const source of readMemorySearchSources(memoryDir)) {
    source.lines.forEach((line, index) => {
      const text = String(line ?? '').trim();
      if (!text || !isSafeMemoryText(text)) {
        return;
      }

      if (termPatterns.every((pattern) => pattern.test(text))) {
        matches.push({
          file: source.file,
          line: index + 1,
          text,
        });
      }
    });
  }

  return matches.slice(0, limit);
}

function buildMemorySearchContext(query, options = {}) {
  const matches = searchMemory(query, options);
  if (matches.length === 0) {
    return `没有找到相关记忆：${String(query ?? '').trim()}`;
  }

  return [
    '# 记忆检索结果',
    '',
    ...matches.map((match) => `- ${match.file}:${match.line} ${match.text}`),
  ].join('\n');
}

function buildMemoryContext(memoryDir = join(process.cwd(), 'data', 'memory')) {
  const userProfile = readJsonMemory(join(memoryDir, 'user-profile.json'), {});
  const projectState = readJsonMemory(join(memoryDir, 'project-state.json'), {});
  const incidentLog = redactUnsafeTextMemory(readTextFile(join(memoryDir, 'incident-log.md'), '').slice(0, 2500));
  const runbookNotes = redactUnsafeTextMemory(readTextFile(join(memoryDir, 'runbook-notes.md'), '').slice(0, 1500));

  return [
    '# Memory Context',
    '',
    '## User Profile',
    stringifySafeJsonMemory(userProfile),
    '',
    '## Project State',
    stringifySafeJsonMemory(projectState),
    '',
    '## Incident Log',
    incidentLog,
    '',
    '## Runbook Notes',
    runbookNotes,
  ].join('\n').trim();
}

module.exports = {
  buildMemoryContext,
  buildMemorySearchContext,
  isSafeMemoryText,
  readJsonMemory,
  readTextFile,
  rememberMemoryNote,
  searchMemory,
};
