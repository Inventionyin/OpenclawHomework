const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decideIntentRoute,
} = require('../scripts/agents/intent-decision');

test('decideIntentRoute returns null for no candidates', () => {
  assert.equal(decideIntentRoute([]), null);
});

test('decideIntentRoute chooses highest-score safe candidate', () => {
  const route = decideIntentRoute([
    {
      agent: 'clerk-agent',
      action: 'todo-summary',
      requiresAuth: true,
      evidence: ['todo'],
      score: 0.65,
      safety: 'safe',
      missing: [],
      params: {},
    },
    {
      agent: 'clerk-agent',
      action: 'token-summary',
      requiresAuth: true,
      evidence: ['token'],
      score: 0.82,
      safety: 'safe',
      missing: [],
      params: { dayRange: 'today' },
    },
  ]);

  assert.deepEqual(route, {
    agent: 'clerk-agent',
    action: 'token-summary',
    requiresAuth: true,
    dayRange: 'today',
  });
});

test('decideIntentRoute returns clarify for ambiguity among close safe candidates', () => {
  const route = decideIntentRoute([
    {
      agent: 'clerk-agent',
      action: 'todo-summary',
      requiresAuth: true,
      evidence: ['todo'],
      score: 0.78,
      safety: 'safe',
      missing: [],
      params: {},
    },
    {
      agent: 'clerk-agent',
      action: 'token-summary',
      requiresAuth: true,
      evidence: ['token'],
      score: 0.76,
      safety: 'safe',
      missing: [],
      params: {},
    },
  ]);

  assert.deepEqual(route, {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    reason: 'ambiguous_intent',
    missing: ['disambiguation'],
    requiresAuth: false,
  });
});

test('decideIntentRoute returns clarify when top candidate is dangerous', () => {
  const route = decideIntentRoute([
    {
      agent: 'ops-agent',
      action: 'restart',
      requiresAuth: true,
      evidence: ['restart'],
      score: 0.95,
      safety: 'blocked',
      missing: ['confirmation'],
      params: { target: 'self' },
    },
    {
      agent: 'clerk-agent',
      action: 'token-summary',
      requiresAuth: true,
      evidence: ['token'],
      score: 0.5,
      safety: 'safe',
      missing: [],
      params: {},
    },
  ]);

  assert.deepEqual(route, {
    agent: 'planner-agent',
    action: 'clarify',
    confidence: 'low',
    reason: 'dangerous_intent',
    missing: ['confirmation'],
    requiresAuth: false,
  });
});
