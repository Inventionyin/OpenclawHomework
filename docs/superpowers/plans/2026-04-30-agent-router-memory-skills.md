# Agent Router Memory Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight Agent Router, file-backed memory, skill documents, and safe ops commands to the Feishu bridge without reintroducing OpenClaw/Hermes concurrency bugs.

**Architecture:** Keep the existing Node bridge as the single runtime. Add pure routing/memory/agent helper modules under `scripts/agents/`, then connect them from `scripts/feishu-bridge.js` after tests prove behavior. Agent roles are logical modules, not independent CLI processes.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, JSON/Markdown files, existing Feishu bridge and GitHub Actions dispatch scripts.

---

## File Map

- Create `data/memory/user-profile.json`: safe user preferences used by chat/doc responses.
- Create `data/memory/project-state.json`: non-secret project facts such as repo, domains, service names, and current capabilities.
- Create `data/memory/incident-log.md`: sanitized incident history and fixes.
- Create `data/memory/runbook-notes.md`: operational notes that can be summarized by doc/ops agents.
- Create `docs/skills/ui-automation.md`: UI automation skill document.
- Create `docs/skills/server-ops.md`: safe server ops skill document.
- Create `docs/skills/feishu-debug.md`: Feishu duplicate/receive_id debugging skill document.
- Create `docs/skills/handoff.md`: AI handoff skill document.
- Create `scripts/agents/memory-store.js`: safe memory reading/writing helpers.
- Create `scripts/agents/router.js`: intent classification and authorization category.
- Create `scripts/agents/agent-handlers.js`: pure handlers for chat/doc/memory/ops/ui-test routing decisions.
- Modify `scripts/feishu-bridge.js`: integrate router into async Feishu handling while keeping existing direct UI automation path.
- Modify `tests/feishu-bridge.test.js`: integration coverage for routed Feishu messages.
- Create `tests/memory-store.test.js`, `tests/router.test.js`, `tests/agent-handlers.test.js`: focused unit tests.
- Modify `docs/飞书桥梁服务使用说明.md` and `docs/AI接手核云服务器运维手册.md`: document new commands and safety boundary.

## Task 1: Seed Safe Memory And Skill Documents

**Files:**
- Create: `data/memory/user-profile.json`
- Create: `data/memory/project-state.json`
- Create: `data/memory/incident-log.md`
- Create: `data/memory/runbook-notes.md`
- Create: `docs/skills/ui-automation.md`
- Create: `docs/skills/server-ops.md`
- Create: `docs/skills/feishu-debug.md`
- Create: `docs/skills/handoff.md`

- [ ] **Step 1: Create safe memory files**

Create `data/memory/user-profile.json`:

```json
{
  "language": "zh-CN",
  "style": "直接、稳、少废话，优先执行并验证",
  "preferences": [
    "用中文说明当前状态",
    "不要把密钥、Token、密码写入仓库或最终回复",
    "修改代码后必须运行测试",
    "遇到服务器问题先查 health、systemd、journalctl"
  ]
}
```

Create `data/memory/project-state.json`:

```json
{
  "repository": "https://github.com/Inventionyin/OpenclawHomework",
  "localPath": "D:\\OtherProject\\OpenclawHomework",
  "servers": {
    "openclaw": {
      "host": "38.76.178.91",
      "domain": "openclaw.evanshine.me",
      "service": "openclaw-feishu-bridge",
      "watchdog": "openclaw-homework-watchdog"
    },
    "hermes": {
      "host": "38.76.188.94",
      "domain": "hermes.evanshine.me",
      "service": "hermes-feishu-bridge",
      "watchdog": "hermes-homework-watchdog"
    }
  },
  "capabilities": [
    "Feishu webhook receives OpenClaw and Hermes bot messages",
    "GitHub Actions workflow_dispatch triggers UI automation",
    "Allure and GitHub Actions report links are sent back to Feishu",
    "OpenClaw CLI calls are serialized to avoid session file locks",
    "Watchdog timers check bridge health and Feishu callback storms"
  ],
  "securityRules": [
    "No arbitrary shell from Feishu",
    "No secrets in memory files",
    "Ops commands must be whitelisted"
  ]
}
```

