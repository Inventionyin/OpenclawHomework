const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { listRegistrationCandidateMailboxes } = require('./mailbox-inventory');
const { resolveMailboxAction } = require('./mailbox-action-router');

function platformRegistryPath() {
  return join(process.cwd(), 'data', 'platforms', 'platform-registry.json');
}

function loadPlatformRegistry() {
  const raw = JSON.parse(readFileSync(platformRegistryPath(), 'utf8'));
  return raw.platforms || {};
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function readOption(args, flag, fallback = '') {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return String(args[index + 1] || fallback).trim();
}

function parseCliArgs(args = process.argv.slice(2)) {
  return {
    platformId: readOption(args, '--platform', ''),
    mailboxHint: readOption(args, '--mailbox', ''),
  };
}

function parseRegistrationTaskRequest(text) {
  const normalized = normalizeText(text);
  const mailboxHint = /verify/.test(normalized) || /验证码|注册/.test(normalized)
    ? 'verify'
    : null;
  const platformId = /projectku-web|projectku/.test(normalized)
    ? 'projectku-web'
    : /taobao/.test(normalized)
      ? 'taobao'
      : null;

  return {
    intent: 'registration-verification',
    platformId,
    mailboxHint,
    rawText: text,
  };
}

function selectMailbox(mailboxHint, candidates = listRegistrationCandidateMailboxes()) {
  if (mailboxHint === 'verify') {
    const verifyMailbox = resolveMailboxAction('verify');
    if (verifyMailbox.enabled && verifyMailbox.mailbox) {
      return {
        email: verifyMailbox.mailbox,
        source: 'mailbox-action',
        role: 'verify',
      };
    }
    return candidates.find((item) => item.role === 'account') || candidates[0] || null;
  }
  return candidates[0] || null;
}

function buildRegistrationPlan({ platformId, mailboxHint }) {
  const registry = loadPlatformRegistry();
  const platform = registry[platformId];
  if (!platform || !platform.enabled || !['self-owned', 'sandbox', 'test-only'].includes(platform.policy)) {
    return {
      allowed: false,
      reason: '平台未在允许列表，或未声明为自有/测试/沙箱平台。',
      mode: 'blocked',
    };
  }

  const selectedMailbox = selectMailbox(mailboxHint);
  return {
    allowed: true,
    mode: 'dry-run',
    platformId: platform.platformId,
    selectedMailbox,
    steps: [
      `打开 ${platform.displayName} 注册页`,
      `使用 ${selectedMailbox.email} 填写注册邮箱`,
      '提交注册并等待验证码邮件',
      '从邮箱平台读取最新验证码',
      '填写验证码并继续完成注册',
      '保存截图、trace 和执行摘要',
      '把结果归档到 report/files/archive 对应邮箱动作',
    ],
  };
}

module.exports = {
  buildRegistrationPlan,
  loadPlatformRegistry,
  parseCliArgs,
  parseRegistrationTaskRequest,
};

if (require.main === module) {
  const cli = parseCliArgs();
  const plan = buildRegistrationPlan(cli);
  console.log(JSON.stringify(plan, null, 2));
}
