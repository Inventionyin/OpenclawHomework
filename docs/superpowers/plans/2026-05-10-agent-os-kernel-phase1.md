# Agent OS Kernel Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current OpenClaw/Hermes command collection into a first-stage Agent OS kernel with traceability, automatic memory, daily pipeline memory sync, lightweight evals, and a clearer skill execution boundary.

**Architecture:** Keep the existing Node.js Feishu bridge as the production runtime. Add small, testable modules around current code: `agent-trace-ledger` for Langfuse-style observability, `memory-autopilot` for Mem0/LangMem-style automatic memory, and `agent-evals` for Promptfoo-style golden checks. Do not introduce LangGraph, CrewAI, LiteLLM, Graphiti, or Stagehand as runtime dependencies in phase 1.

**Tech Stack:** Node.js CommonJS, `node:test`, existing `scripts/feishu-bridge.js`, `scripts/task-center.js`, `scripts/agents/memory-store.js`, `scripts/obsidian-memory-sync.js`, JSONL ledgers, Markdown docs.

---

## 0. Open-Source Ideas To Borrow Without Over-Installing

This phase deliberately borrows product patterns, not whole frameworks:

| Source project | Borrowed idea | Phase 1 implementation |
|---|---|---|
| Mem0 | Memory is automatic and scoped by user/session/project/agent | `memory-autopilot.js` creates typed memory candidates from events |
| LangMem | Hot-path memory + background manager | User “记住/沉淀” writes immediately; daily pipeline runs background consolidation |
| LangGraph | Explicit state transitions, not free-form agents | Continue using `task-center` statuses and add trace events around route execution |
| Langfuse | Every agent decision has trace_id, latency, route, model/tool outcome | `agent-trace-ledger.js` writes JSONL traces |
| Promptfoo | Golden cases prevent prompt/router regression | `agent-evals.js` runs curated natural-language cases |
| Stagehand | Browser API should be observe/act/extract | Document interface only in phase 1; implementation starts phase 2 |

Do not optimize every borrowed project separately. The unified structure is:

```text
message -> route -> skill/task -> trace -> memory candidate -> daily consolidation -> eval
```

## 1. File Structure

Create:

- `scripts/agent-trace-ledger.js`: JSONL trace builder/reader/writer for route and skill execution.
- `tests/agent-trace-ledger.test.js`: unit tests for trace entry normalization, redaction, write/read.
- `scripts/memory-autopilot.js`: converts safe system events into memory candidates and persists approved low-risk summaries.
- `tests/memory-autopilot.test.js`: tests event classification, sensitive text rejection, memory note writing, Obsidian sync trigger.
- `scripts/agent-evals.js`: lightweight golden route eval runner.
- `tests/agent-evals.test.js`: tests eval case loading and route result scoring.
- `data/evals/golden-intents.json`: small curated eval dataset committed to repo because it is non-secret test data.

Modify:

- `scripts/feishu-bridge.js`: write route traces around `resolveAgentRoute` / `buildRoutedAgentReply`; pass trace metadata into handlers where already available.
- `scripts/daily-agent-pipeline.js`: run memory autopilot consolidation and Obsidian sync as the final optional stage.
- `scripts/agents/agent-handlers.js`: when `memory-agent` remembers a note, optionally call memory autopilot for consistent event format.
- `scripts/obsidian-memory-sync.js`: expose enough metadata for consolidation result; do not change current manual command behavior.
- `.gitignore`: ignore runtime `data/agent-traces/` if local default path is used.
- `docs/OpenClawHermes大神版整体优化架构设计.md`: add a short “Phase 1 selected scope” note after implementation.

Do not move existing large files in this phase. Refactoring file layout belongs to phase 2 after trace and eval coverage exist.

---

## Task 1: Agent Trace Ledger

**Files:**

- Create: `scripts/agent-trace-ledger.js`
- Create: `tests/agent-trace-ledger.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing tests for trace normalization and secret redaction**

Create `tests/agent-trace-ledger.test.js`:

```js
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  appendAgentTrace,
  buildAgentTraceEntry,
  getAgentTraceLedgerPath,
  readAgentTraces,
} = require('../scripts/agent-trace-ledger');

