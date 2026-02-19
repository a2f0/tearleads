---
name: solicit-gemini-review
description: Request a fresh Gemini Code Assist review on the current PR, wait for review signals, and summarize any inline feedback.
---

# Solicit Gemini Review

Request a fresh review from Gemini Code Assist on the current PR.

## Steps

1. **Get PR number**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getPrInfo --fields number
   ```

   Extract the PR number from the JSON response.

2. **Trigger Gemini review and wait**:

   ```bash
   ./scripts/agents/tooling/agentTool.ts triggerGeminiReview --number $PR_NUMBER
   ```

   This action:
   - Posts a `/gemini review` comment on the PR
   - Polls every 15 seconds for up to 5 minutes (configurable via `--poll-timeout`)
   - Returns JSON with status:
     - `{"status": "review_received", "pr": N, "submitted_at": "..."}` - Gemini responded
     - `{"status": "review_requested", "pr": N, "timed_out": true}` - Timeout (review may still arrive)

3. **Get review threads** (if review was received):

   ```bash
   ./scripts/agents/tooling/agentTool.ts getReviewThreads --number $PR_NUMBER
   ```

   Filter for threads where the first comment is from `gemini-code-assist`.

4. **Check for quota exhaustion**: If Gemini's response contains "You have reached your daily quota limit":
   - Fall back to Claude Code review:

     ```bash
     if ! ./scripts/agents/tooling/agentTool.ts solicitClaudeCodeReview; then
       ./scripts/agents/tooling/agentTool.ts solicitCodexReview
     fi
     ```

   - Report that Gemini quota was exhausted and Claude Code was used instead

5. **Report**: Output a summary of Gemini's review (or Claude Code review if fallback was used) and any specific comments.

## Notes

- This is useful when you've made changes and want Gemini to re-review the PR
- Gemini will post new review comments if it finds issues
- Use `/address-gemini-feedback` after this to handle any new feedback

## Token Efficiency

The agentTool wrappers already use minimal JSON fields and handle output efficiently:

```bash
# Only fetch needed fields
./scripts/agents/tooling/agentTool.ts getPrInfo --fields number

# Review threads with pagination handled
./scripts/agents/tooling/agentTool.ts getReviewThreads --number $PR_NUMBER
```
