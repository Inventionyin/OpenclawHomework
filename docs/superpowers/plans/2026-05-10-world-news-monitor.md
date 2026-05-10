# World News Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split global/world news from benefit/token monitoring and make news output precise enough to act on.

**Architecture:** Add a dedicated `scripts/world-news-monitor.js` module that fetches configured RSS/Atom feeds, normalizes timestamps, classifies stories, deduplicates by URL/title, and formats a Chinese Feishu digest. Keep `scripts/hot-monitor.js` focused on benefits/free resources by changing user-facing copy only.

**Tech Stack:** Node.js built-ins, existing Feishu bridge helpers, existing task-center JSON task records, systemd timer install script.

---

### Task 1: World News Module

**Files:**
- Create: `scripts/world-news-monitor.js`
- Test: `tests/world-news-monitor.test.js`

- [ ] **Step 1: Write tests for RSS parsing, classification, precision fields, and notification formatting**

Run: `node --test tests/world-news-monitor.test.js`
Expected: tests fail until the module exists.

- [ ] **Step 2: Implement `world-news-monitor.js`**

Required exports: `parseWorldFeedConfig`, `parseFeedItems`, `normalizeWorldNewsItems`, `buildWorldNewsDigest`, `formatWorldNewsMessage`, `runWorldNewsMonitor`, `defaultWorldNewsOnCalendar`.

- [ ] **Step 3: Verify tests pass**

Run: `node --test tests/world-news-monitor.test.js`
Expected: all tests pass.

### Task 2: Benefit Radar Copy Split

**Files:**
- Modify: `scripts/hot-monitor.js`
- Test: `tests/hot-monitor.test.js`

- [ ] **Step 1: Update hot-monitor title and section labels**

Change message heading from `30 分钟热点/福利雷达` to `福利雷达`.

- [ ] **Step 2: Verify hot-monitor tests**

Run: `node --test tests/hot-monitor.test.js`
Expected: all tests pass with updated assertions.

### Task 3: Install Script And Docs

**Files:**
- Create: `scripts/install-world-news-monitor.sh`
- Modify: `docs/AI接手核云服务器运维手册.md`
- Modify: `docs/飞书桥梁服务使用说明.md`

- [ ] **Step 1: Add systemd installer**

Default unit: `hermes-world-news-monitor`, default cadence: `09:10,15:10,21:10`, output: `/var/lib/openclaw-homework/world-news-latest.json`.

- [ ] **Step 2: Document channel split**

Document that world news and benefits are separate channels.

### Task 4: Verify, Commit, Deploy

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/world-news-monitor.test.js tests/hot-monitor.test.js`
Expected: all tests pass.

- [ ] **Step 2: Run full validation**

Run: `npm test` and `node scripts/agent-evals.js`
Expected: all tests/evals pass.

- [ ] **Step 3: Commit and push**

Commit message: `Split world news from benefit radar`.

- [ ] **Step 4: Deploy Hermes**

Run installer on Hermes and verify `hermes-world-news-monitor.timer` is active. Keep OpenClaw unchanged.
