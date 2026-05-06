# Daily Summary Snapshot Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `task-center` the clear primary source for clerk summaries while demoting `data/memory/daily-summary-state.json` into an explicit daily-report snapshot/cache layer.

**Architecture:** Introduce a shared snapshot helper module that owns all read/write behavior for `daily-summary-state.json`, migrate clerk report assembly and Feishu bridge run snapshot updates to that helper, and lock in the new boundary with focused tests and docs. Compatibility stays intact by keeping current file paths and behavior while clarifying naming, comments, and failure handling.

**Tech Stack:** Node.js, built-in `node:test`, JSON file persistence, existing `task-center`, `daily-summary`, `feishu-bridge`, `agent-handlers`

---

## File Map

- Create: `scripts/daily-summary-snapshot.js`
  - Shared helper for locating, reading, writing, and appending daily-report snapshot data
- Modify: `scripts/agents/agent-handlers.js`
  - Stop owning ad hoc snapshot file access; consume shared helper and keep `task-center` first
- Modify: `scripts/feishu-bridge.js`
  - Stop owning bespoke snapshot read/write logic; consume shared helper for UI run snapshot updates
- Modify: `tests/agent-handlers.test.js`
  - Assert the clerk report still prefers `task-center` and degrades cleanly when snapshot data is missing/bad
- Modify: `tests/feishu-bridge.test.js`
  - Assert shared snapshot behavior still supports UI run history
- Create: `tests/daily-summary-snapshot.test.js`
  - Unit coverage for snapshot helper read/write/append/degrade rules
- Modify: `docs/OpenClawHermes自然语言总控与GBrain升级.md`
  - Brief operational note for future maintainers: `task-center` is primary, snapshot file is display cache

### Task 1: Add Shared Daily Summary Snapshot Helper

**Files:**
- Create: `scripts/daily-summary-snapshot.js`
- Test: `tests/daily-summary-snapshot.test.js`

- [ ] **Step 1: Write the failing helper tests**

```js
test('readDailySummarySnapshot returns empty runs when file is missing', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-snapshot-missing-'));
  try {
    assert.deepEqual(readDailySummarySnapshot({
      DAILY_SUMMARY_STATE_FILE: join(tempDir, 'daily-summary-state.json'),
    }), { runs: [] });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('appendDailySummaryRunSnapshot keeps only the latest 20 runs', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-snapshot-append-'));
  const env = { DAILY_SUMMARY_STATE_FILE: join(tempDir, 'daily-summary-state.json') };
  try {
    for (let index = 0; index < 22; index += 1) {
      appendDailySummaryRunSnapshot(env, { targetRef: 'main', runMode: 'smoke' }, {
        id: index + 1,
        status: 'completed',
        conclusion: 'success',
        html_url: `https://example.com/runs/${index + 1}`,
        updated_at: `2026-05-06T00:${String(index).padStart(2, '0')}:00.000Z`,
      });
    }

    const snapshot = readDailySummarySnapshot(env);
    assert.equal(snapshot.runs.length, 20);
    assert.equal(snapshot.runs[0].id, 3);
    assert.equal(snapshot.runs.at(-1).id, 22);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="daily-summary-snapshot"`
Expected: FAIL because `scripts/daily-summary-snapshot.js` and the exported helpers do not exist yet

- [ ] **Step 3: Write the minimal shared helper**

```js
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

function getDailySummarySnapshotFile(env = process.env) {
  return env.DAILY_SUMMARY_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'daily-summary-state.json');
}

