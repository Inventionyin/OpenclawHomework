const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildFileChannelNotice,
  listRecentFiles,
  registerIncomingFile,
} = require('../scripts/file-channel');

test('registerIncomingFile stores metadata with a safe relative path', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'file-channel-'));
  const env = { FILE_CHANNEL_ROOT: tempDir };
  try {
    const file = registerIncomingFile({
      id: 'bridge-file-1',
      path: 'uploads/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      source: 'feishu-bridge',
      receivedAt: '2026-05-06T00:00:00.000Z',
    }, env);

    assert.equal(file.id, 'bridge-file-1');
    assert.equal(file.relativePath, 'uploads/report.pdf');
    assert.equal(file.safePath.endsWith('uploads\\report.pdf') || file.safePath.endsWith('uploads/report.pdf'), true);
    assert.equal(file.name, 'report.pdf');
    assert.equal(file.mimeType, 'application/pdf');
    assert.equal(file.size, 2048);
    assert.equal(file.source, 'feishu-bridge');

    const files = listRecentFiles({ limit: 5 }, env);
    assert.deepEqual(files.map((item) => item.id), ['bridge-file-1']);
    assert.equal(files[0].relativePath, 'uploads/report.pdf');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('registerIncomingFile rejects path traversal and root escapes', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'file-channel-safe-'));
  const env = { FILE_CHANNEL_ROOT: tempDir };
  try {
    assert.throws(
      () => registerIncomingFile({ id: 'bad-1', path: '../secret.txt' }, env),
      /outside file channel root/i,
    );

    assert.throws(
      () => registerIncomingFile({ id: 'bad-2', path: join(tempDir, '..', 'secret.txt') }, env),
      /outside file channel root/i,
    );

    assert.deepEqual(listRecentFiles({}, env), []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('registerIncomingFile rejects index files outside the configured root', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'file-channel-index-'));
  const env = {
    FILE_CHANNEL_ROOT: tempDir,
    FILE_CHANNEL_INDEX: join(tempDir, '..', 'incoming-files.json'),
  };
  try {
    assert.throws(
      () => registerIncomingFile({ id: 'bad-index', path: 'uploads/file.txt' }, env),
      /outside file channel root/i,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('listRecentFiles filters by id and path while keeping newest first', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'file-channel-list-'));
  const env = { FILE_CHANNEL_ROOT: tempDir };
  try {
    registerIncomingFile({
      id: 'older',
      path: 'uploads/older.txt',
      receivedAt: '2026-05-06T00:00:00.000Z',
    }, env);
    registerIncomingFile({
      id: 'newer',
      path: 'uploads/newer.txt',
      receivedAt: '2026-05-06T00:01:00.000Z',
    }, env);

    assert.deepEqual(listRecentFiles({ limit: 2 }, env).map((file) => file.id), ['newer', 'older']);
    assert.deepEqual(listRecentFiles({ id: 'older' }, env).map((file) => file.id), ['older']);
    assert.deepEqual(listRecentFiles({ path: 'uploads/newer.txt' }, env).map((file) => file.id), ['newer']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildFileChannelNotice reports safe path and redacts secret-like metadata', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'file-channel-notice-'));
  const env = { FILE_CHANNEL_ROOT: tempDir };
  try {
    const file = registerIncomingFile({
      id: 'notice-file',
      path: 'uploads/keys.txt',
      name: 'keys.txt',
      metadata: {
        token: 'sk-secretvalue123456',
        note: 'ordinary note',
      },
      receivedAt: '2026-05-06T00:00:00.000Z',
    }, env);

    const notice = buildFileChannelNotice(file);

    assert.match(notice, /notice-file/);
    assert.match(notice, /uploads\/keys\.txt/);
    assert.match(notice, /ordinary note/);
    assert.doesNotMatch(notice, /sk-secretvalue123456/);
    assert.match(notice, /\[redacted\]/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
