# Natural Language Server Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add natural-language server inspection, restart, and repair flows plus more discoverable greeting/help replies for OpenClaw and Hermes.

**Architecture:** Extend the existing rules-first router with a deterministic natural-language ops branch, keep dangerous execution bounded to current whitelisted operations, and teach users the new phrases through upgraded greeting/help responders. Implement in small TDD slices so read-only summaries land before restart/repair language handling.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, existing `scripts/feishu-bridge.js`, `scripts/agents/router.js`, `scripts/agents/agent-handlers.js`.

---

## File Map

- Modify: `scripts/agents/router.js`
  - Add natural-language ops intent recognition, target detection, and confidence scoring.
- Modify: `scripts/agents/agent-handlers.js`
  - Extend ops replies to support friendly summary formatting and confirmation prompts.
- Modify: `scripts/feishu-bridge.js`
  - Add summary helpers, route high-confidence natural-language ops through existing execution paths, and upgrade greeting/help copy.
- Modify: `tests/router.test.js`
  - Cover natural-language query, restart, repair, typo, alias, and ambiguity routing.
- Modify: `tests/agent-handlers.test.js`
  - Cover summary rendering and medium/low-confidence reply behavior.
- Modify: `tests/feishu-bridge.test.js`
  - Cover greeting/help examples and end-to-end natural-language ops handling through the webhook server.
- Modify: `docs/飞书桥梁服务使用说明.md`
  - Document the new natural-language phrases.

## Task 1: Add router coverage for natural-language read-only queries

**Files:**
- Modify: `tests/router.test.js`
- Modify: `scripts/agents/router.js`

- [ ] **Step 1: Write the failing router tests for read-only natural-language ops**

Add tests like:

```javascript
test('routeAgentIntent routes natural-language self server queries', () => {
  assert.deepEqual(routeAgentIntent('你现在内存多少'), {
    agent: 'ops-agent',
    action: 'memory-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'disk-summary',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('你现在卡不卡'), {
    agent: 'ops-agent',
    action: 'load-summary',
    target: 'self',
    confidence: 'medium',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes natural-language peer server queries', () => {
  assert.deepEqual(routeAgentIntent('看看 Hermes 的服务器状态'), {
    agent: 'ops-agent',
    action: 'peer-status',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('OpenClaw 硬盘还剩多少'), {
    agent: 'ops-agent',
    action: 'peer-disk-summary',
    target: 'openclaw',
    confidence: 'high',
    requiresAuth: true,
  });
});
```

- [ ] **Step 2: Run the router tests to verify they fail**

Run: `node --test tests/router.test.js`

Expected: FAIL because `routeAgentIntent` currently falls back to `chat-agent` for these phrases.

- [ ] **Step 3: Implement minimal natural-language query routing**

Update `scripts/agents/router.js` to:

- normalize bot aliases such as `open claw`
- recognize self-query phrases like memory, disk, status, load
- recognize peer-query phrases with explicit `Hermes` or `OpenClaw`
- return `confidence` on natural-language ops routes

Keep slash command handling unchanged.

- [ ] **Step 4: Run the router tests to verify they pass**

Run: `node --test tests/router.test.js`

Expected: PASS for the new read-only natural-language cases.

## Task 2: Add router coverage for restart, repair, and ambiguity

**Files:**
- Modify: `tests/router.test.js`
- Modify: `scripts/agents/router.js`

- [ ] **Step 1: Write the failing router tests for restart, repair, and ambiguity**

Add tests like:

```javascript
test('routeAgentIntent routes high-confidence restart and repair requests', () => {
  assert.deepEqual(routeAgentIntent('重启你自己'), {
    agent: 'ops-agent',
    action: 'restart',
    target: 'self',
    confidence: 'high',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('修复 Hermes'), {
    agent: 'ops-agent',
    action: 'peer-repair',
    target: 'hermes',
    confidence: 'high',
    requiresAuth: true,
  });
});

test('routeAgentIntent marks ambiguous dangerous ops as medium or low confidence', () => {
  assert.deepEqual(routeAgentIntent('你重起一下'), {
    agent: 'ops-agent',
    action: 'restart',
    target: 'self',
    confidence: 'medium',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('那个你帮我搞一下'), {
    agent: 'ops-agent',
    action: 'clarify',
    target: 'unknown',
    confidence: 'low',
    requiresAuth: true,
  });
});
```