function readJsonFileSafe(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeDailySummarySnapshot(state = {}) {
  return {
    runs: Array.isArray(state.runs) ? state.runs : [],
  };
}

function readDailySummarySnapshot(env = process.env) {
  return normalizeDailySummarySnapshot(readJsonFileSafe(getDailySummarySnapshotFile(env)) || {});
}
```

- [ ] **Step 4: Complete write/append helpers with compatibility behavior**

```js
function writeDailySummarySnapshot(env = process.env, state = {}) {
  const filePath = getDailySummarySnapshotFile(env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalizeDailySummarySnapshot(state), null, 2)}\n`, 'utf8');
}

function appendDailySummaryRunSnapshot(env = process.env, job = {}, run = {}) {
  const snapshot = readDailySummarySnapshot(env);
  const runUrl = run.html_url || job.actionsUrl || '';
  const artifactsUrl = buildRunArtifactsUrl(runUrl);
  const nextRuns = [
    ...snapshot.runs,
    {
      id: run.id || null,
      conclusion: run.conclusion || run.status || 'unknown',
      runUrl,
      artifactsUrl,
      targetRef: job.targetRef || job.config?.inputs?.target_ref || '',
      runMode: job.runMode || job.config?.inputs?.run_mode || '',
      updatedAt: run.updated_at || new Date().toISOString(),
    },
  ].slice(-20);
  writeDailySummarySnapshot(env, { runs: nextRuns });
  return nextRuns;
}

module.exports = {
  appendDailySummaryRunSnapshot,
  getDailySummarySnapshotFile,
  readDailySummarySnapshot,
  writeDailySummarySnapshot,
};
```

- [ ] **Step 5: Run helper tests and then full targeted tests**

Run: `npm test -- tests/daily-summary-snapshot.test.js tests/feishu-bridge.test.js tests/agent-handlers.test.js`
Expected: PASS for the new helper tests, with old bridge/handler tests still failing until migration steps land

- [ ] **Step 6: Commit**

```bash
git add scripts/daily-summary-snapshot.js tests/daily-summary-snapshot.test.js
git commit -m "feat: add daily summary snapshot helper"
```

### Task 2: Migrate Clerk Report Assembly To Shared Snapshot Helper

**Files:**
- Modify: `scripts/agents/agent-handlers.js`
- Modify: `tests/agent-handlers.test.js`

- [ ] **Step 1: Write/adjust failing tests for clerk boundary behavior**

```js
test('buildClerkAgentReply daily report keeps task-center summary when snapshot file is invalid', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'clerk-daily-invalid-snapshot-'));
  const stateFile = join(tempDir, 'daily-summary-state.json');
  writeFileSync(stateFile, '{not-json', 'utf8');

  try {
    const reply = buildClerkAgentReply({ action: 'daily-report' }, {
      env: { DAILY_SUMMARY_STATE_FILE: stateFile },
      summarizeDailyPlan: () => ({
        todaySummaryText: '今天任务 3 个，完成 2 个，失败 1 个。',
        tomorrowPlan: ['先复盘失败任务。'],
      }),
    });

    assert.match(reply, /今天任务 3 个/);
    assert.doesNotMatch(reply, /throw|syntaxerror/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails or is overly coupled to old helpers**

Run: `npm test -- --test-name-pattern="clerk.*snapshot|daily report keeps task-center"`
Expected: FAIL or expose that `agent-handlers.js` still owns ad hoc snapshot-path logic

- [ ] **Step 3: Replace local snapshot path/JSON logic with the shared helper**

```js
const {
  readDailySummarySnapshot,
} = require('../daily-summary-snapshot');

function loadDailySummaryArtifacts(env = process.env, options = {}) {
  const readUsage = options.readUsageLedger || defaultReadUsageLedger;
  const usageEntries = readUsage(env);
  const snapshot = options.readDailySummarySnapshot
    ? options.readDailySummarySnapshot(env)
    : readDailySummarySnapshot(env);
  const multiAgentSummary = (options.readJsonFile || readJsonFileSafe)(
    join(env.MULTI_AGENT_LAB_OUTPUT_DIR || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'multi-agent-lab'), 'summary.json'),
  );

  return {
    runs: Array.isArray(snapshot.runs) ? snapshot.runs : [],
    usageEntries,
    multiAgentSummary,
  };
}
```

- [ ] **Step 4: Add boundary comments and keep `task-center` first in report assembly**

```js
if (route.action === 'daily-report') {
  const summary = buildDailySummary(loadDailySummaryArtifacts(options.env || process.env, options));
  const plan = (options.summarizeDailyPlan || summarizeDailyPlan)({
    env: options.env || process.env,
    now: options.now || new Date(),
  });
  return [
    '文员日报预览：',
    plan.todaySummaryText,
    ...plan.tomorrowPlan.map((item) => `- ${item}`),
    '',
    summary.text,
    '',
    '服务器部分仍建议只引用状态摘要，不在日报阶段执行修复。',
  ].join('\n');
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/agent-handlers.test.js`
Expected: PASS, including new invalid-snapshot degradation coverage

- [ ] **Step 6: Commit**

```bash
git add scripts/agents/agent-handlers.js tests/agent-handlers.test.js
git commit -m "refactor: route clerk daily report through snapshot helper"
```

### Task 3: Migrate Feishu Bridge Snapshot Writes To Shared Helper

**Files:**
- Modify: `scripts/feishu-bridge.js`
- Modify: `tests/feishu-bridge.test.js`

- [ ] **Step 1: Write/adjust failing tests for bridge snapshot compatibility**

```js
test('appendDailySummaryRunSnapshot via bridge preserves artifacts url and trim behavior', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bridge-daily-snapshot-'));
  const env = { DAILY_SUMMARY_STATE_FILE: join(tempDir, 'daily-summary-state.json') };

  try {
    // import exported bridge helper or drive through bridge workflow helper
    // then verify only latest 20 runs remain and artifactsUrl is retained
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run bridge tests to expose old duplicated behavior**

Run: `npm test -- tests/feishu-bridge.test.js`
Expected: FAIL or show that snapshot logic is still duplicated inside `feishu-bridge.js`

- [ ] **Step 3: Replace duplicated bridge helpers with shared snapshot module imports**

```js
const {
  appendDailySummaryRunSnapshot,
  readDailySummarySnapshot,
} = require('./daily-summary-snapshot');

// use readDailySummarySnapshot(env).runs where bridge needs read access
// use appendDailySummaryRunSnapshot(env, job, completedRun) for run completion updates
```

- [ ] **Step 4: Keep external bridge API stable where tests or callers rely on exports**

```js
module.exports = {
  // existing exports...
  appendDailySummaryRun: appendDailySummaryRunSnapshot,
};
```

- [ ] **Step 5: Run focused bridge tests**

Run: `npm test -- tests/feishu-bridge.test.js`
Expected: PASS with no regressions in UI run completion notifications or snapshot history access

- [ ] **Step 6: Commit**

```bash
git add scripts/feishu-bridge.js tests/feishu-bridge.test.js
git commit -m "refactor: share daily summary snapshot bridge logic"
```

### Task 4: Document The Boundary And Run Final Verification

**Files:**
- Modify: `docs/OpenClawHermes自然语言总控与GBrain升级.md`

- [ ] **Step 1: Add the maintainer note**

```md
## 日报边界补充

- `task-center`：任务主数据源，负责今日任务、失败任务、明日计划
- `data/memory/daily-summary-state.json`：日报展示缓存，主要保存最近 `runs`
- 文员 Agent / 主动日报优先读 `task-center`，只在展示补充时读取日报快照
```

- [ ] **Step 2: Run the complete verification set**

Run: `npm test`
Expected: PASS for the full suite

- [ ] **Step 3: Run diff hygiene check**

Run: `git diff --check`
Expected: no whitespace or conflict-marker errors

- [ ] **Step 4: Commit**

```bash
git add docs/OpenClawHermes自然语言总控与GBrain升级.md
git commit -m "docs: clarify daily summary snapshot boundary"
```

- [ ] **Step 5: Push and deploy after local verification**

Run:

```bash
git push origin main
```

Expected: remote branch updated successfully

Run on OpenClaw and Hermes servers after pull:

```bash
cd /opt/OpenclawHomework
git pull --ff-only
npm test
sudo systemctl restart openclaw-feishu-bridge
curl http://127.0.0.1:8788/health
```

and

```bash
cd /opt/OpenclawHomework
git pull --ff-only
npm test
sudo systemctl restart hermes-feishu-bridge
curl http://127.0.0.1:8788/health
```

Expected: tests pass on both servers and health endpoints return `{"ok":true}`
