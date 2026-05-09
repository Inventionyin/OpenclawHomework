const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectIntentCandidates,
  normalizeIntentText,
  hasDangerousIntentSignal,
} = require('../scripts/agents/intent-candidates');

test('normalizeIntentText strips mention and normalizes spacing/case', () => {
  assert.equal(
    normalizeIntentText('  @OpenClaw   文员， 今天   还有 什么 没做  '),
    '文员， 今天 还有 什么 没做',
  );
});

test('hasDangerousIntentSignal detects restart/repair/cleanup/exec', () => {
  assert.equal(hasDangerousIntentSignal('重启一下服务'), true);
  assert.equal(hasDangerousIntentSignal('帮我 repair hermes'), true);
  assert.equal(hasDangerousIntentSignal('cleanup khoj'), true);
  assert.equal(hasDangerousIntentSignal('exec df -h'), true);
  assert.equal(hasDangerousIntentSignal('执行 df -h'), true);
  assert.equal(hasDangerousIntentSignal('执行 UI 自动化测试'), false);
  assert.equal(hasDangerousIntentSignal('整理今天待办'), false);
});

test('collectIntentCandidates returns normalized candidate shape with evidence and score ordering', () => {
  const candidates = collectIntentCandidates('文员，统计今天 token 用量并看下待办');
  assert.equal(Array.isArray(candidates), true);
  assert.ok(candidates.length >= 2);

  for (const candidate of candidates) {
    assert.equal(typeof candidate.agent, 'string');
    assert.equal(typeof candidate.action, 'string');
    assert.equal(typeof candidate.requiresAuth, 'boolean');
    assert.equal(Array.isArray(candidate.evidence), true);
    assert.equal(typeof candidate.score, 'number');
    assert.equal(typeof candidate.safety, 'string');
    assert.equal(Array.isArray(candidate.missing), true);
    assert.equal(typeof candidate.params, 'object');
  }

  assert.ok(candidates[0].score >= candidates[1].score);
  assert.ok(candidates.some((item) => item.action === 'token-summary'));
  assert.ok(candidates.some((item) => item.action === 'todo-summary'));
});

test('collectIntentCandidates handles negation and avoids test-run candidate', () => {
  const candidates = collectIntentCandidates('不要运行测试');
  assert.equal(candidates.some((item) => item.agent === 'ui-test-agent' && item.action === 'run'), false);
});

test('collectIntentCandidates marks dangerous candidates with blocked safety and missing confirmation', () => {
  const candidates = collectIntentCandidates('重启 Hermes 并统计 token 用量');
  const restart = candidates.find((item) => item.action === 'restart' || item.action === 'peer-repair');
  assert.ok(restart);
  assert.equal(restart.safety, 'blocked');
  assert.ok(restart.missing.includes('confirmation'));
});
