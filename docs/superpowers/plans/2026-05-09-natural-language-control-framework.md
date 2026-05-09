# Natural Language Control Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested natural-language control framework that makes Hermes/OpenClaw routing context-aware, safer, and less dependent on one-off regex patches.

**Architecture:** Add small CommonJS modules for candidate generation, decision making, and conversation hints. Integrate them conservatively into the existing router and Feishu bridge without replacing strong explicit routes.

**Tech Stack:** Node.js CommonJS, `node:test`, existing JSON memory files under `data/memory`.

---

### Task 1: Candidate Intent Layer

**Files:**
- Create: `scripts/agents/intent-candidates.js`
- Test: `tests/intent-candidates.test.js`

- [ ] Write tests for safe candidates, evidence, score ordering, negation, and dangerous markers.
- [ ] Verify tests fail because the module does not exist.
- [ ] Implement candidate definitions for token summary, todo summary, command center, trend intel, daily email, Dify testing, ops resource summary, ops clarify, and browser clarify.
- [ ] Export `collectIntentCandidates`, `normalizeIntentText`, and `hasDangerousIntentSignal`.
- [ ] Run `node --test tests/intent-candidates.test.js`.

### Task 2: Decision Layer

**Files:**
- Create: `scripts/agents/intent-decision.js`
- Test: `tests/intent-decision.test.js`

- [ ] Write tests for selecting high-score safe routes, clarifying ambiguous candidates, rejecting dangerous candidates, and returning fallback for no candidates.
- [ ] Verify tests fail because the module does not exist.
- [ ] Implement `decideIntentRoute`.
- [ ] Run `node --test tests/intent-decision.test.js`.

### Task 3: Context Hint Store

**Files:**
- Create: `scripts/agents/intent-context.js`
- Test: `tests/intent-context.test.js`

- [ ] Write tests for writing only route metadata, reading fresh hints, ignoring expired hints, tolerating corrupt JSON, and cap eviction.
- [ ] Verify tests fail because the module does not exist.
- [ ] Implement `buildConversationKey`, `readIntentContext`, `writeIntentContext`, `getFreshIntentHint`, and `routeFromContextHint`.
- [ ] Run `node --test tests/intent-context.test.js`.

### Task 4: Router Integration

**Files:**
- Modify: `scripts/agents/router.js`
- Test: `tests/router.test.js`

- [ ] Add golden route tests for context-like Chinese phrases and dangerous mixed intent phrases.
- [ ] Verify targeted router tests fail.
- [ ] Import the candidate and decision modules.
- [ ] Apply the framework only after strong direct rules and before final chat fallback.
- [ ] Run `node --test tests/router.test.js tests/intent-candidates.test.js tests/intent-decision.test.js`.

### Task 5: Feishu Context Integration

**Files:**
- Modify: `scripts/feishu-bridge.js`
- Test: `tests/feishu-bridge.test.js`

- [ ] Add tests proving fresh hints help weak follow-up messages, explicit commands ignore hints, expired/corrupt hints do not break routing, and successful routed replies write metadata.
- [ ] Verify targeted tests fail.
- [ ] Read context hints in `resolveAgentRoute` only when the rule route is weak.
- [ ] Write context metadata in `buildRoutedAgentReply` after successful non-chat non-clarify routes.
- [ ] Run `node --test tests/feishu-bridge.test.js tests/intent-context.test.js`.

### Task 6: Golden Cases and Verification

**Files:**
- Create: `tests/fixtures/intent-golden-cases.json`
- Test: `tests/intent-golden-cases.test.js`

- [ ] Add real user phrases with expected route outputs.
- [ ] Implement fixture-driven test.
- [ ] Run targeted tests.
- [ ] Run `npm test`.
- [ ] Commit with `feat: add natural language control framework`.