Create `data/memory/incident-log.md`:

```markdown
# Incident Log

## Feishu Message Flood

Root cause: webhook returned non-200 status, so Feishu retried events.

Fixes:
- Webhook acknowledges Feishu events with HTTP 200.
- Duplicate event cache ignores repeated event/message/text keys.
- Watchdog scans Nginx access logs for callback storms.

## OpenClaw Session Lock

Root cause: multiple OpenClaw CLI calls attempted to use the same local session file.

Fixes:
- OpenClaw parser/chat calls are serialized in the bridge process.
- Regular chat can route to Hermes where appropriate.

## Missing Or Invalid Feishu receive_id

Root cause: non-message events or stale configured receive ids were used for replies.

Fixes:
- Non-message events are ignored.
- Replies prefer current message chat_id/open_id.
- Payloads without reply targets are ignored in async background handling.
```

Create `data/memory/runbook-notes.md`:

```markdown
# Runbook Notes

## Local Checks

```powershell
npm test
git diff --check
git status --short --branch
```

## Server Checks

```bash
systemctl is-active openclaw-feishu-bridge
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
systemctl list-timers '*homework-watchdog*' --no-pager
```

## Safety Boundary

Feishu commands may inspect service health and recent logs through whitelisted helpers only. They must not run arbitrary shell or print secrets.
```

- [ ] **Step 2: Create skill documents**

Create `docs/skills/ui-automation.md`:

```markdown
# UI Automation Skill

Purpose: trigger and explain GitHub Actions UI automation for OpenclawHomework.

Allowed user commands:
- `/run-ui-test main smoke`
- `/run-ui-test main contracts`
- `帮我跑一下 main 分支的 UI 自动化冒烟测试`

Run modes:
- `contracts`: fastest contract/basic checks
- `smoke`: main user-flow smoke checks
- `all`: broader UI automation

Safety:
- Only bound/authorized users may trigger tests.
- Never expose GitHub tokens.
- Return GitHub Actions and Allure artifact links when available.
```

Create `docs/skills/server-ops.md`:

```markdown
# Server Ops Skill

Purpose: answer safe operational status questions for the two bridge servers.

Allowed commands:
- `/status`
- `/health`
- `/watchdog`
- `/logs`

Allowed checks:
- bridge service active state
- local `/health`
- watchdog timer active state
- recent journal summary without secrets
- current git commit

Forbidden:
- arbitrary shell
- reading secret env values
- deleting files
- changing SSH, firewall, Nginx, or systemd from chat
```

Create `docs/skills/feishu-debug.md`:

```markdown
# Feishu Debug Skill

Purpose: debug duplicate messages, missing receive_id, invalid receive_id, and webhook retries.

Checklist:
1. Feishu event subscription should only include `im.message.receive_v1`.
2. Webhook must return HTTP 200 quickly.
3. Duplicate cache should be enabled.
4. Replies should prefer current event `chat_id`, then sender `open_id`.
5. Events without reply targets should be ignored.
6. Nginx access logs and watchdog logs should be checked for callback storms.
```

Create `docs/skills/handoff.md`:

