const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  buildTokenLabPlan,
  buildTokenLabPrompt,
  buildTokenLabReport,
  runTokenLab,
} = require('../scripts/qa-token-lab');

test('buildTokenLabPlan creates bounded high-token QA jobs with mailbox actions', () => {
  const plan = buildTokenLabPlan({ batchSize: 6 });

  assert.equal(plan.jobs.length, 6);
  assert(plan.jobs.some((job) => job.kind === 'customer-service'));
  assert(plan.jobs.some((job) => job.kind === 'agent-eval'));
  assert(plan.jobs.some((job) => job.kind === 'ui-automation'));
  assert(plan.jobs.every((job) => job.mailboxAction));
  assert.equal(plan.mailboxActions.archive.mailbox, 'agent3.archive@claw.163.com');
  assert.equal(plan.mailboxActions.eval.mailbox, 'hagent.eval@claw.163.com');
});

test('buildTokenLabPrompt asks for structured JSON without secrets', () => {
  const plan = buildTokenLabPlan({ batchSize: 1 });
  const prompt = buildTokenLabPrompt(plan.jobs[0]);

  assert.match(prompt, /JSON/);
  assert.match(prompt, /不需要真实订单号/);
  assert.match(prompt, /不要输出密钥/);
  assert.match(prompt, /评分/);
});

test('runTokenLab writes artifacts, usage ledger and mailbox digest', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'qa-token-lab-'));
  const ledgerPath = join(tempDir, 'usage.jsonl');
  const sentMessages = [];
  let modelCalls = 0;

  try {
    const result = await runTokenLab({
      batchSize: 3,
      outputDir: tempDir,
      env: {
        FEISHU_USAGE_LEDGER_ENABLED: 'true',
        FEISHU_USAGE_LEDGER_PATH: ledgerPath,
      },
      modelRunner: async (prompt, job) => {
        modelCalls += 1;
        return {
          text: JSON.stringify({
            id: job.id,
            reply: `客服回复 ${job.id}`,
            labels: [job.kind],
            score: 88,
            risk: 'low',
          }),
          model: job.modelTier === 'thinking' ? 'LongCat-Flash-Thinking-2601' : 'LongCat-Flash-Lite',
          tier: job.modelTier,
          endpoint: 'chat_completions',
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
      },
      emailSender: async (message) => {
        sentMessages.push(message);
        return { sent: true };
      },
    });

    assert.equal(modelCalls, 3);
    assert.equal(result.items.length, 3);
    assert.equal(result.report.totalJobs, 3);
    assert.equal(result.report.totalTokens, 450);
    assert.equal(existsSync(result.files.items), true);
    assert.equal(existsSync(result.files.report), true);
    assert.equal(readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).length, 3);
    assert(sentMessages.some((message) => message.action === 'archive'));
    assert(sentMessages.some((message) => message.action === 'eval'));
    assert.match(readFileSync(result.files.report, 'utf8'), /QA Token Lab/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildTokenLabReport summarizes estimated tokens when provider usage is missing', () => {
  const report = buildTokenLabReport([
    {
      job: { kind: 'customer-service', modelTier: 'flash-lite' },
      modelResult: { model: 'LongCat-Flash-Lite' },
      promptChars: 120,
      replyChars: 80,
      parsed: { score: 80 },
    },
  ]);

  assert.equal(report.totalJobs, 1);
  assert.equal(report.totalTokens, 0);
  assert.equal(report.estimatedTotalTokens, 100);
  assert.match(report.text, /字符估算/);
});
