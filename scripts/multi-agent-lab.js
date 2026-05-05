const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  buildCustomerServiceCases,
  buildUiAutomationMatrix,
} = require('./qa-assets');
const {
  resolveMailboxAction,
} = require('./mailbox-action-router');
const {
  appendUsageLedgerEntry,
  buildUsageLedgerEntry,
} = require('./usage-ledger');
const {
  streamModelText,
} = require('./streaming-client');

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
  };
}

function buildMultiAgentLabPlan(options = {}) {
  const env = options.env || process.env;
  const batchSize = numberOrDefault(options.batchSize || env.MULTI_AGENT_LAB_BATCH_SIZE, 6);
  const customerCases = buildCustomerServiceCases(Math.max(6, batchSize));
  const uiMatrix = buildUiAutomationMatrix();
  const jobs = [];

  for (let index = 0; index < batchSize; index += 1) {
    const source = index % 2 === 0
      ? customerCases[index % customerCases.length]
      : uiMatrix[index % uiMatrix.length];
    jobs.push({
      id: `multi-agent-${String(index + 1).padStart(3, '0')}`,
      kind: index % 2 === 0 ? 'customer-service' : 'ui-automation',
      source,
    });
  }

  return {
    createdAt: new Date().toISOString(),
    batchSize,
    rounds: [
      { kind: 'generate', actor: 'OpenClaw' },
      { kind: 'review', actor: 'Hermes' },
      { kind: 'summary', actor: 'Clerk' },
    ],
    jobs,
    mailboxActions: getMailboxActions(env),
  };
}

function buildGeneratePrompt(job) {
  return [
    '你是 OpenClaw，负责先产出第一版测试资产。',
    '请只输出 JSON，不要 Markdown，不要解释。',
    `任务 ID：${job.id}`,
    `任务类型：${job.kind}`,
    '目标：围绕输入场景产出一个可评审的候选答案。',
    '输入场景：',
    JSON.stringify(job.source, null, 2),
    'JSON 字段：id, candidate, checklist, score, labels',
  ].join('\n');
}

function buildReviewPrompt(job, generated) {
  return [
    '你是 Hermes，负责评审 OpenClaw 的第一版答案。',
    '请只输出 JSON，不要 Markdown，不要解释。',
    `任务 ID：${job.id}`,
    `任务类型：${job.kind}`,
    '待评审内容：',
    JSON.stringify(generated, null, 2),
    'JSON 字段：id, verdict, winner, issues, score',
    'winner 只能是 OpenClaw、Hermes、平手 之一。',
  ].join('\n');
}

async function defaultGenerateRunner(job, prompt, options = {}) {
  return streamModelText(prompt, {
    env: options.env || process.env,
    modelTier: 'chat',
  });
}

async function defaultReviewRunner(job, generatedContext, prompt, options = {}) {
  return streamModelText(prompt, {
    env: options.env || process.env,
    modelTier: 'thinking',
  });
}

function sumUsageTokens(result) {
  return Number(result?.usage?.total_tokens || 0);
}

function buildMultiAgentLabSummary(items = []) {
  const rows = Array.isArray(items) ? items : [];
  let totalTokens = 0;
  let estimatedTotalTokens = 0;
  let failedJobs = 0;
  const wins = new Map([
    ['OpenClaw', 0],
    ['Hermes', 0],
    ['平手', 0],
  ]);

  for (const item of rows) {
    const generateLedger = buildUsageLedgerEntry({
      modelResult: item.generateResult,
      promptChars: item.generatePromptChars,
      replyChars: item.generateReplyChars,
    });
    const reviewLedger = buildUsageLedgerEntry({
      modelResult: item.reviewResult,
      promptChars: item.reviewPromptChars,
      replyChars: item.reviewReplyChars,
    });
    totalTokens += Number(generateLedger.totalTokens || 0) + Number(reviewLedger.totalTokens || 0);
    estimatedTotalTokens += Number(generateLedger.estimatedTotalTokens || 0) + Number(reviewLedger.estimatedTotalTokens || 0);
    if (item.generateError || item.reviewError) {
      failedJobs += 1;
    }
    const winner = item.winner || '平手';
    wins.set(winner, (wins.get(winner) || 0) + 1);
  }

  const openClawWins = wins.get('OpenClaw') || 0;
  const hermesWins = wins.get('Hermes') || 0;
  const finalWinner = openClawWins === hermesWins
    ? '平手'
    : openClawWins > hermesWins
      ? 'OpenClaw'
      : 'Hermes';

  const text = [
    'Multi-Agent Lab 训练场报告',
    `总样本：${rows.length}`,
    `失败样本：${failedJobs}`,
    totalTokens
      ? `真实 token：${totalTokens}`
      : `真实 token：0，字符估算约 ${estimatedTotalTokens}`,
    estimatedTotalTokens && totalTokens
      ? `补充字符估算：约 ${estimatedTotalTokens}`
      : null,
    `OpenClaw 胜场：${openClawWins}`,
    `Hermes 胜场：${hermesWins}`,
    `平手：${wins.get('平手') || 0}`,
    `当前赢家：${finalWinner}`,
  ].filter(Boolean).join('\n');

  return {
    totalItems: rows.length,
    failedJobs,
    totalTokens,
    estimatedTotalTokens,
    openClawWins,
    hermesWins,
    draws: wins.get('平手') || 0,
    winner: finalWinner,
    text,
  };
}