```markdown
# Handoff Skill

Purpose: help a new AI or developer safely take over OpenclawHomework.

First checks:
```powershell
git status --short --branch
npm test
```

Server checks:
```bash
cd /opt/OpenclawHomework
git log --oneline -5
systemctl is-active openclaw-feishu-bridge
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Rules:
- Do not reset or revert user changes without explicit permission.
- Do not print secrets.
- Add tests before behavior changes.
```

- [ ] **Step 3: Verify documents contain no secret-looking placeholders**

Run:

```powershell
Select-String -Path data/memory/*,docs/skills/* -Pattern "ghp_|94547e|App Secret|password=|GITHUB_TOKEN="
```

Expected: no matches.

- [ ] **Step 4: Commit seed docs**

Run:

```bash
git add data/memory docs/skills
git commit -m "Add agent memory and skill docs"
```

## Task 2: Memory Store Module

**Files:**
- Create: `scripts/agents/memory-store.js`
- Create: `tests/memory-store.test.js`

- [ ] **Step 1: Write failing tests for memory loading and secret rejection**

Create `tests/memory-store.test.js`:

```javascript
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildMemoryContext,
  isSafeMemoryText,
  readJsonMemory,
  rememberMemoryNote,
} = require('../scripts/agents/memory-store');

test('readJsonMemory returns parsed JSON or fallback', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    const file = join(tempDir, 'profile.json');
    writeFileSync(file, '{"language":"zh-CN"}', 'utf8');
    assert.deepEqual(readJsonMemory(file, {}), { language: 'zh-CN' });
    assert.deepEqual(readJsonMemory(join(tempDir, 'missing.json'), { ok: true }), { ok: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('isSafeMemoryText rejects common secret patterns', () => {
  assert.equal(isSafeMemoryText('项目已经部署到两台服务器'), true);
  assert.equal(isSafeMemoryText('GITHUB_TOKEN=ghp_example'), false);
  assert.equal(isSafeMemoryText('password=abc123'), false);
  assert.equal(isSafeMemoryText('App Secret: abc'), false);
});

test('rememberMemoryNote appends safe notes only', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    const file = join(tempDir, 'notes.md');
    rememberMemoryNote(file, '今天修复了 session lock');
    assert.throws(() => rememberMemoryNote(file, 'GITHUB_TOKEN=ghp_example'), /Refusing to store secret-like memory/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryContext creates concise context from memory directory', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    writeFileSync(join(tempDir, 'user-profile.json'), '{"language":"zh-CN","style":"直接"}', 'utf8');
    writeFileSync(join(tempDir, 'project-state.json'), '{"repository":"repo","capabilities":["UI tests"]}', 'utf8');
    writeFileSync(join(tempDir, 'incident-log.md'), '# Incident Log\n\n## Fixed\nsession lock', 'utf8');

    const context = buildMemoryContext(tempDir);
    assert.match(context, /language/);
    assert.match(context, /UI tests/);
    assert.match(context, /session lock/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/memory-store.test.js
```

Expected: FAIL with module not found for `scripts/agents/memory-store`.

- [ ] **Step 3: Implement memory store**

Create `scripts/agents/memory-store.js`:

```javascript
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const SECRET_PATTERNS = [
  /\bGITHUB_TOKEN\s*=/i,
  /\bghp_[A-Za-z0-9_]+/,
  /\bpassword\s*=/i,
  /\bApp Secret\b/i,
  /\bAPIKEY\s*[:=]/i,
  /\bAPI_KEY\s*=/i,
  /\bSECRET\s*=/i,
  /\bTOKEN\s*=/i,
];

function readTextFile(filePath, fallback = '') {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return readFileSync(filePath, 'utf8');
}

function readJsonMemory(filePath, fallback = {}) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isSafeMemoryText(text) {
  const value = String(text ?? '');
  return !SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function rememberMemoryNote(filePath, note, now = new Date()) {
  if (!isSafeMemoryText(note)) {
    throw new Error('Refusing to store secret-like memory.');
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const existing = readTextFile(filePath, '# Runbook Notes\n');
  const entry = `\n## ${now.toISOString()}\n\n${String(note).trim()}\n`;
  writeFileSync(filePath, `${existing.trim()}\n${entry}`, 'utf8');
}

function buildMemoryContext(memoryDir = join(process.cwd(), 'data', 'memory')) {
  const userProfile = readJsonMemory(join(memoryDir, 'user-profile.json'), {});
  const projectState = readJsonMemory(join(memoryDir, 'project-state.json'), {});
  const incidentLog = readTextFile(join(memoryDir, 'incident-log.md'), '').slice(0, 2500);
  const runbookNotes = readTextFile(join(memoryDir, 'runbook-notes.md'), '').slice(0, 1500);

  return [
    '# Memory Context',
    '',
    '## User Profile',
    JSON.stringify(userProfile, null, 2),
    '',
    '## Project State',
    JSON.stringify(projectState, null, 2),
    '',
    '## Incident Log',
    incidentLog,
    '',
    '## Runbook Notes',
    runbookNotes,
  ].join('\n').trim();
}

module.exports = {
  buildMemoryContext,
  isSafeMemoryText,
  readJsonMemory,
  readTextFile,
  rememberMemoryNote,
};
```

- [ ] **Step 4: Run memory tests**

Run:

```powershell
node --test tests/memory-store.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Run full tests and commit**

Run:

```powershell
npm test
git diff --check
git add scripts/agents/memory-store.js tests/memory-store.test.js
git commit -m "Add safe memory store"
```

## Task 3: Agent Router Module

**Files:**
- Create: `scripts/agents/router.js`
- Create: `tests/router.test.js`

- [ ] **Step 1: Write failing router tests**

Create `tests/router.test.js`:

```javascript
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  routeAgentIntent,
} = require('../scripts/agents/router');

test('routeAgentIntent routes UI automation requests', () => {
  assert.equal(routeAgentIntent('/run-ui-test main smoke').agent, 'ui-test-agent');
  assert.equal(routeAgentIntent('帮我跑一下 main 分支的 UI 自动化冒烟测试').agent, 'ui-test-agent');
});

test('routeAgentIntent routes safe ops commands', () => {
  assert.deepEqual(routeAgentIntent('/status'), { agent: 'ops-agent', action: 'status', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/watchdog'), { agent: 'ops-agent', action: 'watchdog', requiresAuth: true });
});

test('routeAgentIntent routes memory commands', () => {
  assert.deepEqual(routeAgentIntent('/memory'), { agent: 'memory-agent', action: 'show', requiresAuth: true });
  assert.deepEqual(routeAgentIntent('/memory remember 今天修复了 session lock'), {
    agent: 'memory-agent',
    action: 'remember',
    note: '今天修复了 session lock',
    requiresAuth: true,
  });
});

test('routeAgentIntent routes documentation questions', () => {
  assert.equal(routeAgentIntent('老师任务还差哪些').agent, 'doc-agent');
  assert.equal(routeAgentIntent('怎么让新 AI 接手').agent, 'doc-agent');
});

test('routeAgentIntent defaults to chat agent', () => {
  assert.deepEqual(routeAgentIntent('你好，今天状态怎么样'), {
    agent: 'chat-agent',
    action: 'chat',
    requiresAuth: false,
  });
});
```

- [ ] **Step 2: Run router test to verify it fails**

Run:

```powershell
node --test tests/router.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement router**

Create `scripts/agents/router.js`:

```javascript
function normalizeText(text) {
  return String(text ?? '').trim().replace(/^@\S+\s*/, '');
}