- [ ] **Step 2: Run the router tests to verify they fail**

Run: `node --test tests/router.test.js`

Expected: FAIL because dangerous natural-language actions are not recognized yet.

- [ ] **Step 3: Implement minimal restart/repair routing with typo tolerance**

Update `scripts/agents/router.js` to:

- normalize `重起` to `重启`
- detect self vs peer target
- route exact restart/repair phrases at `high`
- route typo-heavy or incomplete dangerous phrases at `medium`
- route vague requests to a low-confidence clarify action

- [ ] **Step 4: Run the router tests to verify they pass**

Run: `node --test tests/router.test.js`

Expected: PASS for the new dangerous-action routing cases.

## Task 3: Add ops reply behavior tests for summaries and clarification

**Files:**
- Modify: `tests/agent-handlers.test.js`
- Modify: `scripts/agents/agent-handlers.js`

- [ ] **Step 1: Write the failing ops handler tests**

Add tests like:

```javascript
test('buildOpsAgentReply renders friendly summary replies', async () => {
  const reply = await buildOpsAgentReply({
    action: 'memory-summary',
    target: 'self',
    confidence: 'high',
  }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234',
      memory: { total: '8G', used: '3.1G', free: '4.9G' },
    }),
  });

  assert.match(reply, /我这台服务器目前正常/);
  assert.match(reply, /内存：8G 总量/);
});

test('buildOpsAgentReply asks for clarification on medium-confidence dangerous ops', async () => {
  const reply = await buildOpsAgentReply({
    action: 'restart',
    target: 'self',
    confidence: 'medium',
    originalText: '你重起一下',
  });

  assert.match(reply, /你是想让我重启/);
});

test('buildOpsAgentReply guides on low-confidence ops requests', async () => {
  const reply = await buildOpsAgentReply({
    action: 'clarify',
    target: 'unknown',
    confidence: 'low',
  });

  assert.match(reply, /我没完全听懂/);
  assert.match(reply, /你现在内存多少/);
});
```

- [ ] **Step 2: Run the ops handler tests to verify they fail**

Run: `node --test tests/agent-handlers.test.js`

Expected: FAIL because summary rendering and clarification behavior do not exist yet.

- [ ] **Step 3: Implement minimal summary and clarification reply logic**

Update `scripts/agents/agent-handlers.js` to:

- recognize `confidence`
- short-circuit medium-confidence dangerous routes with a clarification reply
- short-circuit low-confidence routes with guided examples
- render friendly summary wording for summary-shaped results

- [ ] **Step 4: Run the ops handler tests to verify they pass**

Run: `node --test tests/agent-handlers.test.js`

Expected: PASS for the new summary and clarification cases.

## Task 4: Add friendly server summary helpers and greeting/help tests

**Files:**
- Modify: `tests/feishu-bridge.test.js`
- Modify: `scripts/feishu-bridge.js`

- [ ] **Step 1: Write the failing tests for greeting, help, and summary helpers**

Add tests like:

```javascript
test('parseSmallTalkMessage greeting advertises natural-language examples', () => {
  const reply = parseSmallTalkMessage('你好');
  assert.match(reply, /你现在内存多少/);
  assert.match(reply, /重启你自己/);
});

test('buildHelpReply includes categorized natural-language examples', () => {
  const reply = buildHelpReply();
  assert.match(reply, /看我自己/);
  assert.match(reply, /看对方/);
  assert.match(reply, /修复 OpenClaw/);
});

test('runLocalOpsAction returns summary data for memory and disk views', async () => {
  const result = await runLocalOpsAction('memory-summary', {}, {
    execFile: async (command, args) => {
      if (command === 'bash' && args[1].includes('free -h')) return 'Mem: 8G 3.1G 4.9G';
      if (command === 'systemctl') return 'active\n';
      if (command === 'git') return 'abc1234\n';
      return '';
    },
    fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
  });

  assert.equal(result.memory.total, '8G');
});
```

- [ ] **Step 2: Run the Feishu bridge tests to verify they fail**

Run: `node --test tests/feishu-bridge.test.js`

Expected: FAIL because the natural-language help copy and summary-shaped ops data do not exist yet.

- [ ] **Step 3: Implement minimal summary helpers and upgraded help copy**

Update `scripts/feishu-bridge.js` to:

