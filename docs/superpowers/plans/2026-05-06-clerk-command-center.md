# Clerk Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real clerk command center so natural-language office requests can return a one-screen project overview while preserving existing report, email, task, mailbox, and training actions.

**Architecture:** Add a focused `clerk-command-center` module that assembles read-only state from `task-center`, usage ledger, mail ledger, and daily snapshot runs. Route broad overview phrases to a new `command-center` action, then let `agent-handlers` delegate command-center and daily-report formatting to the new module.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, existing router, task-center, mail-ledger, usage-ledger, daily-summary, daily-summary-snapshot

---

## File Map

- Create: `scripts/agents/clerk-command-center.js`
- Create: `tests/clerk-command-center.test.js`
- Modify: `scripts/agents/router.js`
- Modify: `tests/router.test.js`
- Modify: `scripts/agents/agent-handlers.js`
- Modify: `tests/agent-handlers.test.js`
- Modify: `docs/OpenClawHermes自然语言总控与GBrain升级.md`

## Task 1: Build Clerk Command Center Module

**Files:**
- Create: `scripts/agents/clerk-command-center.js`
- Create: `tests/clerk-command-center.test.js`

Steps:

- [ ] Add tests for `buildClerkCommandCenterState` using injected `summarizeDailyPlan`, `readUsageLedger`, `readMailLedger`, and `readDailySummarySnapshot`.
- [ ] Add tests for `buildClerkCommandCenterReply` asserting it includes one-screen overview, next actions, usage count, mail count, and latest run link.
- [ ] Implement `buildClerkCommandCenterState(options = {})`.
- [ ] Implement `buildClerkCommandCenterReply(options = {})`.
- [ ] Move daily preview assembly into `buildClerkDailyReportReply(route = {}, options = {})`, preserving existing reply text.
- [ ] Export all three functions.
- [ ] Run `node --test tests/clerk-command-center.test.js`.

## Task 2: Route Natural Office Overview Phrases

**Files:**
- Modify: `scripts/agents/router.js`
- Modify: `tests/router.test.js`

Steps:

- [ ] Add router tests for overview phrases:
  - `文员，给我一屏看懂`
  - `文员，今天有什么进展`
  - `文员，今天做了啥`
  - `文员，现在该怎么玩`
  - `文员，给我总览`
- [ ] Ensure explicit email route still wins for `文员，发送今天日报到邮箱`.
- [ ] Ensure explicit report preview still wins for `文员，把今天 UI 自动化结果发到邮箱`.
- [ ] Add `command-center` route branch in `routeClerkIntent`.
- [ ] Add matching broad office route in `routeOfficeIntent` for phrases without `文员` when safe.
- [ ] Run `node --test tests/router.test.js`.

## Task 3: Wire Agent Handler To New Module

**Files:**
- Modify: `scripts/agents/agent-handlers.js`
- Modify: `tests/agent-handlers.test.js`

Steps:

- [ ] Import `buildClerkCommandCenterReply` and `buildClerkDailyReportReply`.
- [ ] Add `route.action === 'command-center'` branch.
- [ ] Replace inline `daily-report` assembly with `buildClerkDailyReportReply(route, options)`.
- [ ] Keep `todo-summary` branch unchanged.
- [ ] Add tests for `buildClerkAgentReply({ action: 'command-center' })`.
- [ ] Update existing `daily-report` tests only if needed to preserve current behavior.
- [ ] Run `node --test tests/agent-handlers.test.js`.

## Task 4: Docs, Verification, Deploy

**Files:**
- Modify: `docs/OpenClawHermes自然语言总控与GBrain升级.md`

Steps:

- [ ] Add `command-center` to the 文员 action list.
- [ ] Add examples:
  - `文员，给我一屏看懂`
  - `文员，今天有什么进展`
  - `文员，现在该怎么玩`
- [ ] Run `npm test`.
- [ ] Run `git diff --check`.
- [ ] Commit as `feat: add clerk command center`.
- [ ] Push to `origin main`.
- [ ] Pull, test, restart, health-check both OpenClaw and Hermes servers.
