const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildMemoryContext,
  buildMemorySearchContext,
  isSafeMemoryText,
  readJsonMemory,
  rememberMemoryNote,
  searchMemory,
} = require('../scripts/agents/memory-store');

test('readJsonMemory returns parsed JSON or fallback', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    const file = join(tempDir, 'profile.json');
    writeFileSync(file, '{"language":"zh-CN"}', 'utf8');
    assert.deepEqual(readJsonMemory(file, {}), { language: 'zh-CN' });
    assert.deepEqual(readJsonMemory(join(tempDir, 'missing.json'), { ok: true }), { ok: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('isSafeMemoryText rejects common secret patterns', () => {
  assert.equal(isSafeMemoryText('项目已经部署到两台服务器'), true);
  assert.equal(isSafeMemoryText('GITHUB_TOKEN=ghp_example'), false);
  assert.equal(isSafeMemoryText('password=abc123'), false);
  assert.equal(isSafeMemoryText('password: abc123'), false);
  assert.equal(isSafeMemoryText('App Secret: abc'), false);
  assert.equal(isSafeMemoryText('TOKEN: abc123'), false);
  assert.equal(isSafeMemoryText('secret: abc123'), false);
  assert.equal(isSafeMemoryText('API_KEY: abc123'), false);
  assert.equal(isSafeMemoryText('apikey: abc123'), false);
  assert.equal(isSafeMemoryText('GITHUB_TOKEN: abc123'), false);
  assert.equal(isSafeMemoryText('MY_TOKEN: abc123'), false);
  assert.equal(isSafeMemoryText('OPENAI_API_KEY: sk-test'), false);
  assert.equal(isSafeMemoryText('FEISHU_APP_SECRET: abc123'), false);
});

test('rememberMemoryNote appends safe notes only', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    const file = join(tempDir, 'notes.md');
    rememberMemoryNote(file, '今天修复了 session lock');
    assert.match(readFileSync(file, 'utf8'), /今天修复了 session lock/);
    assert.throws(() => rememberMemoryNote(file, 'GITHUB_TOKEN=ghp_example'), /Refusing to store secret-like memory/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryContext creates concise context from memory directory', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN","style":"直接"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"repository":"repo","capabilities":["UI tests"]}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\n## Fixed\nsession lock', 'utf8');

    const context = buildMemoryContext(tempDir);
    assert.match(context, /language/);
    assert.match(context, /UI tests/);
    assert.match(context, /session lock/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryContext redacts secret-like memory content', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN","password":"abc123"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"repository":"repo","capabilities":["UI tests"]}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\nTOKEN: abc123', 'utf8');
    writeFileSync(join(tempDir, 'runbook-notes.md'), 'safe note', 'utf8');

    const context = buildMemoryContext(tempDir);
    assert.match(context, /"redacted": true/);
    assert.match(context, /\[redacted secret-like memory content\]/);
    assert.doesNotMatch(context, /abc123/);
    assert.match(context, /safe note/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryContext redacts prefixed env-style secret labels', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"repository":"repo"}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\nGITHUB_TOKEN: abc123', 'utf8');

    const context = buildMemoryContext(tempDir);
    assert.match(context, /\[redacted secret-like memory content\]/);
    assert.doesNotMatch(context, /GITHUB_TOKEN: abc123/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('searchMemory returns safe keyword matches from memory files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"capabilities":["GitHub Actions UI 自动化"]}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\nsession lock 已通过串行队列修复', 'utf8');
    writeFileSync(join(tempDir, 'runbook-notes.md'), 'TOKEN: abc123', 'utf8');

    const matches = searchMemory('session lock', { memoryDir: tempDir });
    assert.equal(matches.length, 1);
    assert.match(matches[0].text, /串行队列/);
    assert.doesNotMatch(JSON.stringify(matches), /TOKEN|abc123/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemorySearchContext formats matches and empty state', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\n飞书重复消息由 receive_id 和重试导致', 'utf8');

    const found = buildMemorySearchContext('receive_id', { memoryDir: tempDir });
    assert.match(found, /记忆检索结果/);
    assert.match(found, /receive_id/);

    const missing = buildMemorySearchContext('不存在的关键词', { memoryDir: tempDir });
    assert.match(missing, /没有找到相关记忆/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
