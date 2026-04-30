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
