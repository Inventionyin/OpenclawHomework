const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  buildAgentEvalTasks,
  buildCustomerServiceCases,
  buildEmailPlaybook,
  buildUiAutomationMatrix,
} = require('./qa-assets');
const {
  resolveMailboxAction,
} = require('./mailbox-action-router');
const {
  streamModelText,
} = require('./streaming-client');
const {
  appendUsageLedgerEntry,
  buildUsageLedgerEntry,
} = require('./usage-ledger');

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || '').trim());
  } catch {
    return null;
  }
}

function getMailboxActions(env = process.env) {
  return {
    archive: resolveMailboxAction('archive', env),
    eval: resolveMailboxAction('eval', env),
    report: resolveMailboxAction('report', env),
    support: resolveMailboxAction('support', env),
    verify: resolveMailboxAction('verify', env),
    files: resolveMailboxAction('files', env),
    daily: resolveMailboxAction('daily', env),
  };
}

function buildTokenLabPlan(options = {}) {
  const env = options.env || process.env;
  const batchSize = numberOrDefault(options.batchSize || env.QA_TOKEN_LAB_BATCH_SIZE, 12);
  const customerCases = buildCustomerServiceCases(Math.max(6, batchSize));
  const agentTasks = buildAgentEvalTasks(Math.max(6, batchSize));
  const uiMatrix = buildUiAutomationMatrix();
  const emailPlaybook = buildEmailPlaybook();
  const jobs = [];

  for (let index = 0; index < batchSize; index += 1) {
    const slot = index % 4;
    if (slot === 0) {
      const source = customerCases[index % customerCases.length];
      jobs.push({
        id: `lab-cs-${String(index + 1).padStart(3, '0')}`,
        kind: 'customer-service',
        modelTier: source.suggestedModelTier === 'thinking' ? 'thinking' : 'simple',
        mailboxAction: 'archive',
        source,
      });
    } else if (slot === 1) {
      const source = agentTasks[index % agentTasks.length];
      jobs.push({
        id: `lab-eval-${String(index + 1).padStart(3, '0')}`,
        kind: 'agent-eval',
        modelTier: source.modelTier === 'thinking' ? 'thinking' : 'chat',
        mailboxAction: 'eval',
        source,
      });
    } else if (slot === 2) {
      const source = uiMatrix[index % uiMatrix.length];
      jobs.push({
        id: `lab-ui-${String(index + 1).padStart(3, '0')}`,
        kind: 'ui-automation',
        modelTier: source.priority === 'P0' ? 'thinking' : 'chat',
        mailboxAction: source.mailboxAction || 'report',
        source,
      });
    } else {
      const source = emailPlaybook[index % emailPlaybook.length];
      jobs.push({
        id: `lab-mail-${String(index + 1).padStart(3, '0')}`,
        kind: 'mailbox-workflow',
        modelTier: 'simple',
        mailboxAction: source.actionName || 'archive',
        source,
      });
    }
  }

  return {
    createdAt: new Date().toISOString(),
    batchSize,
    jobs,
    mailboxActions: getMailboxActions(env),
  };
}

function buildTokenLabPrompt(job) {
  const source = job.source || {};
  return [
    '你是软件测试训练场里的 QA 数据生成与质检助手。',
    '请只输出一个 JSON 对象，不要 Markdown，不要解释，不要输出密钥、密码、token、真实订单号或真实个人信息。',
    '目标：把输入场景变成可用于训练/评测电商平台 AI 客服和 UI 自动化 Agent 的高质量样本。',
    '',
    `任务 ID：${job.id}`,
    `任务类型：${job.kind}`,
    `邮箱动作：${job.mailboxAction}`,
    '',
    '输入场景：',
    JSON.stringify(source, null, 2),
    '',
    'JSON 字段要求：',
    '- id：沿用任务 ID',
    '- category：训练类别',
    '- user_message：用户或测试人员会说的话',
    '- ideal_response：高质量回复或测试策略',
    '- labels：3 到 6 个标签',
    '- risk：low / medium / high',
    '- score：0 到 100 的自评质量分',
    '- checklist：3 到 6 个检查点',
    '- mailbox_action：建议归档邮箱动作',
    '',
    '评分标准：正确路由、无敏感信息、客服边界清楚、可转成测试用例、能沉淀到邮箱归档。',
    '不需要真实订单号；如果需要示例，使用 TEST-ORDER-001 这类假数据。',
  ].join('\n');
}

async function defaultModelRunner(prompt, job, options = {}) {
  return streamModelText(prompt, {
    ...(options.modelOptions || {}),
    env: options.env || process.env,
    modelTier: job.modelTier,
  });
}