function routeAgentIntent(text) {
  const normalized = normalizeText(text);

  if (/^(\/run-ui-test|run-ui-test)\b/i.test(normalized)
    || /(UI|ui|自动化|冒烟|全量|contracts|smoke|GitHub Actions|workflow|跑一下|运行).*(测试|test)?/.test(normalized)) {
    return {
      agent: 'ui-test-agent',
      action: 'run',
      requiresAuth: true,
    };
  }

  if (/^\/status\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'status', requiresAuth: true };
  }
  if (/^\/health\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'health', requiresAuth: true };
  }
  if (/^\/watchdog\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'watchdog', requiresAuth: true };
  }
  if (/^\/logs\b/i.test(normalized)) {
    return { agent: 'ops-agent', action: 'logs', requiresAuth: true };
  }

  const rememberMatch = normalized.match(/^\/memory\s+remember\s+(.+)$/i);
  if (rememberMatch) {
    return {
      agent: 'memory-agent',
      action: 'remember',
      note: rememberMatch[1].trim(),
      requiresAuth: true,
    };
  }
  if (/^\/memory\b/i.test(normalized) || /(记住|记忆|项目状态)/.test(normalized)) {
    return { agent: 'memory-agent', action: 'show', requiresAuth: true };
  }

  if (/(老师任务|还差|接手|交接|文档|handoff|完成度)/i.test(normalized)) {
    return { agent: 'doc-agent', action: 'answer', requiresAuth: false };
  }

  return { agent: 'chat-agent', action: 'chat', requiresAuth: false };
}

