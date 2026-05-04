# Natural Language Server Ops Design

## Background

OpenclawHomework already supports slash-command style server operations such as `/status`, `/peer-status`, `/exec`, and `/peer-exec`. These capabilities work, but they are hard to discover in chat. The current pain point is not missing capability, but poor usability: the user does not know what to say, and the command surface feels too technical for everyday use.

The next iteration should make OpenClaw and Hermes feel more conversational for safe server operations while preserving the current authorization, peer-repair, and explicit shell boundaries.

## Goals

- Let the user ask common server questions in natural Chinese without memorizing slash commands.
- Make `你好` and `帮助` actively teach the available things the bot can do.
- Support natural-language restart and repair flows for OpenClaw and Hermes.
- Introduce confidence levels so dangerous actions are not triggered from vague chat.
- Preserve current explicit command paths for advanced users.

## Non-Goals

- Do not route arbitrary shell execution from free-form natural language.
- Do not remove existing `/status`, `/peer-status`, `/exec`, `/peer-exec`, `/peer-restart`, or `/peer-repair` commands.
- Do not delegate dangerous action decisions to the model alone.
- Do not relax authorization requirements for operations or repair actions.

## Approaches Considered

### 1. Help text only

Keep the current command system and just improve `你好` and `帮助`.

Pros:
- Smallest change
- Very low regression risk

Cons:
- User still has to remember commands
- Does not solve the "chat naturally" goal

### 2. Rules-first natural language router with tolerance

Add a deterministic natural-language layer for common server queries and restart/repair actions. Keep slash commands as the precise fallback.

Pros:
- Best balance of usability and safety
- Easy to test
- Predictable behavior for dangerous actions

Cons:
- Needs routing rules, confidence scoring, and more tests

### 3. Model-led operation intent detection

Let OpenClaw or Hermes chat models infer operational intent from user chat and decide whether to execute.

Pros:
- Most conversational

Cons:
- Too risky for restart and repair
- Harder to reason about and test

## Decision

Use approach 2.

Natural-language operational intent will be recognized by deterministic routing rules with limited typo tolerance and confidence levels. Explicit slash commands remain available as a stable fallback and for advanced usage.

## User Experience

### Greeting

When the user sends `你好`, the bot should:

- introduce itself
- say that it can inspect its own server and the peer server
- show 6 to 8 copyable example phrases
- mention that `帮助` returns the full list

### Help

When the user sends `帮助`, `你能做什么`, `我可以怎么说`, or similar messages, the bot should return categorized examples:

- view this server
- view the peer server
- restart and repair
- UI automation
- binding and authorization
- advanced slash commands

The help text should be concrete and example-driven rather than abstract.

### Query results

Server status results should be returned in plain Chinese, for example:

```text
我这台服务器目前正常。

内存：8G 总量，已用 3.1G，剩余 4.9G
硬盘：40G 总量，剩余 25G
负载：1m 0.12 / 5m 0.18 / 15m 0.20
服务：运行中
```

### Action results

Restart and repair results should use a two-step conversational style:

```text
我已经开始重启自己的桥梁服务。
稍等几秒，我会返回最新状态。
```

The second reply should summarize the fresh post-action status.

## Supported Natural-Language Intents

### View this bot's own server

Examples:

- 看看你自己的服务器状态
- 你这台机器正常吗
- 你现在内存多少
- 你硬盘还剩多少
- 你 CPU 高吗
- 你现在卡不卡
- 你负载高吗

Mapped operations:

- local status summary
- local memory summary
- local disk summary
- local CPU/load summary

### View the peer server

Examples:

- 看看 Hermes 的服务器状态
- Hermes 现在内存多少
- OpenClaw 硬盘还剩多少
- 看看对方机器负载
- 让 Hermes 看看自己的状态

Mapped operations:

- peer status summary
- peer memory summary
- peer disk summary
- peer CPU/load summary

### Restart

Examples:

- 重启你自己
- 重启 Hermes
- 重启 OpenClaw