- expand greeting/help text with categorized examples
- add helper functions to collect memory, disk, and load summaries
- allow `runLocalOpsAction` to return structured summary objects for `memory-summary`, `disk-summary`, `load-summary`, `peer-memory-summary`, `peer-disk-summary`, and `peer-load-summary`

- [ ] **Step 4: Run the Feishu bridge tests to verify they pass**

Run: `node --test tests/feishu-bridge.test.js`

Expected: PASS for the new helper and help-copy cases.

## Task 5: Wire natural-language ops through webhook routing

**Files:**
- Modify: `tests/feishu-bridge.test.js`
- Modify: `scripts/feishu-bridge.js`

- [ ] **Step 1: Write the failing end-to-end webhook tests**

Add tests like:

```javascript
test('createServer routes natural-language memory query to local ops runner', async () => {
  let received;
  let reply;
  const server = createServer({
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_ALLOWED_USER_IDS: 'user-a',
    FEISHU_RESULT_NOTIFY_ENABLED: 'true',
  }, {
    runOpsCheck: async (action, route) => {
      received = `${action}:${route.target}:${route.confidence}`;
      return {
        service: 'openclaw-feishu-bridge',
        active: 'active',
        health: '{"ok":true}',
        watchdog: 'active',
        commit: 'abc1234',
        memory: { total: '8G', used: '3.1G', free: '4.9G' },
      };
    },
    receiptSender: async (message) => { reply = message; },
  });
  // send "你现在内存多少"
  assert.equal(received, 'memory-summary:self:high');
  assert.match(JSON.parse(reply.content).text, /内存：8G 总量/);
});

test('createServer does not execute medium-confidence restart requests', async () => {
  let called = false;
  let reply;
  const server = createServer({
    FEISHU_WEBHOOK_ASYNC: 'true',
    FEISHU_ALLOWED_USER_IDS: 'user-a',
  }, {
    runOpsCheck: async () => {
      called = true;
      return {};
    },
    receiptSender: async (message) => { reply = message; },
  });
  // send "你重起一下"
  assert.equal(called, false);
  assert.match(JSON.parse(reply.content).text, /你是想让我重启/);
});
```

- [ ] **Step 2: Run the Feishu bridge tests to verify they fail**

Run: `node --test tests/feishu-bridge.test.js`

Expected: FAIL because natural-language ops are not wired through the webhook routing path yet.

- [ ] **Step 3: Implement minimal end-to-end routing behavior**

Update `scripts/feishu-bridge.js` to:

- send natural-language ops routes into `buildRoutedAgentReply`
- execute only high-confidence dangerous actions
- return clarification/help text for medium/low-confidence dangerous routes without calling the executor
- keep authorization rules unchanged

- [ ] **Step 4: Run the Feishu bridge tests to verify they pass**

Run: `node --test tests/feishu-bridge.test.js`

Expected: PASS for the end-to-end natural-language routing cases.

## Task 6: Update docs and run full verification

**Files:**
- Modify: `docs/飞书桥梁服务使用说明.md`
- Modify: `docs/最终演示验收.md` (only if help examples are referenced there)

- [ ] **Step 1: Add the new natural-language examples to the usage docs**

Document:

- `你好`
- `帮助`
- `你现在内存多少`
- `看看 Hermes 的服务器状态`
- `重启你自己`
- `修复 OpenClaw`

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run whitespace diff check**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Commit the implementation**

```bash
git add scripts/agents/router.js scripts/agents/agent-handlers.js scripts/feishu-bridge.js tests/router.test.js tests/agent-handlers.test.js tests/feishu-bridge.test.js docs/飞书桥梁服务使用说明.md docs/superpowers/specs/2026-05-04-natural-language-server-ops-design.md docs/superpowers/plans/2026-05-04-natural-language-server-ops.md
git commit -m "Add natural language server ops flows"
```

- [ ] **Step 5: Deploy to both servers**

Run on both servers:

```bash
cd /opt/OpenclawHomework
git fetch origin
git pull --ff-only origin main
npm test
systemctl restart openclaw-feishu-bridge || systemctl restart hermes-feishu-bridge
```

## Self-Review

- Spec coverage: this plan covers greeting/help discoverability, natural-language read-only queries, natural-language restart/repair, confidence tiers, typo tolerance, and docs updates.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: routes consistently use `agent`, `action`, `target`, `confidence`, and `requiresAuth`.