module.exports = {
  normalizeText,
  routeAgentIntent,
};
```

- [ ] **Step 4: Run router tests**

Run:

```powershell
node --test tests/router.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit router**

Run:

```powershell
npm test
git diff --check
git add scripts/agents/router.js tests/router.test.js
git commit -m "Add agent intent router"
```

## Task 4: Agent Handlers

**Files:**
- Create: `scripts/agents/agent-handlers.js`
- Create: `tests/agent-handlers.test.js`

- [ ] **Step 1: Write failing handler tests**

Create `tests/agent-handlers.test.js`:

```javascript
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
} = require('../scripts/agents/agent-handlers');

test('buildDocAgentReply answers project progress from memory', () => {
  const memoryContext = [
    '# Memory Context',
    'GitHub Actions workflow_dispatch triggers UI automation',
    'Watchdog timers check bridge health',
  ].join('\n');

  const reply = buildDocAgentReply('老师任务还差哪些', memoryContext);
  assert.match(reply, /已完成/);
  assert.match(reply, /GitHub Actions/);
  assert.match(reply, /watchdog/i);
});

test('buildMemoryAgentReply shows memory context', () => {
  const reply = buildMemoryAgentReply({ action: 'show' }, '# Memory Context\nOpenClaw 已部署');
  assert.match(reply, /当前记忆摘要/);
  assert.match(reply, /OpenClaw/);
});

test('buildMemoryAgentReply stores safe note', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-handler-test-'));
  try {
    const file = join(tempDir, 'runbook-notes.md');
    writeFileSync(file, '# Runbook Notes\n', 'utf8');
    const reply = buildMemoryAgentReply({ action: 'remember', note: 'OpenClaw 已加串行队列' }, '', {
      noteFile: file,
    });
    assert.match(reply, /已记住/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMemoryAgentReply rejects secret-like notes', () => {
  assert.match(
    buildMemoryAgentReply({ action: 'remember', note: 'GITHUB_TOKEN=ghp_example' }, ''),
    /不能保存疑似密钥/,
  );
});

test('buildOpsAgentReply formats whitelisted check results', async () => {
  const reply = await buildOpsAgentReply({ action: 'status' }, {
    runOpsCheck: async () => ({
      service: 'openclaw-feishu-bridge',
      active: 'active',
      health: '{"ok":true}',
      watchdog: 'active',
      commit: 'abc1234 test commit',
    }),
  });

  assert.match(reply, /openclaw-feishu-bridge/);
  assert.match(reply, /active/);
  assert.match(reply, /abc1234/);
});
```

- [ ] **Step 2: Run handler test to verify it fails**

Run:

```powershell
node --test tests/agent-handlers.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement handlers**

Create `scripts/agents/agent-handlers.js`:

```javascript
const { join } = require('node:path');
const {
  buildMemoryContext,
  rememberMemoryNote,
} = require('./memory-store');

function trimForReply(value, limit = 1200) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function buildDocAgentReply(text, memoryContext = buildMemoryContext()) {
  return [
    '已完成的主线能力：',
    '- 飞书 OpenClaw/Hermes 机器人接入',
    '- GitHub Actions UI 自动化触发',
    '- Allure/GitHub Actions 报告回传',
    '- 双服务器拆分、watchdog、去重、OpenClaw CLI 串行队列',
    '',
    '我当前参考的记忆摘要：',
    trimForReply(memoryContext, 700),
  ].join('\n');
}

