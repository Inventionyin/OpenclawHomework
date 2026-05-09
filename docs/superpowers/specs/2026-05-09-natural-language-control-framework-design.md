# Natural Language Control Framework Design

## Goal

Make Hermes and OpenClaw route natural Chinese commands through a stable framework instead of adding one-off regex fixes for every phrase.

## Current Problem

The project already has useful routing in `scripts/agents/router.js`, model fallback in `scripts/feishu-bridge.js`, and safe multi-intent splitting in `scripts/agents/multi-intent-planner.js`. The weak point is that most decisions are still first-match rules. When the user says follow-up phrases such as "刚才那个总共多少", or combines several low-risk requests, the system can lose context or only handle the first intent.

## Architecture

The first phase adds a compatibility layer around the existing router:

1. Candidate layer: produce normalized intent candidates with agent, action, evidence, score, safety, and missing fields.
2. Decision layer: choose execute, clarify, or fallback based on score, ambiguity, and risk.
3. Context layer: store only recent route metadata per conversation, so short follow-ups can inherit topic without storing raw user text.
4. Golden cases: keep real Chinese examples as regression tests.

The explicit command and strong rule routes stay first. Dangerous actions still require clear wording and cannot be auto-expanded by model output or context hints.

## Data Flow

For local `routeAgentIntent` calls:

1. Normalize input.
2. Keep existing explicit commands and high-confidence rules.
3. If route is weak or ambiguous, ask the candidate/decision layer.
4. Fall back to existing router behavior.

For Feishu:

1. `resolveAgentRoute` gets the rule route.
2. If the rule route is weak, it may apply a fresh conversation hint.
3. If still weak and model planner is enabled, model planner can upgrade only safe high-confidence routes.
4. `buildRoutedAgentReply` records successful non-chat route metadata back to the context store.

## Safety

Dangerous operations include restart, repair, cleanup, shell execution, and peer execution. These rules apply:

- No context hint may turn a chat message into a dangerous operation.
- No model planner result may execute dangerous operations.
- Mixed dangerous and safe multi-intent text becomes clarification or safe fallback, not auto execution.
- The hint store never stores raw message text, tokens, passwords, URLs with keys, or API keys.
- Corrupt or missing hint files are ignored.

## Scope

This phase does not rewrite `router.js`, does not require a new database, and does not make LLM routing mandatory. It creates small modules that can be tested independently and gradually expanded.

## Test Strategy

Add tests for:

- Candidate generation and scoring.
- Decision behavior for safe, ambiguous, and dangerous candidates.
- Context hint read/write, TTL, corrupt JSON, and entry cap.
- Router golden cases for real Chinese commands.
- Feishu route resolution using fresh context only when the rule route is weak.

