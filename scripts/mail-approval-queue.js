const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  normalizeInboxMessage,
} = require('./mail-workbench');

const ACTION_NAMES = new Set(['approve', 'ignore', 'training-data']);

function getMailApprovalQueueFile(env = process.env) {
  return env.MAIL_APPROVAL_QUEUE_FILE
    || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'mailbox-approval-queue.json');
}

function readMailApprovalQueue(queueFile) {
  if (!queueFile || !existsSync(queueFile)) {
    return { items: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(queueFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return { items: [] };
    }
    return parsed;
  } catch {
    return { items: [] };
  }
}

function writeMailApprovalQueue(queue = {}, queueFile) {
  if (!queueFile) throw new Error('queue file is required');
  mkdirSync(dirname(queueFile), { recursive: true });
  const normalized = {
    updatedAt: queue.updatedAt || new Date().toISOString(),
    items: Array.isArray(queue.items) ? queue.items : [],
  };
  writeFileSync(queueFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function buildDraftText(item = {}) {
  const subject = String(item.subject || '你的来信');
  const preview = String(item.preview || '').trim();
  const hint = preview ? `你提到“${preview}”。` : '';
  if (item.category === 'after-sales') {
    return `你好，已收到你关于“${subject}”的反馈。${hint}我们会先核对订单与问题细节，再在 24 小时内给出处理方案。`;
  }
  if (item.category === 'recruitment') {
    return `你好，已收到你关于“${subject}”的来信。${hint}我们会先进行初步评估，若匹配会尽快联系你进入下一步。`;
  }
  if (item.category === 'customer-inquiry') {
    return `你好，已收到你关于“${subject}”的咨询。${hint}我们会尽快给你明确的处理建议。`;
  }
  return `你好，已收到你关于“${subject}”的来信。${hint}我们会尽快处理并回复你。`;
}

function buildApprovalQueueFromMessages(messages = [], options = {}) {
  const now = options.now || new Date().toISOString();
  const items = (Array.isArray(messages) ? messages : [])
    .map((raw) => normalizeInboxMessage(raw))
    .filter((item) => item.requiresApproval)
    .slice(0, 20)
    .map((item, index) => ({
      id: item.id,
      queueIndex: index + 1,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      category: item.category,
      label: item.label,
      from: item.from,
      subject: item.subject,
      reason: item.reason,
      preview: item.preview,
      draft: buildDraftText(item),
    }));
  return {
    updatedAt: now,
    items,
  };
}

function findPendingItemByIndex(items = [], index) {
  return items.find((item, itemIndex) => {
    const queueIndex = Number(item.queueIndex || (itemIndex + 1));
    return item.status === 'pending' && queueIndex === index;
  }) || null;
}

function toTrainingSample(item = {}, now = new Date().toISOString()) {
  return {
    createdAt: now,
    scene: item.category || 'unknown',
    role: 'customer-service',
    instruction: `处理一封${item.label || '待审批'}邮件，主题：${item.subject || '无主题'}`,
    user: item.preview || item.subject || '',
    answer: item.draft || '',
    tags: ['mailbox-approval', String(item.category || 'unknown')],
    source: {
      mailboxApprovalId: item.id || '',
      from: item.from || '',
      subject: item.subject || '',
    },
  };
}

function actionLabel(action) {
  if (action === 'approve') return '已审批';
  if (action === 'ignore') return '已忽略';
  if (action === 'training-data') return '已转训练数据';
  return '已处理';
}

function applyMailApprovalAction(input = {}, options = {}) {
  const action = String(input.action || '').trim();
  const index = Number(input.index);
  if (!ACTION_NAMES.has(action)) {
    return { ok: false, reply: '审批动作不支持。可用：approve / ignore / training-data。' };
  }
  if (!Number.isInteger(index) || index <= 0) {
    return { ok: false, reply: '审批序号无效，请说“审批第 1 封并发送”这类指令。' };
  }
  const queueFile = options.queueFile || getMailApprovalQueueFile(options.env || process.env);
  const queue = readMailApprovalQueue(queueFile);
  const items = Array.isArray(queue.items) ? queue.items.slice() : [];
  const target = findPendingItemByIndex(items, index);
  if (!target) {
    return { ok: false, reply: `没有找到第 ${index} 封待审批邮件。` };
  }
  const now = options.now || new Date().toISOString();
  const nextStatus = action === 'training-data' ? 'training_data' : action === 'approve' ? 'approved' : 'ignored';
  const updatedItems = items.map((item) => {
    if (item.id !== target.id) return item;
    return {
      ...item,
      status: nextStatus,
      updatedAt: now,
      action,
    };
  });
  const saved = writeMailApprovalQueue({
    updatedAt: now,
    items: updatedItems,
  }, queueFile);
  const savedTarget = saved.items.find((item) => item.id === target.id) || { ...target, status: nextStatus };
  const trainingSample = action === 'training-data' ? toTrainingSample(savedTarget, now) : null;
  const followUp = saved.items.filter((item) => item.status === 'pending').length;
  const baseReply = `${actionLabel(action)}第 ${index} 封：${savedTarget.subject || '无主题'}。剩余待审批 ${followUp} 封。`;
  if (action === 'approve') {
    return {
      ok: true,
      action,
      item: savedTarget,
      reply: `${baseReply}\n只生成已审批草稿，不会自动对外发信。`,
    };
  }
  if (action === 'training-data') {
    return {
      ok: true,
      action,
      item: savedTarget,
      trainingSample,
      reply: `${baseReply}\n已生成训练数据样本，可继续归档到 QA 资产。`,
    };
  }
  return {
    ok: true,
    action,
    item: savedTarget,
    reply: baseReply,
  };
}

module.exports = {
  applyMailApprovalAction,
  buildApprovalQueueFromMessages,
  getMailApprovalQueueFile,
  readMailApprovalQueue,
  writeMailApprovalQueue,
};