function buildMemoryAgentReply(route, memoryContext = buildMemoryContext(), options = {}) {
  if (route.action === 'remember') {
    try {
      rememberMemoryNote(
        options.noteFile || join(process.cwd(), 'data', 'memory', 'runbook-notes.md'),
        route.note,
      );
      return `已记住：${route.note}`;
    } catch (error) {
      return `不能保存疑似密钥或敏感信息：${error.message}`;
    }
  }

  return [
    '当前记忆摘要：',
    trimForReply(memoryContext, 1400),
  ].join('\n');
}

async function defaultRunOpsCheck() {
  return {
    service: 'bridge-service',
    active: 'unknown',
    health: 'not configured in local mode',
    watchdog: 'unknown',
    commit: 'unknown',
  };
}

async function buildOpsAgentReply(route, options = {}) {
  const result = await (options.runOpsCheck || defaultRunOpsCheck)(route.action);
  return [
    '服务器状态摘要：',
    `服务：${result.service}`,
    `服务状态：${result.active}`,
    `健康检查：${result.health}`,
    `watchdog：${result.watchdog}`,
    `代码版本：${result.commit}`,
  ].join('\n');
}

function buildChatAgentPrompt(text, memoryContext = buildMemoryContext()) {
  return [
    memoryContext,
    '',
    '请基于以上记忆，用中文简洁回答用户。不要编造服务器状态；需要实时状态时提示用户使用 /status。',
    `用户消息：${text}`,
  ].join('\n');
}

module.exports = {
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
  trimForReply,
};
```

- [ ] **Step 4: Run handler tests**

Run:

```powershell
node --test tests/agent-handlers.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit handlers**

Run:

```powershell
npm test
git diff --check
git add scripts/agents/agent-handlers.js tests/agent-handlers.test.js
git commit -m "Add agent handlers"
```

## Task 5: Integrate Router Into Feishu Bridge

**Files:**
- Modify: `scripts/feishu-bridge.js`
- Modify: `tests/feishu-bridge.test.js`

- [ ] **Step 1: Add failing integration tests**

Append to `tests/feishu-bridge.test.js`:

```javascript
test('createServer routes documentation questions without dispatching workflow', async () => {
  let reply;
  let dispatchCalled = false;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      OPENCLAW_CHAT_ENABLED: 'true',
    },
    {
      dispatch: async () => {
        dispatchCalled = true;
      },
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '老师任务还差哪些' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(dispatchCalled, false);
    assert.match(JSON.parse(reply.content).text, /已完成/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createServer blocks unauthorized ops commands', async () => {
  let reply;
  const server = createServer(
    {
      GITHUB_TOKEN: 'ghp_example',
      FEISHU_WEBHOOK_ASYNC: 'true',
      FEISHU_RESULT_NOTIFY_ENABLED: 'true',
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_ALLOWED_USER_IDS: 'user-b',
    },
    {
      receiptSender: async (message) => {
        reply = message;
      },
    },
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          sender: { sender_id: { open_id: 'user-a' } },
          message: {
            chat_id: 'chat-a',
            content: JSON.stringify({ text: '/status' }),
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(JSON.parse(reply.content).text, /未授权/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
```

- [ ] **Step 2: Run Feishu tests to verify failure**

Run:

```powershell
node --test tests/feishu-bridge.test.js
```

Expected: new doc routing test fails because current free chat path goes through model chat rather than doc-agent.

- [ ] **Step 3: Import router and handlers**

Modify the top of `scripts/feishu-bridge.js`:

```javascript
const { routeAgentIntent } = require('./agents/router');
const {
  buildChatAgentPrompt,
  buildDocAgentReply,
  buildMemoryAgentReply,
  buildOpsAgentReply,
} = require('./agents/agent-handlers');
const { buildMemoryContext } = require('./agents/memory-store');
```

- [ ] **Step 4: Add routed background handling before small talk/free chat**

