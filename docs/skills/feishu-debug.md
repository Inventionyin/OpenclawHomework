# Feishu Debug Skill

Purpose: debug duplicate messages, missing receive_id, invalid receive_id, and webhook retries.

Checklist:
1. Feishu event subscription should only include `im.message.receive_v1`.
2. Webhook must return HTTP 200 quickly.
3. Duplicate cache should be enabled.
4. Replies should prefer current event `chat_id`, then sender `open_id`.
5. Events without reply targets should be ignored.
6. Nginx access logs and watchdog logs should be checked for callback storms.