function buildEmailMessages(summary, files, plan, env = process.env) {
  const actions = plan.mailboxActions || getMailboxActions(env);
  return ['archive', 'eval', 'report']
    .filter((actionName) => actions[actionName]?.enabled && actions[actionName]?.mailbox)
    .map((actionName) => {
      const action = actions[actionName];
      return {
        action: actionName,
        mailbox: action.mailbox,
        to: [action.mailbox],
        subject: `${action.subjectPrefix || '[Multi-Agent Lab]'} 对打报告 ${new Date().toISOString().slice(0, 10)}`,
        text: [
          summary.text,
          '',
          `产物：${files.items}`,
          `报告：${files.report}`,
        ].join('\n'),
        html: [
          '<h2>Multi-Agent Lab 训练场报告</h2>',
          `<pre>${summary.text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</pre>`,
          `<p>产物：${files.items}</p>`,
          `<p>报告：${files.report}</p>`,
        ].join('\n'),
      };
    });
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function runMultiAgentLab(options = {}) {
  const env = options.env || process.env;
  const outputDir = options.outputDir || env.MULTI_AGENT_LAB_OUTPUT_DIR || join(process.cwd(), 'data', 'multi-agent-lab');
  const plan = options.plan || buildMultiAgentLabPlan({ ...options, env });
  const generateRunner = options.generateRunner || defaultGenerateRunner;
  const reviewRunner = options.reviewRunner || defaultReviewRunner;
  const items = [];

  mkdirSync(outputDir, { recursive: true });
  for (const job of plan.jobs) {
    const generatePrompt = buildGeneratePrompt(job);
    const generateStartedAt = Date.now();
    let generateResult;
    let generateError;
    try {
      generateResult = await generateRunner(job, generatePrompt, { env });
    } catch (caughtError) {
      generateError = caughtError;
      generateResult = {
        text: '',
        model: 'unavailable',
        tier: 'chat',
        endpoint: 'error',
      };
    }
    const generateElapsedMs = Date.now() - generateStartedAt;
    const generateText = String(generateResult?.text || '');
    const generated = generateError
      ? {
          id: job.id,
          candidate: '',
          checklist: [],
          score: 0,
          labels: [job.kind, 'generate-error'],
          error: String(generateError.message || generateError),
        }
      : safeJsonParse(generateText) || {
          id: job.id,
          candidate: generateText,
          checklist: [],
          score: 0,
          labels: [job.kind, 'raw-output'],
        };
    appendUsageLedgerEntry(env, {
      assistant: 'OpenClaw',
      route: { agent: 'multi-agent-lab', action: 'generate' },
      modelResult: generateResult,
      elapsedMs: generateElapsedMs,
      modelElapsedMs: generateElapsedMs,
      promptChars: generatePrompt.length,
      replyChars: generateText.length,
    });

    const reviewPrompt = buildReviewPrompt(job, generated);
    const reviewStartedAt = Date.now();
    let reviewResult;
    let reviewError;
    try {
      reviewResult = await reviewRunner(job, { job, generated, generateResult }, reviewPrompt, { env });
    } catch (caughtError) {
      reviewError = caughtError;
      reviewResult = {
        text: '',
        model: 'unavailable',
        tier: 'thinking',
        endpoint: 'error',
      };
    }
    const reviewElapsedMs = Date.now() - reviewStartedAt;
    const reviewText = String(reviewResult?.text || '');
    const reviewed = reviewError
      ? {
          id: job.id,
          verdict: String(reviewError.message || reviewError),
          winner: '平手',
          issues: ['review-error'],
          score: 0,
        }
      : safeJsonParse(reviewText) || {
          id: job.id,
          verdict: reviewText,
          winner: '平手',
          issues: [],
          score: 0,
        };
    appendUsageLedgerEntry(env, {
      assistant: 'Hermes',
      route: { agent: 'multi-agent-lab', action: 'review' },
      modelResult: reviewResult,
      elapsedMs: reviewElapsedMs,
      modelElapsedMs: reviewElapsedMs,
      promptChars: reviewPrompt.length,
      replyChars: reviewText.length,
    });

    items.push({
      job,
      generated,
      reviewed,
      generateResult,
      reviewResult,
      generatePromptChars: generatePrompt.length,
      generateReplyChars: generateText.length,
      reviewPromptChars: reviewPrompt.length,
      reviewReplyChars: reviewText.length,
      generateTier: generateResult?.tier || 'chat',
      reviewTier: reviewResult?.tier || 'thinking',
      winner: reviewed.winner || '平手',
      generateError: generateError ? String(generateError.message || generateError) : undefined,
      reviewError: reviewError ? String(reviewError.message || reviewError) : undefined,
    });
  }

  const summary = buildMultiAgentLabSummary(items);
  const files = {
    plan: join(outputDir, 'plan.json'),
    items: join(outputDir, 'items.json'),
    report: join(outputDir, 'report.md'),
  };
  writeJson(files.plan, plan);
  writeJson(files.items, items);
  writeFileSync(files.report, `# Multi-Agent Lab\n\n${summary.text}\n`, 'utf8');

  const emailMessages = buildEmailMessages(summary, files, plan, env);
  if (options.emailSender) {
    for (const message of emailMessages) {
      await options.emailSender(message, env);
    }
  }

  return {
    plan,
    items,
    summary,
    files,
    emailMessages,
  };
}

module.exports = {
  buildMultiAgentLabPlan,
  buildMultiAgentLabSummary,
  runMultiAgentLab,
};

if (require.main === module) {
  runMultiAgentLab({
    batchSize: process.argv.includes('--batch-size')
      ? process.argv[process.argv.indexOf('--batch-size') + 1]
      : undefined,
  }).then((result) => {
    console.log(JSON.stringify({
      totalItems: result.summary.totalItems,
      failedJobs: result.summary.failedJobs,
      totalTokens: result.summary.totalTokens,
      estimatedTotalTokens: result.summary.estimatedTotalTokens,
      winner: result.summary.winner,
      files: result.files,
    }, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