Mapped operations:

- local restart
- peer restart

### Repair

Examples:

- 修复你自己
- 修复 Hermes
- 修复 OpenClaw

Mapped operations:

- local repair
- peer repair

## Confidence Model

Natural-language operational intents should be labeled with one of three confidence levels.

### High confidence

Definition:
- explicit target
- explicit action
- close match to supported phrase set

Behavior:
- safe read-only queries execute directly
- restart and repair execute directly
- log `confidence=high`

Examples:
- 你现在内存多少
- 看看你自己的服务器状态
- 重启你自己
- 修复 Hermes

### Medium confidence

Definition:
- intent appears likely
- wording is incomplete, typo-heavy, or target/action is somewhat ambiguous

Behavior:
- read-only queries may still execute directly
- restart and repair do not execute immediately
- bot asks a focused confirmation question

Examples:
- 你是不是有点卡
- 你重起一下
- Hermes 那边处理一下
- 看看 open claw 内存

### Low confidence

Definition:
- text is vague, mixed-intent, or too ambiguous to route safely

Behavior:
- do not execute
- reply with example phrases

Examples:
- 那个你帮我搞一下
- 是不是内存问题你看着办
- 你和 Hermes 谁卡谁修一下

## Tolerance Rules

Tolerance should be limited and deterministic.

Allowed tolerance:

- common typos such as `重起` -> `重启`
- common bot aliases such as `open claw` -> `OpenClaw`
- common colloquial forms such as `卡不卡` -> load or health check
- extra punctuation, duplicated spaces, and casing differences

Not allowed:

- arbitrary fuzzy command guessing for dangerous actions
- natural-language access to arbitrary shell
- guessing hidden intent from very vague action requests

## Safety Boundaries

- Natural-language read-only operations may map to safe status helpers.
- Natural-language restart and repair may map only to existing whitelisted actions.
- Arbitrary shell remains available only through explicit `/exec` and `/peer-exec`.
- Existing binding and authorization gates still apply.
- Passive group-chat suppression rules still apply.

## Architecture Changes

### Router

Extend the current rules-first router to support a natural-language ops branch before chat fallback.

Suggested route output shape:

```text
{
  agent: 'ops-agent',
  action: 'memory-summary' | 'disk-summary' | 'load-summary' | 'status' | 'restart' | 'repair' | 'peer-*',
  target: 'self' | 'peer' | 'openclaw' | 'hermes',
  confidence: 'high' | 'medium' | 'low',
  requiresAuth: true
}
```

### Ops agent

Extend the ops handler to:

- render human-readable summaries
- support follow-up confirmation replies for medium-confidence dangerous actions
- map summary actions to safe command helpers

### Help and greeting text

Update the current greeting and help responders to advertise copyable example phrases instead of only command names.

### Logging

For each natural-language ops route, log:

- raw text
- target
- action
- confidence
- whether execution was direct, confirmed, or rejected

## Testing Plan

Add tests for:

- greeting contains examples
- help contains categorized examples
- own-server natural-language queries route correctly
- peer-server natural-language queries route correctly
- high-confidence restart/repair routes directly
- medium-confidence restart/repair routes to confirmation instead of execution
- low-confidence requests return guided examples
- typo and alias tolerance works for supported cases
- natural language never opens arbitrary shell execution
- authorization gates remain in place

## Rollout Plan

1. Add design doc and approve behavior.
2. Add router tests for natural-language intent recognition.
3. Add handler tests for help, greeting, summary replies, and confidence behavior.
4. Implement read-only summaries first.
5. Implement natural-language restart and repair mapping.
6. Update documentation and final help copy.
7. Run full tests and deploy to both servers.

## Success Criteria

- The user can ask common server questions in Chinese without using slash commands.
- `你好` teaches the bot's main abilities.
- `帮助` teaches categorized example phrases for both bots.
- High-confidence dangerous requests such as `重启你自己` execute directly.
- Ambiguous restart and repair requests do not execute silently.
- Existing slash commands still work as before.
