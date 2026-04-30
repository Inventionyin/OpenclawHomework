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
  isSafeMemoryText,
  readJsonMemory,
  readTextFile,
  rememberMemoryNote,
};
