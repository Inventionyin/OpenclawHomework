# Mailbox Action Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mailbox action registry so UI automation result emails route to real role mailboxes for `report`, `replay`, `files`, and `daily`.

**Architecture:** Add a JSON-based mailbox registry and a small routing layer in front of the existing SMTP sender. Keep the Feishu/GitHub workflow unchanged while splitting email notifications by action type.

**Tech Stack:** Node.js, CommonJS, JSON config, existing SMTP sender, Node test runner.

---

### Task 1: Add registry config

**Files:**
- Create: `config/mailbox-action-map.json`
- Create: `scripts/mailbox-action-config.js`
- Test: `tests/mailbox-action-config.test.js`

- [ ] Write failing config test
- [ ] Verify test fails
- [ ] Add config file and loader
- [ ] Verify test passes

### Task 2: Add router

**Files:**
- Create: `scripts/mailbox-action-router.js`
- Test: `tests/mailbox-action-router.test.js`

- [ ] Write failing router tests
- [ ] Verify test fails
- [ ] Add action resolution and env override support
- [ ] Verify test passes

### Task 3: Route UI result emails

**Files:**
- Modify: `scripts/feishu-bridge.js`
- Test: `tests/feishu-bridge.test.js`

- [ ] Add failing tests for `report / replay / files`
- [ ] Add mailbox message builders
- [ ] Replace generic single-recipient path with action routing
- [ ] Verify tests pass

### Task 4: Add daily summary

**Files:**
- Create: `scripts/daily-summary.js`
- Create: `tests/daily-summary.test.js`
- Modify: `scripts/feishu-bridge.js`

- [ ] Add failing daily summary tests
- [ ] Implement summary builder
- [ ] Implement `sendDailySummaryNotification(...)`
- [ ] Verify tests pass

### Task 5: Update docs

**Files:**
- Modify: `docs/飞书桥梁服务使用说明.md`
- Modify: `docs/云服务器接手说明.md`
- Modify: `docs/Hermes双服务器拆分部署说明.md`

- [ ] Document registry file path
- [ ] Document first-phase bindings
- [ ] Document env override keys
- [ ] Document daily summary entry point

### Task 6: Final verification

- [ ] Run focused tests
- [ ] Run `npm test`
- [ ] Confirm `report / replay / files / daily` are covered
