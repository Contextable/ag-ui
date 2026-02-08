# Evaluation: Issue #568 Add-On Claim (AlexChim1231 Comments)

## Background

Issue #568 was originally about front-end tool results not being logged in the ADK Session DB. The original issue (filed by @rrazvd) was fixed and closed in November 2025. Starting from comment `#issuecomment-3833349865` (2026-02-02), @AlexChim1231 reported a similar/related issue with `ag-ui-adk==0.4.2` and `google-adk==1.23.0`.

## The Claim

AlexChim1231 reports that:
1. Front-end tool calls (`console_log`) execute successfully and render correctly in the UI
2. SSE events (including tool call + tool result) are emitted correctly
3. However, tool-related events are **never persisted** in the ADK session — `pending_tool_calls` remains populated after the tool completes
4. After a page refresh, the tool call history disappears because it was never stored

Their setup uses `assistant-ui` (not CopilotKit) as the front-end framework, with a standard Google ADK backend.

## @contextablemark's Position

@contextablemark suggested the issue might stem from:
- `externalId` being set to `"undefined"` in the assistant-ui adapter, which gets passed as `threadId` to the HttpAgent
- Edge cases related to session cache restoration (cold reboot, multiple processes, serverless environments)

## AlexChim1231's Rebuttal

AlexChim1231 argues:
- The `threadId` in the actual HTTP request is present and correct (not undefined)
- `externalId` is an `assistant-ui`-only concept that doesn't participate in building the HttpAgent request
- The issue appears to be at the lifecycle/persistence level, not transport or execution

## Investigation Findings

### Verdict: AlexChim1231 is correct that real bugs exist. Two confirmed issues are present on `main`.

After thorough code analysis of the ADK middleware (`integrations/adk-middleware/python/src/ag_ui_adk/`), I found **two known, documented bugs** that directly cause the symptoms AlexChim1231 describes. These bugs are already tracked internally and have `@pytest.mark.xfail` tests documenting them.

---

### Bug 1: Duplicate FunctionResponse Persistence (Issue #1074)

**Location:** `adk_agent.py:1629-1682` (the "tool results WITHOUT user message" path)

**Root Cause:** When a tool result arrives without an accompanying user message (which is the common case for front-end tool calls), the middleware persists the `FunctionResponse` **twice**:

1. **First persistence (line 1680):** The middleware explicitly calls `append_event(session, function_response_event)` to persist the `FunctionResponse` to the ADK session.

2. **Second persistence (line 1682 + 1763):** The middleware then sets `new_message = function_response_content` and passes it to `runner.run_async(new_message=new_message)`. ADK's Runner **also** appends `new_message` to the session as an event internally.

**Result:** The session ends up with **two** duplicate `FunctionResponse` events for the same tool call.

**Test Evidence:**
- File: `tests/test_lro_tool_response_persistence.py:164-281`
- Test: `test_tool_result_persists_single_function_response()`
- Status: `@pytest.mark.xfail` with reason: *"Known duplicate FunctionResponse persistence on main (issue #1074). Fix expected in PR #1075."*

**Impact:** This can confuse ADK's internal state tracking, particularly with `DatabaseSessionService` which is stricter about event consistency than `InMemorySessionService`.

---

### Bug 2: Incorrect `invocation_id` on FunctionResponse Events (Issue #957)

**Location:** `adk_agent.py:1609, 1671`

**Root Cause:** When creating the `FunctionResponse` event for persistence, the middleware uses:

```python
resume_invocation_id = stored_invocation_id or input.run_id
```

This prefers the **stored** `invocation_id` from a prior ADK run over the current AG-UI `run_id`. The stored `invocation_id` is an internal ADK identifier from the previous execution, not the current one.

**Why this matters:**
- `DatabaseSessionService` requires a valid `invocation_id` on all events
- For HITL (Human-in-the-Loop) resumption, `SequentialAgent` needs consistent `invocation_id` to restore its `current_sub_agent` position
- Using a stale `invocation_id` from a previous run can cause the ADK runner to misroute the function response

**Test Evidence:**
- File: `tests/test_lro_tool_response_persistence.py:294-384`
- Test: `test_function_response_has_correct_invocation_id()`
- Status: `@pytest.mark.xfail` with reason: *"On main the middleware uses the stored ADK invocation_id, not the AG-UI run_id."*