function buildTokenLabReport(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const byKind = new Map();
  const byModel = new Map();
  let totalTokens = 0;
  let estimatedTotalTokens = 0;
  let scored = 0;
  let scoreTotal = 0;

  for (const item of rows) {
    const kind = item.job?.kind || 'unknown';
    const model = item.modelResult?.model || 'unknown';
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    byModel.set(model, (byModel.get(model) || 0) + 1);
    const ledger = buildUsageLedgerEntry({
      modelResult: item.modelResult,
      promptChars: item.promptChars,
      replyChars: item.replyChars,
    });
    totalTokens += Number(ledger.totalTokens || 0);
    estimatedTotalTokens += Number(ledger.estimatedTotalTokens || 0);
    const score = Number(item.parsed?.score);
    if (Number.isFinite(score)) {
      scored += 1;
      scoreTotal += score;
    }
  }

  const averageScore = scored ? Math.round(scoreTotal / scored) : 0;
  const kindText = Array.from(byKind.entries()).map(([kind, count]) => `${kind}:${count}`).join('，') || '无';
  const modelText = Array.from(byModel.entries()).map(([model, count]) => `${model}:${count}`).join('，') || '无';
  const text = [
    'QA Token Lab 训练场报告',
    `总任务：${rows.length}`,
    `任务分布：${kindText}`,
    `模型分布：${modelText}`,
    totalTokens
      ? `真实 token：${totalTokens}`
      : `真实 token：0，字符估算约 ${estimatedTotalTokens}`,
    estimatedTotalTokens && totalTokens
      ? `补充字符估算：约 ${estimatedTotalTokens}`
      : null,
    `平均自评分：${averageScore}`,
    '归档建议：客服/训练样本走 archive，Agent 评测走 eval，UI 自动化走 report/files。',
  ].filter(Boolean).join('\n');

  return {
    totalJobs: rows.length,
    byKind: Object.fromEntries(byKind.entries()),
    byModel: Object.fromEntries(byModel.entries()),
    totalTokens,
    estimatedTotalTokens,
    averageScore,
    text,
  };
}

function buildTokenLabEmailMessages(report, files, plan, env = process.env) {
  const actions = plan.mailboxActions || getMailboxActions(env);
  const wanted = ['archive', 'eval', 'report'].filter((actionName) => {
    const action = actions[actionName];
    return action?.enabled && action.mailbox;
  });

  return wanted.map((actionName) => {
    const action = actions[actionName];
    return {
      action: actionName,
      mailbox: action.mailbox,
      to: [action.mailbox],
      subject: `${action.subjectPrefix || '[QA Token Lab]'} 训练场报告 ${new Date().toISOString().slice(0, 10)}`,
      text: [
        report.text,
        '',
        `产物：${files.items}`,
        `报告：${files.report}`,
      ].join('\n'),
      html: [
        '<h2>QA Token Lab 训练场报告</h2>',
        `<pre>${report.text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</pre>`,
        `<p>产物：${files.items}</p>`,
        `<p>报告：${files.report}</p>`,
      ].join('\n'),
    };
  });
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function runTokenLab(options = {}) {
  const env = options.env || process.env;
  const outputDir = options.outputDir || join(process.cwd(), 'data', 'qa-token-lab');
  const plan = options.plan || buildTokenLabPlan({ ...options, env });
  const modelRunner = options.modelRunner || defaultModelRunner;
  const items = [];

  mkdirSync(outputDir, { recursive: true });
  for (const job of plan.jobs) {
    const prompt = buildTokenLabPrompt(job);
    const startedAt = Date.now();
    const modelResult = await modelRunner(prompt, job, { env, modelOptions: options.modelOptions });
    const elapsedMs = Date.now() - startedAt;
    const text = String(modelResult?.text || '');
    const parsed = safeJsonParse(text) || {
      id: job.id,
      raw: text,
      score: 0,
      risk: 'unknown',
      labels: [],
    };
    const item = {
      job,
      promptChars: prompt.length,
      replyChars: text.length,
      elapsedMs,
      modelResult,
      parsed,
    };
    items.push(item);
    appendUsageLedgerEntry(env, {
      assistant: options.assistant || 'Hermes',
      route: { agent: 'qa-token-lab', action: job.kind },
      modelResult,
      elapsedMs,
      modelElapsedMs: elapsedMs,
      promptChars: prompt.length,
      replyChars: text.length,
    });
  }

  const report = buildTokenLabReport(items);
  const files = {
    plan: join(outputDir, 'plan.json'),
    items: join(outputDir, 'items.json'),
    report: join(outputDir, 'report.md'),
  };
  writeJson(files.plan, plan);
  writeJson(files.items, items.map((item) => ({
    job: item.job,
    parsed: item.parsed,
    model: item.modelResult?.model,
    tier: item.modelResult?.tier || item.job.modelTier,
    usage: item.modelResult?.usage || null,
  })));
  writeFileSync(files.report, `# QA Token Lab\n\n${report.text}\n`, 'utf8');

  const messages = buildTokenLabEmailMessages(report, files, plan, env);
  if (options.emailSender) {
    for (const message of messages) {
      await options.emailSender(message, env);
    }
  }

  return {
    plan,
    items,
    report,
    files,
    emailMessages: messages,
  };
}

if (require.main === module) {
  runTokenLab({
    batchSize: process.argv.includes('--batch-size')
      ? process.argv[process.argv.indexOf('--batch-size') + 1]
      : undefined,
  }).then((result) => {
    console.log(JSON.stringify({
      totalJobs: result.report.totalJobs,
      totalTokens: result.report.totalTokens,
      estimatedTotalTokens: result.report.estimatedTotalTokens,
      files: result.files,
    }, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildTokenLabEmailMessages,
  buildTokenLabPlan,
  buildTokenLabPrompt,
  buildTokenLabReport,
  runTokenLab,
};