Inside `runWebhookInBackground`, after the `shouldIgnorePassiveGroupMessage` block and before `parseSmallTalkMessage`, add:

```javascript
    const route = routeAgentIntent(text);
    if (route.requiresAuth && !isAuthorized(payload, env)) {
      Promise.resolve(receiptSender(buildFeishuTextMessage(payload, getUnauthorizedMessage(env), env))).catch((error) => {
        console.error(`Feishu routed unauthorized reply failed: ${error.message}`);
      });
      return;
    }

    if (route.agent === 'doc-agent') {
      Promise.resolve(receiptSender(buildFeishuTextMessage(payload, buildDocAgentReply(text), env))).catch((error) => {
        console.error(`Feishu doc agent reply failed: ${error.message}`);
      });
      return;
    }

    if (route.agent === 'memory-agent') {
      Promise.resolve(receiptSender(buildFeishuTextMessage(payload, buildMemoryAgentReply(route), env))).catch((error) => {
        console.error(`Feishu memory agent reply failed: ${error.message}`);
      });
      return;
    }

    if (route.agent === 'ops-agent') {
      Promise.resolve(buildOpsAgentReply(route))
        .then((replyText) => receiptSender(buildFeishuTextMessage(payload, replyText, env)))
        .catch((error) => {
          console.error(`Feishu ops agent reply failed: ${error.message}`);
        });
      return;
    }
```

Then update free chat prompt by changing:

```javascript
      Promise.resolve(chat(text, env))
```

to:

```javascript
      const routedText = route.agent === 'chat-agent' ? buildChatAgentPrompt(text, buildMemoryContext()) : text;
      Promise.resolve(chat(routedText, env))
```

Leave the existing UI automation path intact. `ui-test-agent` should continue to reach the existing automation branch.

- [ ] **Step 5: Run Feishu tests**

Run:

```powershell
node --test tests/feishu-bridge.test.js
```

Expected: all Feishu bridge tests pass.

- [ ] **Step 6: Run full tests and commit**

Run:

```powershell
npm test
git diff --check
git add scripts/feishu-bridge.js tests/feishu-bridge.test.js
git commit -m "Route Feishu messages to lightweight agents"
```

## Task 6: Server Ops Whitelist

**Files:**
- Modify: `scripts/agents/agent-handlers.js`
- Modify: `tests/agent-handlers.test.js`

- [ ] **Step 1: Add failing ops command tests**

Append to `tests/agent-handlers.test.js`:

```javascript
test('buildOpsAgentReply rejects unknown ops actions', async () => {
  const reply = await buildOpsAgentReply({ action: 'rm -rf /' }, {
    runOpsCheck: async () => {
      throw new Error('should not run unknown action');
    },
  });

  assert.match(reply, /不支持的运维指令/);
});
```

- [ ] **Step 2: Run handler tests to verify failure**

Run:

```powershell
node --test tests/agent-handlers.test.js
```

Expected: FAIL because unknown action is not rejected before runner.

- [ ] **Step 3: Implement whitelist guard**

In `scripts/agents/agent-handlers.js`, add:

```javascript
const ALLOWED_OPS_ACTIONS = new Set(['status', 'health', 'watchdog', 'logs']);
```

At the start of `buildOpsAgentReply`:

```javascript
  if (!ALLOWED_OPS_ACTIONS.has(route.action)) {
    return `不支持的运维指令：${route.action}`;
  }
```

Export `ALLOWED_OPS_ACTIONS` for tests if needed.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npm test
git diff --check
git add scripts/agents/agent-handlers.js tests/agent-handlers.test.js
git commit -m "Guard ops agent with whitelist"
```

## Task 7: Documentation Update

**Files:**
- Modify: `docs/飞书桥梁服务使用说明.md`
- Modify: `docs/AI接手核云服务器运维手册.md`

- [ ] **Step 1: Update Feishu bridge usage docs**

Add a section to `docs/飞书桥梁服务使用说明.md` before the result card section:

```markdown
## Agent Router、记忆和技能