---

### How These Bugs Cause AlexChim1231's Symptoms

The sequence for AlexChim1231's `console_log` tool:

1. User sends message -> Agent calls `console_log` (front-end tool)
2. Middleware emits `TOOL_CALL_START` / `TOOL_CALL_END` events, adds to `pending_tool_calls`
3. Front-end executes the tool, renders result in UI
4. Front-end sends tool result back (ToolMessage with `role="tool"`)
5. Middleware detects tool result submission (`_is_tool_result_submission` returns `True`)
6. Middleware removes tool from `pending_tool_calls` list
7. **Bug 1:** Middleware persists `FunctionResponse` twice (once explicitly, once via `runner.run_async`)
8. **Bug 2:** The persisted `FunctionResponse` may have wrong `invocation_id`

The duplicate persistence (Bug 1) can cause ADK's `DatabaseSessionService` to reject or mishandle the session update. With `InMemorySessionService`, the duplicates are tolerated but may still cause issues depending on how the ADK runner processes them internally.

The wrong `invocation_id` (Bug 2) means when the runner processes the function response, it may not correctly associate it with the original function call, leading to the "pending" state never being fully resolved at the ADK session level.

---

### Assessment of @contextablemark's `externalId` Theory

AlexChim1231 is correct in their rebuttal. Looking at how assistant-ui works:

- `externalId` in assistant-ui's `initialize()` is separate from the `threadId` passed to the `HttpAgent`
- The actual HTTP request shown by AlexChim1231 has a valid `threadId` (`6a1a04fc-fe95-4989-a9d8-f39e502abe5a`)
- The middleware's thread-to-session mapping (`_session_lookup_cache`) would work correctly with this threadId

The `externalId` theory is a red herring for this particular issue. The root cause is in the middleware's tool result persistence logic, not in the thread ID handling.

### Assessment of "Edge Cases" Theory

@contextablemark asked if any of these apply:
- Restoring the tool cache following a cold reboot
- Multiple processes sharing the same cache
- Running in a serverless environment

AlexChim1231 confirmed none of these apply. And indeed, the bugs identified above would manifest in a **standard single-process, in-memory setup** — they are logic bugs in the persistence flow, not cache/concurrency issues.

---

## Recommendations

### For the Fix (PR #1075)

The fix should address both bugs:

1. **Bug 1 (Duplicate persistence):** When there are tool results WITHOUT a user message (the `elif active_tool_results:` branch at line 1629), the middleware should either:
   - **Option A:** Only persist via `append_event()` and pass `None` as `new_message` to `runner.run_async()` (if the runner supports it)
   - **Option B:** Skip the explicit `append_event()` and let the runner handle persistence via `new_message`

   Option A is cleaner because it gives the middleware explicit control over the event's `invocation_id`.

2. **Bug 2 (Wrong invocation_id):** The `FunctionResponse` event should use `input.run_id` (the current AG-UI run ID), not the stored ADK invocation_id. The stored invocation_id should only be passed to `runner.run_async()` for HITL resumption purposes, not used on the manually-created event.

### For the Issue Itself

AlexChim1231's report is valid and describes a real, reproducible bug that affects any front-end framework (not just assistant-ui). The issue should be:
1. Acknowledged as a confirmed bug
2. Tracked via the existing issue #1074 (or a new issue if preferred)
3. Resolved by PR #1075

---

## Key Files Referenced

| File | Lines | Description |
|------|-------|-------------|
| `integrations/adk-middleware/python/src/ag_ui_adk/adk_agent.py` | 1562-1682 | Tool result persistence logic (both bugs) |
| `integrations/adk-middleware/python/src/ag_ui_adk/adk_agent.py` | 1760-1778 | Where `new_message` is passed to `runner.run_async()` |
| `integrations/adk-middleware/python/src/ag_ui_adk/adk_agent.py` | 906-926 | Tool result detection (`_is_tool_result_submission`) |
| `integrations/adk-middleware/python/src/ag_ui_adk/adk_agent.py` | 1053-1112 | Tool result extraction (`_extract_tool_results`) |
| `integrations/adk-middleware/python/src/ag_ui_adk/adk_agent.py` | 376-460 | Pending tool call tracking |
| `integrations/adk-middleware/python/tests/test_lro_tool_response_persistence.py` | 164-384 | xfail tests documenting both bugs |
