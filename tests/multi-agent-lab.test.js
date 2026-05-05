const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  buildMultiAgentLabPlan,
  buildMultiAgentLabSummary,
  runMultiAgentLab,
} = require('../scripts/multi-agent-lab');

test('buildMultiAgentLabPlan creates generate review and summary rounds', () => {
  const plan = buildMultiAgentLabPlan({ batchSize: 3 });

  assert.equal(plan.rounds.length, 3);
  assert.deepEqual(plan.rounds.map((round) => round.kind), ['generate', 'review', 'summary']);
  assert.equal(plan.jobs.length, 3);
  assert.equal(plan.mailboxActions.archive.mailbox, 'agent3.archive@claw.163.com');
  assert.equal(plan.mailboxActions.eval.mailbox, 'hagent.eval@claw.163.com');
  assert.equal(plan.mailboxActions.report.mailbox, 'watchee.report@claw.163.com');
});

test('buildMultiAgentLabSummary compares winner and token totals', () => {
  const summary = buildMultiAgentLabSummary([
    {
      job: { id: 'job-1', kind: 'customer-service' },
      generateResult: { model: 'OpenClaw', usage: { total_tokens: 120 } },
      reviewResult: { model: 'Hermes', usage: { total_tokens: 90 } },
      generatePromptChars: 100,
      generateReplyChars: 50,
      reviewPromptChars: 120,
      reviewReplyChars: 40,
      winner: 'Hermes',
    },
    {
      job: { id: 'job-2', kind: 'ui-automation' },
      generateResult: { model: 'OpenClaw', usage: { total_tokens: 180 } },
      reviewResult: { model: 'Hermes', usage: { total_tokens: 110 } },
      generatePromptChars: 100,
      generateReplyChars: 60,
      reviewPromptChars: 120,
      reviewReplyChars: 50,
      winner: 'OpenClaw',
    },
  ]);

  assert.equal(summary.totalItems, 2);
  assert.equal(summary.totalTokens, 500);
  assert.equal(summary.winner, '平手');
  assert.match(summary.text, /OpenClaw/);
  assert.match(summary.text, /Hermes/);
});

test('runMultiAgentLab writes artifacts and routes archive eval and report emails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'multi-agent-lab-'));
  const sent = [];

  try {
    const result = await runMultiAgentLab({
      batchSize: 2,
      outputDir: tempDir,
      generateRunner: async (job) => ({
        text: JSON.stringify({
          id: job.id,
          candidate: `OpenClaw output for ${job.id}`,
          score: 82,
          labels: [job.kind],
        }),
        model: 'OpenClaw',
        usage: { total_tokens: 120 },
      }),
      reviewRunner: async (job, generated) => ({
        text: JSON.stringify({
          id: job.id,
          verdict: 'Hermes review',
          winner: generated.job.id.endsWith('1') ? 'Hermes' : 'OpenClaw',
          score: 91,
        }),
        model: 'Hermes',
        usage: { total_tokens: 80 },
      }),
      emailSender: async (message) => {
        sent.push(message.action);
        return { sent: true };
      },
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.summary.totalItems, 2);
  assert.equal(result.summary.totalTokens, 400);
  assert.equal(result.summary.failedJobs, 0);
  assert.equal(result.items[0].generateTier, 'chat');
  assert.equal(result.items[0].reviewTier, 'thinking');
  assert.equal(existsSync(result.files.plan), true);
  assert.equal(existsSync(result.files.items), true);
  assert.equal(existsSync(result.files.report), true);
    assert.deepEqual(sent, ['archive', 'eval', 'report']);
    assert.match(readFileSync(result.files.report, 'utf8'), /Multi-Agent Lab/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMultiAgentLab keeps producing artifacts when model calls fail', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'multi-agent-lab-failure-'));

  try {
    const result = await runMultiAgentLab({
      batchSize: 2,
      outputDir: tempDir,
      generateRunner: async () => {
        throw new Error('Missing streaming model config.');
      },
      reviewRunner: async () => {
        throw new Error('Hermes review timeout');
      },
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.summary.totalTokens, 0);
    assert.equal(result.summary.failedJobs, 2);
    assert(result.summary.estimatedTotalTokens > 0);
    assert.match(result.items[0].generateError, /Missing streaming model config/);
    assert.match(result.items[0].reviewError, /Hermes review timeout/);
    assert.match(readFileSync(result.files.report, 'utf8'), /失败样本：2/);
    assert.match(readFileSync(result.files.report, 'utf8'), /字符估算/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
