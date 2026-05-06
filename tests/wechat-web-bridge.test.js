const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildQrCodeResult,
  buildSendFileResult,
  buildSendResult,
  getBridgeStatus,
  getWechatBridgeConfig,
  writeJsonFile,
} = require('../scripts/wechat-web-bridge');

test('getWechatBridgeConfig returns isolated defaults', () => {
  const config = getWechatBridgeConfig({
    LOCAL_PROJECT_DIR: '/tmp/project',
    WECHAT_BRIDGE_PORT: '8790',
  });

  assert.equal(config.port, 8790);
  assert.match(config.sessionFile, /wechat-bridge/);
  assert.match(config.fileChannelRoot, /file-channel/);
  assert.equal(config.openclawWebhookUrl, 'http://127.0.0.1:8788/webhook/feishu');
});

test('getBridgeStatus reads persisted session state', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-bridge-status-'));
  try {
    const sessionFile = join(tempDir, 'session.json');
    writeJsonFile(sessionFile, {
      loggedIn: true,
      wxid: 'wx-test',
    });

    const status = getBridgeStatus({
      sessionFile,
      fileChannelRoot: join(tempDir, 'files'),
    });

    assert.equal(status.ok, true);
    assert.equal(status.loggedIn, true);
    assert.equal(status.wxid, 'wx-test');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildSendResult validates text messages and stays dry-run', () => {
  assert.deepEqual(buildSendResult({ text: 'hi' }), { ok: false, error: 'missing_to' });
  assert.deepEqual(buildSendResult({ to: 'wxid' }), { ok: false, error: 'missing_text' });

  const result = buildSendResult({ to: 'wxid', text: '你好' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.to, 'wxid');
  assert.match(result.message, /Playwright/);
});

test('buildSendFileResult registers file through file channel', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-bridge-file-'));
  const env = { FILE_CHANNEL_ROOT: tempDir };
  try {
    writeFileSync(join(tempDir, 'report.zip'), 'demo', 'utf8');
    const result = buildSendFileResult({
      to: 'wxid',
      path: 'report.zip',
      metadata: {
        token: 'sk-secretvalue123456',
        note: 'allure artifact',
      },
    }, env);

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.file.relativePath, 'report.zip');
    assert.match(result.notice, /allure artifact/);
    assert.doesNotMatch(result.notice, /sk-secretvalue123456/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildQrCodeResult reports qrcode placeholder or stored text', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-bridge-qrcode-'));
  try {
    const qrcodeFile = join(tempDir, 'qrcode.txt');
    writeFileSync(qrcodeFile, 'https://login.weixin.qq.com/qrcode/demo', 'utf8');
    const result = buildQrCodeResult({
      qrcodeFile,
      sessionFile: join(tempDir, 'session.json'),
    });

    assert.equal(result.ok, true);
    assert.match(result.qrcode, /login\.weixin/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