test('buildAgentTraceEntry keeps route timing and redacts secret-like fields', () => {
  const entry = buildAgentTraceEntry({
    timestamp: '2026-05-10T00:00:00.000Z',
    traceId: 'trace-1',
    channel: 'feishu',
    userText: '帮我看今天项目情况 GITHUB_TOKEN=ghp_example',
    route: { agent: 'clerk-agent', action: 'command-center', skillId: 'command-center', intentSource: 'rules' },
    status: 'completed',
    elapsedMs: 123,
    metadata: {
      model: 'longcat',
      apiKey: 'sk-secret',
    },
  });

  assert.equal(entry.traceId, 'trace-1');
  assert.equal(entry.agent, 'clerk-agent');
  assert.equal(entry.action, 'command-center');
  assert.equal(entry.skillId, 'command-center');
  assert.equal(entry.intentSource, 'rules');
  assert.equal(entry.elapsedMs, 123);
  assert.equal(entry.userText, '[redacted secret-like text]');
  assert.deepEqual(entry.metadata, { model: 'longcat', apiKey: '[redacted]' });
});

test('appendAgentTrace writes jsonl when enabled and readAgentTraces returns recent entries', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-trace-ledger-'));
  try {
    const file = join(tempDir, 'traces.jsonl');
    const env = {
      AGENT_TRACE_LEDGER_ENABLED: 'true',
      AGENT_TRACE_LEDGER_PATH: file,
    };

    assert.equal(getAgentTraceLedgerPath(env), file);
    assert.equal(appendAgentTrace(env, {
      traceId: 'trace-a',
      route: { agent: 'ops-agent', action: 'load-summary' },
      status: 'completed',
    }), true);
    assert.equal(appendAgentTrace(env, {
      traceId: 'trace-b',
      route: { agent: 'clerk-agent', action: 'task-center-brain' },
      status: 'failed',
      error: 'boom',
    }), true);

    assert.match(readFileSync(file, 'utf8'), /trace-a/);
    assert.deepEqual(readAgentTraces(env, 1).map((entry) => entry.traceId), ['trace-b']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendAgentTrace is disabled by default', () => {
  assert.equal(appendAgentTrace({}, { traceId: 'trace-disabled' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests\agent-trace-ledger.test.js
```

Expected: FAIL with module not found for `../scripts/agent-trace-ledger`.

- [ ] **Step 3: Implement `scripts/agent-trace-ledger.js`**

Create `scripts/agent-trace-ledger.js`:

```js
const { appendFileSync, existsSync, mkdirSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const {
  isSafeMemoryText,
} = require('./agents/memory-store');

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function redactScalar(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (/key|token|secret|password|authorization/i.test(text)) {
    return '[redacted]';
  }
  if (!isSafeMemoryText(text)) {
    return '[redacted secret-like text]';
  }
  return value;
}

function redactObject(value, depth = 0) {
  if (value === undefined || value === null) return undefined;
  if (depth > 2) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/key|token|secret|password|authorization/i.test(key)) {
          return [key, '[redacted]'];
        }
        return [key, redactObject(item, depth + 1)];
      }),
    );
  }
  return redactScalar(value);
}

function buildAgentTraceEntry(input = {}) {
  const route = input.route || {};
  const entry = {
    timestamp: input.timestamp || new Date().toISOString(),
    traceId: input.traceId || input.trace_id,
    channel: input.channel,
    conversationId: input.conversationId,
    userId: input.userId,
    userText: redactScalar(input.userText),
    agent: route.agent || input.agent,
    action: route.action || input.action,
    skillId: route.skillId || input.skillId,
    intentSource: route.intentSource || input.intentSource,
    confidence: route.confidence || input.confidence,
    riskLevel: route.riskLevel || input.riskLevel,
    status: input.status,
    elapsedMs: numberOrUndefined(input.elapsedMs),
    routeElapsedMs: numberOrUndefined(input.routeElapsedMs),
    replyChars: numberOrUndefined(input.replyChars),
    error: redactScalar(input.error),
    metadata: redactObject(input.metadata),
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function getAgentTraceLedgerPath(env = process.env) {
  return String(
    env.AGENT_TRACE_LEDGER_PATH
      || env.FEISHU_AGENT_TRACE_LEDGER_PATH
      || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'agent-traces', 'agent-traces.jsonl'),
  ).trim();
}

function isAgentTraceEnabled(env = process.env) {
  return String(env.AGENT_TRACE_LEDGER_ENABLED || env.FEISHU_AGENT_TRACE_LEDGER_ENABLED || 'false').toLowerCase() === 'true';
}

function appendAgentTrace(env = process.env, input = {}) {
  if (!isAgentTraceEnabled(env)) {
    return false;
  }
  const file = getAgentTraceLedgerPath(env);
  if (!file) {
    return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(buildAgentTraceEntry(input))}\n`, 'utf8');
  return true;
}

function readAgentTraces(env = process.env, limit = 200) {
  const file = getAgentTraceLedgerPath(env);
  if (!file || !existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Number(limit || 200))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  appendAgentTrace,
  buildAgentTraceEntry,
  getAgentTraceLedgerPath,
  isAgentTraceEnabled,
  readAgentTraces,
};
```

- [ ] **Step 4: Ignore runtime trace directory**

Add this line to `.gitignore` near other `data/` runtime folders:

```text
data/agent-traces/
```

- [ ] **Step 5: Run trace tests**

Run:

```powershell
node --test tests\agent-trace-ledger.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore scripts/agent-trace-ledger.js tests/agent-trace-ledger.test.js
git commit -m "Add agent trace ledger"
```

---

## Task 2: Trace Feishu Route Execution

**Files:**

- Modify: `scripts/feishu-bridge.js`
- Modify: `tests/feishu-bridge.test.js`

- [ ] **Step 1: Write failing bridge test for trace append**

In `tests/feishu-bridge.test.js`, add a test near existing `buildRoutedAgentReply` tests:

```js
test('buildRoutedAgentReply writes route trace when trace appender is provided', async () => {
  const traces = [];
  const reply = await buildRoutedAgentReply(
    {
      event: {
        message: {
          message_id: 'msg-trace-route',
          content: JSON.stringify({ text: '给我一屏看懂今天项目' }),
        },
        sender: { sender_id: { open_id: 'user-a' } },
      },
    },
    {
      FEISHU_AUTHORIZED_OPEN_IDS: 'user-a',
    },
    {
      timingContext: { traceId: 'trace-route-1', startedAt: 1000 },
      nowMs: () => 1123,
      agentTraceAppender: (entry) => traces.push(entry),
    },
    {
      agent: 'clerk-agent',
      action: 'command-center',
      skillId: 'command-center',
      requiresAuth: true,
      riskLevel: 'low',
      autoRun: true,
      intentSource: 'rules',
    },
  );

  assert.equal(reply.handled, true);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].traceId, 'trace-route-1');
  assert.equal(traces[0].route.agent, 'clerk-agent');
  assert.equal(traces[0].route.action, 'command-center');
  assert.equal(traces[0].status, 'completed');
  assert.equal(traces[0].elapsedMs, 123);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests\feishu-bridge.test.js
```

Expected: FAIL because no route trace is appended.

- [ ] **Step 3: Import trace ledger and add helper**

In `scripts/feishu-bridge.js`, add:

```js
const {
  appendAgentTrace,
} = require('./agent-trace-ledger');
```

Add helper near timing helpers:

```js
function appendRouteTrace(env, options, input) {
  const appender = options.agentTraceAppender || ((entry) => appendAgentTrace(env, entry));
  try {
    return appender(input);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Append trace in `buildRoutedAgentReply`**

Change `buildRoutedAgentReply` to measure elapsed and append once:

```js
async function buildRoutedAgentReply(payload, env, options = {}, route = routeAgentIntent(extractFeishuText(payload))) {
  const startedAt = typeof options.nowMs === 'function' ? options.nowMs() : nowMs();
  let result;
  try {
    result = await buildRoutedAgentReplyResult(payload, env, options, route);
    appendRouteTrace(env, options, {
      traceId: options.traceId || options.timingContext?.traceId,
      channel: 'feishu',
      userText: extractFeishuText(payload),
      route,
      status: result?.failed ? 'failed' : 'completed',
      elapsedMs: (typeof options.nowMs === 'function' ? options.nowMs() : nowMs()) - startedAt,
      replyChars: String(result?.replyText || '').length,
    });
  } catch (error) {
    appendRouteTrace(env, options, {
      traceId: options.traceId || options.timingContext?.traceId,
      channel: 'feishu',
      userText: extractFeishuText(payload),
      route,
      status: 'failed',
      elapsedMs: (typeof options.nowMs === 'function' ? options.nowMs() : nowMs()) - startedAt,
      error: error.message || error,
    });
    throw error;
  }
  if (shouldRecordRoutedIntentContext(result, route)) {
    recordIntentContext(payload, route, env, options);
  }
  return result;
}
```

- [ ] **Step 5: Run bridge tests**

Run:

```powershell
node --test tests\feishu-bridge.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/feishu-bridge.js tests/feishu-bridge.test.js
git commit -m "Trace routed agent replies"
```

---

## Task 3: Memory Autopilot Core

**Files:**

- Create: `scripts/memory-autopilot.js`
- Create: `tests/memory-autopilot.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/memory-autopilot.test.js`:

```js
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildMemoryCandidateFromEvent,
  runMemoryAutopilot,
} = require('../scripts/memory-autopilot');

test('buildMemoryCandidateFromEvent creates long-term memory for explicit remember text', () => {
  const candidate = buildMemoryCandidateFromEvent({
    type: 'user-message',
    text: '这个问题以后别再踩坑：UI 自动化失败先看 Allure artifact',
    timestamp: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(candidate.kind, 'procedure');
  assert.equal(candidate.shouldWrite, true);
  assert.match(candidate.summary, /UI 自动化失败先看 Allure artifact/);
  assert.equal(candidate.sourceEventType, 'user-message');
});

test('buildMemoryCandidateFromEvent rejects secret-like memory', () => {
  const candidate = buildMemoryCandidateFromEvent({
    type: 'user-message',
    text: '记住 GITHUB_TOKEN=ghp_example',
  });

  assert.equal(candidate.shouldWrite, false);
  assert.equal(candidate.reason, 'secret_like_text');
});

test('runMemoryAutopilot writes safe candidate and triggers sync', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-autopilot-'));
  try {
    const calls = [];
    const result = runMemoryAutopilot({
      event: {
        type: 'task-completed',
        taskType: 'ui-automation',
        summary: 'UI 自动化成功，Allure 报告已生成。',
        timestamp: '2026-05-10T00:00:00.000Z',
      },
      memoryDir: tempDir,
      now: new Date('2026-05-10T00:00:00.000Z'),
      syncObsidian: (options) => {
        calls.push(options);
        return { ok: true, written: ['Index.md'] };
      },
    });

    assert.equal(result.written, true);
    assert.equal(calls.length, 1);
    const notesFile = join(tempDir, 'runbook-notes.md');
    assert.equal(existsSync(notesFile), true);
    assert.match(readFileSync(notesFile, 'utf8'), /UI 自动化成功/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests\memory-autopilot.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `memory-autopilot.js`**

Create `scripts/memory-autopilot.js`:

```js
const { join } = require('node:path');
const {
  isSafeMemoryText,
  rememberMemoryNote,
} = require('./agents/memory-store');
const {
  syncObsidianMemoryVault,
} = require('./obsidian-memory-sync');

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function inferKind(event = {}, text = '') {
  if (/偏好|以后.*默认|默认.*用|我喜欢/.test(text)) return 'user-preference';
  if (/失败|报错|修复|事故|踩坑|问题/.test(text)) return 'incident';
  if (/步骤|流程|先看|检查|操作|runbook|以后/.test(text)) return 'procedure';
  if (event.taskType) return 'task-summary';
  return 'project-note';
}

function buildMemoryCandidateFromEvent(event = {}) {
  const text = normalizeText(event.text || event.summary || event.result || event.error || '');
  if (!text) {
    return { shouldWrite: false, reason: 'empty_event', sourceEventType: event.type || 'unknown' };
  }
  if (!isSafeMemoryText(text)) {
    return { shouldWrite: false, reason: 'secret_like_text', sourceEventType: event.type || 'unknown' };
  }

  const explicitMemory = /(记住|记一下|沉淀|以后别|以后.*踩坑|保存经验)/.test(text);
  const importantTask = ['task-completed', 'task-failed', 'daily-pipeline-completed'].includes(event.type)
    && /(ui|自动化|日报|pipeline|服务器|修复|token|邮件|热点)/i.test(String(event.taskType || text));
  const shouldWrite = explicitMemory || importantTask;

  return {
    shouldWrite,
    reason: shouldWrite ? 'accepted' : 'not_important',
    kind: inferKind(event, text),
    summary: text,
    sourceEventType: event.type || 'unknown',
    taskType: event.taskType,
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

function formatMemoryNote(candidate = {}) {
  return [
    `类型：${candidate.kind || 'project-note'}`,
    `来源：${candidate.sourceEventType || 'unknown'}${candidate.taskType ? ` / ${candidate.taskType}` : ''}`,
    `摘要：${candidate.summary}`,
  ].join('\n');
}

function runMemoryAutopilot(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const memoryDir = options.memoryDir || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory');
  const candidate = options.candidate || buildMemoryCandidateFromEvent(options.event || {});
  if (!candidate.shouldWrite) {
    return {
      written: false,
      candidate,
    };
  }

  rememberMemoryNote(join(memoryDir, 'runbook-notes.md'), formatMemoryNote(candidate), now);
  const syncer = options.syncObsidian || syncObsidianMemoryVault;
  let syncResult = null;
  try {
    syncResult = syncer({
      env,
      memoryDir,
      vaultDir: options.vaultDir,
      now,
      summarizeTaskCenterBrain: options.summarizeTaskCenterBrain,
    });
  } catch (error) {
    syncResult = { ok: false, error: error.message || String(error) };
  }

  return {
    written: true,
    candidate,
    syncResult,
  };
}

module.exports = {
  buildMemoryCandidateFromEvent,
  formatMemoryNote,
  runMemoryAutopilot,
};
```

- [ ] **Step 4: Run memory autopilot tests**

Run:

```powershell
node --test tests\memory-autopilot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/memory-autopilot.js tests/memory-autopilot.test.js
git commit -m "Add memory autopilot core"
```

---

## Task 4: Daily Pipeline Automatic Memory Consolidation

**Files:**

- Modify: `scripts/daily-agent-pipeline.js`
- Modify: `tests/daily-agent-pipeline.test.js`

- [ ] **Step 1: Add failing test for final memory stage**

In `tests/daily-agent-pipeline.test.js`, add:

```js
test('runDailyAgentPipeline runs memory autopilot as final optional stage', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-pipeline-memory-'));
  try {
    const env = {
      LOCAL_PROJECT_DIR: tempDir,
      DAILY_PIPELINE_MEMORY_AUTOPILOT_ENABLED: 'true',
    };
    const calls = [];
    const result = await runDailyAgentPipeline({
      env,
      day: '2026-05-10',
      force: true,
      runNewsDigest: async () => ({ ok: true }),
      runTrendIntel: async () => ({ ok: true }),
      runTrendTokenFactory: async () => ({ ok: true }),
      runScheduledUi: async () => ({ ok: true }),
      runScheduledTokenLab: async () => ({ ok: true }),
      runDigest: async () => ({ ok: true }),
      runMemoryAutopilot: (options) => {
        calls.push(options);
        return { written: true, syncResult: { written: ['Index.md'] } };
      },
    });

    assert.equal(result.summary.totalStages, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event.type, 'daily-pipeline-completed');
    assert.match(calls[0].event.summary, /completed/);
    assert.equal(result.stages.at(-1).id, 'memory-autopilot');
    assert.equal(result.stages.at(-1).status, 'completed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests\daily-agent-pipeline.test.js
```

Expected: FAIL because memory stage is not present.

- [ ] **Step 3: Import memory autopilot**

In `scripts/daily-agent-pipeline.js`, add:

```js
const {
  runMemoryAutopilot,
} = require('./memory-autopilot');
```

- [ ] **Step 4: Add optional final stage**

After `stageDefs` is built, before running stages, append:

```js
  if (String(env.DAILY_PIPELINE_MEMORY_AUTOPILOT_ENABLED || 'false').toLowerCase() === 'true') {
    stageDefs.push({
      id: 'memory-autopilot',
      label: '自动记忆沉淀',
      run: () => (options.runMemoryAutopilot || runMemoryAutopilot)({
        env,
        event: {
          type: 'daily-pipeline-completed',
          taskType: 'daily-pipeline',
          summary: `daily pipeline completed for ${day}`,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  }
```

This is controlled by env flag so production can enable it intentionally.

- [ ] **Step 5: Run daily pipeline tests**

Run:

```powershell
node --test tests\daily-agent-pipeline.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/daily-agent-pipeline.js tests/daily-agent-pipeline.test.js
git commit -m "Add daily pipeline memory consolidation"
```

---

## Task 5: Golden Intent Eval Runner

**Files:**

- Create: `data/evals/golden-intents.json`
- Create: `scripts/agent-evals.js`
- Create: `tests/agent-evals.test.js`

- [ ] **Step 1: Create golden intent fixture**

Create `data/evals/golden-intents.json`:

```json
[
  {
    "text": "今天项目什么情况？",
    "expected": { "agent": "clerk-agent", "action": "task-center-brain" }
  },
  {
    "text": "你现在内存多少硬盘多少",
    "expected": { "agent": "ops-agent", "action": "load-summary" }
  },
  {
    "text": "这个问题以后别再踩坑：UI自动化失败先看Allure",
    "expected": { "agent": "memory-agent", "action": "remember" }
  },
  {
    "text": "帮我跑一下 main 分支的 UI 自动化冒烟测试",
    "expected": { "agent": "ui-test-agent", "action": "run" }
  },
  {
    "text": "看看内存、硬盘、今天失败任务和 token 用量",
    "expected": { "agent": "planner-agent", "action": "multi-intent-plan" }
  }
]
```

- [ ] **Step 2: Write failing tests**

Create `tests/agent-evals.test.js`:

```js
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  loadGoldenIntentCases,
  runGoldenIntentEvals,
  scoreRoute,
} = require('../scripts/agent-evals');

test('scoreRoute compares expected agent and action', () => {
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'load-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), true);
  assert.equal(scoreRoute(
    { agent: 'ops-agent', action: 'disk-summary' },
    { agent: 'ops-agent', action: 'load-summary' },
  ), false);
});

test('loadGoldenIntentCases reads json cases', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-evals-'));
  try {
    const file = join(tempDir, 'cases.json');
    writeFileSync(file, JSON.stringify([{ text: '你好', expected: { agent: 'chat-agent', action: 'chat' } }]), 'utf8');
    assert.equal(loadGoldenIntentCases(file).length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runGoldenIntentEvals returns pass and failure details', () => {
  const result = runGoldenIntentEvals({
    cases: [
      { text: '内存多少', expected: { agent: 'ops-agent', action: 'load-summary' } },
      { text: '你好', expected: { agent: 'chat-agent', action: 'chat' } },
    ],
    routeIntent: (text) => (text === '内存多少'
      ? { agent: 'ops-agent', action: 'load-summary' }
      : { agent: 'clerk-agent', action: 'command-center' }),
  });

  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].text, '你好');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
node --test tests\agent-evals.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 4: Implement `scripts/agent-evals.js`**

Create `scripts/agent-evals.js`:

```js
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  routeAgentIntent,
} = require('./agents/router');

function loadGoldenIntentCases(file = join(process.cwd(), 'data', 'evals', 'golden-intents.json')) {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function scoreRoute(actual = {}, expected = {}) {
  return String(actual.agent || '') === String(expected.agent || '')
    && String(actual.action || '') === String(expected.action || '');
}

function runGoldenIntentEvals(options = {}) {
  const cases = options.cases || loadGoldenIntentCases(options.file);
  const routeIntent = options.routeIntent || ((text) => routeAgentIntent(text));
  const results = cases.map((item) => {
    const actual = routeIntent(item.text);
    const passed = scoreRoute(actual, item.expected);
    return {
      text: item.text,
      passed,
      expected: item.expected,
      actual: {
        agent: actual.agent,
        action: actual.action,
      },
    };
  });
  const failures = results.filter((item) => !item.passed);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  };
}

function main() {
  const result = runGoldenIntentEvals();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  loadGoldenIntentCases,
  runGoldenIntentEvals,
  scoreRoute,
};
```

- [ ] **Step 5: Run eval tests and CLI**

Run:

```powershell
node --test tests\agent-evals.test.js
node scripts\agent-evals.js
```

Expected:

- test PASS
- CLI exits 0 only if all golden cases match current router

If CLI fails, inspect failures and either fix the route or adjust the golden case only if the case expectation is wrong.

- [ ] **Step 6: Commit**

```powershell
git add data/evals/golden-intents.json scripts/agent-evals.js tests/agent-evals.test.js
git commit -m "Add golden intent eval runner"
```

---

## Task 6: Documentation Update and Full Verification

**Files:**

- Modify: `docs/OpenClawHermes大神版整体优化架构设计.md`
- Modify: `docs/飞书桥梁服务使用说明.md`

- [ ] **Step 1: Update architecture design with phase 1 status**

Append a short section to `docs/OpenClawHermes大神版整体优化架构设计.md`:

```md
## 11. Phase 1 落地状态

Phase 1 只选择最关键的可执行骨架：

- Agent Trace Ledger：记录 trace_id、路由、skill、耗时、状态和错误。
- Memory Autopilot：把明确记忆和关键任务事件自动沉淀。
- Daily Pipeline Memory Stage：每日流水线可选自动同步长期记忆。
- Golden Intent Evals：用固定样例防止自然语言路由退化。

暂不直接接入 LangGraph、CrewAI、Graphiti、LiteLLM、Langfuse、Stagehand。它们的思路已经映射到当前架构，等 trace/eval 稳定后再逐步接入。
```

- [ ] **Step 2: Update user usage docs**

In `docs/飞书桥梁服务使用说明.md`, add a short section near the natural language / daily pipeline section:

```md
### Agent OS Phase 1：自动记忆和观测

如果启用：

```env
AGENT_TRACE_LEDGER_ENABLED=true
AGENT_TRACE_LEDGER_PATH=/var/lib/openclaw-homework/agent-traces.jsonl
DAILY_PIPELINE_MEMORY_AUTOPILOT_ENABLED=true
```

系统会自动记录路由 trace，并在每日流水线结束后把关键摘要沉淀进长期记忆和 Obsidian vault。普通用户不需要说“同步 Obsidian”；只要说“这个问题以后记住 / 今天项目什么情况 / 继续昨天的任务”即可。

回归检查：

```bash
node scripts/agent-evals.js
```
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
node --test tests\agent-trace-ledger.test.js tests\memory-autopilot.test.js tests\agent-evals.test.js tests\feishu-bridge.test.js tests\daily-agent-pipeline.test.js
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run:

```powershell
npm test
git diff --check
```

Expected:

- `npm test`: all tests pass
- `git diff --check`: no whitespace errors

- [ ] **Step 5: Final commit**

If docs changed after earlier commits:

```powershell
git add docs/OpenClawHermes大神版整体优化架构设计.md docs/飞书桥梁服务使用说明.md
git commit -m "Document agent OS phase one"
```

- [ ] **Step 6: Push**

```powershell
git push
```

---

## Self-Review

Spec coverage:

- Agent Trace Ledger maps to Langfuse-style observability.
- Memory Autopilot maps to Mem0/LangMem-style automatic memory.
- Daily Pipeline Memory Stage turns Obsidian sync into background infrastructure.
- Golden Intent Evals map to Promptfoo-style regression checks.
- Browser observe/act/extract is intentionally deferred to phase 2 because phase 1 needs trace/eval first.

No placeholders:

- Every task lists exact files, code, commands, expected results, and commits.
- Deferred items are explicitly out of scope, not hidden TODOs.

Type consistency:

- Trace APIs: `buildAgentTraceEntry`, `appendAgentTrace`, `readAgentTraces`.
- Memory APIs: `buildMemoryCandidateFromEvent`, `runMemoryAutopilot`.
- Eval APIs: `loadGoldenIntentCases`, `scoreRoute`, `runGoldenIntentEvals`.

Execution recommendation:

Use subagent-driven development with independent task ownership:

- Agent 1: Task 1 and Task 2 trace ledger + bridge wiring.
- Agent 2: Task 3 and Task 4 memory autopilot + daily pipeline wiring.
- Agent 3: Task 5 eval runner.
- Main session: Task 6 docs, full verification, commit/push coordination.