桥梁服务支持轻量 Agent Router。它不是多个并发 OpenClaw CLI，而是在同一个服务里按意图分工：

- `chat-agent`：普通聊天
- `ui-test-agent`：触发 UI 自动化
- `ops-agent`：安全状态检查
- `doc-agent`：回答任务进度和接手问题
- `memory-agent`：读取或记录非敏感记忆

可用命令：

```text
/status
/health
/watchdog
/memory
/memory remember OpenClaw 已加串行队列
老师任务还差哪些
```

安全限制：

- 运维和测试命令需要授权用户。
- 记忆系统拒绝保存疑似密钥、Token、密码。
- 不支持飞书任意 shell。
```

- [ ] **Step 2: Update AI handoff docs**

Add to `docs/AI接手核云服务器运维手册.md` near the architecture section:

```markdown
## Agent Router 和记忆

当前桥梁服务采用轻量 Agent Router：

```text
飞书消息 -> Router -> chat/ui-test/ops/doc/memory agent -> 白名单工具或回复
```

记忆文件在：

```text
data/memory/
```

技能说明在：

```text
docs/skills/
```

记忆文件只能保存非敏感事实。新 AI 接手时可以读取这些文件了解项目状态，但不能把服务器密码、Token、App Secret 写进去。
```

- [ ] **Step 3: Verify docs and commit**

Run:

```powershell
git diff --check
npm test
git add docs/飞书桥梁服务使用说明.md docs/AI接手核云服务器运维手册.md
git commit -m "Document agent router memory skills"
```

## Task 8: Deploy And Verify

**Files:**
- No code files if previous tasks are already committed.

- [ ] **Step 1: Push all commits**

Run:

```powershell
git push origin main
```

Expected: push succeeds.

- [ ] **Step 2: Deploy OpenClaw server**

Run on `38.76.178.91`:

```bash
cd /opt/OpenclawHomework
git fetch origin main
git merge --ff-only origin/main
npm test
systemctl restart openclaw-feishu-bridge
sleep 3
systemctl is-active openclaw-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Expected:

```text
active
{"ok":true}
```

- [ ] **Step 3: Deploy Hermes server**

Run on `38.76.188.94`:

```bash
cd /opt/OpenclawHomework
git fetch origin main
git merge --ff-only origin/main
npm test
systemctl restart hermes-feishu-bridge
sleep 3
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Expected:

```text
active
{"ok":true}
```

- [ ] **Step 4: Verify public health**

Run locally:

```powershell
Invoke-WebRequest -UseBasicParsing https://openclaw.evanshine.me/health | Select-Object -ExpandProperty Content
Invoke-WebRequest -UseBasicParsing https://hermes.evanshine.me/health | Select-Object -ExpandProperty Content
```

Expected both:

```json
{"ok":true}
```

- [ ] **Step 5: Manual Feishu smoke checks**

Send to the authorized Feishu chat:

```text
/memory
/status
老师任务还差哪些
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

Expected:

- `/memory` returns memory summary without secrets.
- `/status` returns service/watchdog/git summary.
- `老师任务还差哪些` returns doc-agent progress summary.
- UI automation still triggers GitHub Actions and later sends one report card.

## Self-Review

Spec coverage:
- Agent Router: Task 3 and Task 5.
- Memory files and safe memory store: Task 1 and Task 2.
- Skill documents: Task 1 and Task 7.
- Ops whitelist: Task 4 and Task 6.
- Feishu integration: Task 5.
- Deployment and verification: Task 8.

Placeholder scan:
- This plan contains no unfinished placeholders or incomplete task descriptions.
- All code tasks include concrete file paths, code blocks, commands, and expected outcomes.

Risk controls:
- Tests are written before implementation for each behavior change.
- OpenClaw/Hermes remain logical agents, not concurrent CLI processes.
- Ops commands are explicitly whitelisted.
- Memory rejects common secret patterns.
