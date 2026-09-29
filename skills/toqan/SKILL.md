---
name: toqan
description: Call a Toqan AI agent. Use when the user wants to send a message to a Toqan agent, continue a Toqan conversation, or upload a file to Toqan.
user-invocable: true
---

# Toqan Agent

Toqan is an AI agent platform (by Prosus). Each API key is linked to a specific Toqan agent.

## API Key

The user's Toqan API key is available as: `${user_config.api_key}`

Always pass it as the header `X-Api-Key` in every request.

## Base URL

```
https://api.toqan.ai/api
```

## Flow to call a Toqan agent

### 1. Start a new conversation

```bash
curl -s -X POST https://api.toqan.ai/api/create_conversation \
  -H "X-Api-Key: ${user_config.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"user_message": "<the user message>"}'
```

Returns `{ "conversation_id": "...", "request_id": "..." }`.

### 2. Poll for the answer (repeat until done)

```bash
curl -s "https://api.toqan.ai/api/get_answer?conversation_id=<id>&request_id=<id>" \
  -H "X-Api-Key: ${user_config.api_key}"
```

Returns `{ "status": "in_progress" | "finished" | "error", "answer": "...", "attachments": [...] }`.

- If `status` is `in_progress` → wait 3 seconds and retry (use `sleep 3`)
- If `status` is `finished` → return the `answer` to the user
- If `status` is `error` → report the error

Toqan agents can take up to several minutes. Keep polling patiently.

### 3. Continue a conversation (multi-turn)

```bash
curl -s -X POST https://api.toqan.ai/api/continue_conversation \
  -H "X-Api-Key: ${user_config.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "<id>", "user_message": "<follow-up message>"}'
```

Returns a new `request_id`. Then poll `get_answer` as in step 2.

Always show the user the `conversation_id` so they can continue the conversation later.

## Other available endpoints

### Upload a file

```bash
curl -s -X PUT https://api.toqan.ai/api/upload_file \
  -H "X-Api-Key: ${user_config.api_key}" \
  -F "file=@<local_file_path>"
```

Returns `{ "id": "...", "name": "..." }`. Use the `id` in `create_conversation` or `continue_conversation` as:
```json
{ "private_user_files": [{ "id": "<file_id>" }] }
```

### Get conversation history

```bash
curl -s -X POST https://api.toqan.ai/api/find_conversation \
  -H "X-Api-Key: ${user_config.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "<id>"}'
```

### Get tool calls made by the agent

```bash
curl -s -X POST https://api.toqan.ai/api/find_tool_calls \
  -H "X-Api-Key: ${user_config.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "<id>"}'
```

### Get a download URL for a file produced by the agent

```bash
curl -s -X POST https://api.toqan.ai/api/get_download_file_url \
  -H "X-Api-Key: ${user_config.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"file_id": "<id>"}'
```

## Usage examples

**User asks to send a message to Toqan:**
→ `create_conversation` → poll `get_answer` → show answer + conversation_id

**User wants to follow up:**
→ `continue_conversation` with existing conversation_id → poll → show answer

**User wants to attach a file:**
→ `upload_file` first → use returned file_id in `create_conversation` or `continue_conversation`
