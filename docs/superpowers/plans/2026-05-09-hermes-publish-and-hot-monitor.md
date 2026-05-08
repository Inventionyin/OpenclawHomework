# Hermes Publish and Hot Monitor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Hermes generate WeChat Official Account articles from natural language, support draft and direct publish flows, and slow the hot monitor cadence to 30 minutes.

**Architecture:** Keep intent routing in `scripts/agents/router.js`, article rendering and WeChat API calls in a dedicated publisher module, and response formatting in `scripts/agents/agent-handlers.js`. Update the hot monitor installation default to 30 minutes so benefit and trend scans are less noisy and less expensive.

**Tech Stack:** Node.js, node:test, systemd timers, WeChat Official Account API, existing Hermes bridge and clerk agent modules.

---

### Task 1: Route WeChat article intents

**Files:**
- Modify: `scripts/agents/router.js`
- Test: `tests/router.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test('routeAgentIntent routes WeChat MP article draft and publish requests', () => {
  assert.deepEqual(routeAgentIntent('文员，公众号草稿：推荐几个 API 中转站'), {
    agent: 'clerk-agent',
    action: 'wechat-mp-draft',
    idea: '推荐几个 API 中转站',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，公众号直接发布：今天白嫖福利和 API 中转站推荐'), {
    agent: 'clerk-agent',
    action: 'wechat-mp-direct-publish',
    idea: '今天白嫖福利和 API 中转站推荐',
    requiresAuth: true,
  });
  assert.deepEqual(routeAgentIntent('文员，公众号发布刚才那篇'), {
    agent: 'clerk-agent',
    action: 'wechat-mp-publish-latest',
    requiresAuth: true,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/router.test.js --test-name-pattern "WeChat MP article"`
Expected: FAIL because the router does not yet understand these phrases.

- [ ] **Step 3: Write minimal implementation**

Add a `wechatArticleMatch` branch near the other clerk intent rules so `公众号草稿` maps to `wechat-mp-draft`, `公众号直接发布` maps to `wechat-mp-direct-publish`, and `公众号发布刚才那篇` maps to `wechat-mp-publish-latest`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/router.test.js --test-name-pattern "WeChat MP article"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agents/router.js tests/router.test.js
git commit -m "feat: route wechat mp article intents"
```

### Task 2: Implement WeChat article publisher

**Files:**
- Create: `scripts/wechat-mp-publisher.js`
- Test: `tests/wechat-mp-publisher.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test('buildWechatArticleDraft creates safe article html from an idea', () => {
  const draft = buildWechatArticleDraft('推荐今天能用的 API 中转站和白嫖福利', {
    now: new Date('2026-05-09T08:00:00.000Z'),
    author: 'Hermes',
    thumbMediaId: 'media-1',
  });

  assert.equal(draft.title, '今日 API 中转站和白嫖福利观察');
  assert.equal(draft.author, 'Hermes');
  assert.equal(draft.thumb_media_id, 'media-1');
  assert.match(draft.digest, /API 中转站/);
  assert.match(draft.content, /风险提示/);
  assert.match(draft.content, /2026-05-09/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wechat-mp-publisher.test.js`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create a module that:
- builds a safe HTML draft from an idea
- fetches `access_token`
- writes the latest draft `media_id` to local cache
- supports `draft` and `direct` modes
- supports `publish-latest` by reusing the cached draft `media_id`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wechat-mp-publisher.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wechat-mp-publisher.js tests/wechat-mp-publisher.test.js
git commit -m "feat: add wechat mp article publisher"
```

### Task 3: Attach the publisher to the clerk agent

**Files:**
- Modify: `scripts/agents/agent-handlers.js`
- Test: `tests/agent-handlers.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test('buildClerkAgentReply delegates WeChat MP article publishing', async () => {
  const reply = await buildClerkAgentReply({
    action: 'wechat-mp-direct-publish',
    idea: '今天白嫖福利和 API 中转站推荐',
  }, {
    publishWechatMpArticle: async (request) => {
      assert.equal(request.mode, 'direct');
      assert.equal(request.idea, '今天白嫖福利和 API 中转站推荐');
      return {
        ok: true,
        mode: 'direct',
        title: '今日 API 中转站和白嫖福利观察',
        mediaId: 'draft-media-1',
        publishId: 'publish-1',
      };
    },
  });

  assert.match(reply, /公众号文章/);
  assert.match(reply, /已提交发布/);
  assert.match(reply, /publish-1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-handlers.test.js --test-name-pattern "WeChat MP"`
Expected: FAIL before the handler knows the new action.

- [ ] **Step 3: Write minimal implementation**

Add a `buildWechatMpArticleReply()` helper and route the three WeChat article actions to it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-handlers.test.js --test-name-pattern "WeChat MP"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agents/agent-handlers.js tests/agent-handlers.test.js
git commit -m "feat: wire wechat mp publishing into clerk"
```

### Task 4: Slow the hot monitor cadence

**Files:**
- Modify: `scripts/hot-monitor.js`
- Modify: `scripts/install-hot-monitor.sh`
- Test: `tests/hot-monitor.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test('defaultHotMonitorOnCalendar uses a calmer 30 minute cadence', () => {
  assert.equal(defaultHotMonitorOnCalendar(), '*:0/30');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hot-monitor.test.js --test-name-pattern "calmer 30 minute cadence"`
Expected: FAIL until the helper is added.

- [ ] **Step 3: Write minimal implementation**

Add `defaultHotMonitorOnCalendar()` returning `*:0/30` and update `install-hot-monitor.sh` to default the timer to 30 minutes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hot-monitor.test.js --test-name-pattern "calmer 30 minute cadence"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hot-monitor.js scripts/install-hot-monitor.sh tests/hot-monitor.test.js
git commit -m "fix: slow hot monitor cadence"
```