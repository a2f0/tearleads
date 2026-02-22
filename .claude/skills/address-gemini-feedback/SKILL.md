---
name: address-gemini-feedback
description: Query the open PR and resolve Gemini review feedback, replying in-thread via REST API.
---


# Address Gemini Feedback

**First**: Get PR info using the agentTool wrapper:

```bash
./scripts/agents/tooling/agentTool.ts getPrInfo --fields number,headRefName,url
```

Extract `number` as `PR_NUMBER` and `url` as `PR_URL` for use in subsequent commands.

## CRITICAL: Never Create Pending/Draft Reviews

When replying to Gemini comments, you MUST use the REST API to create immediate comment replies. Do NOT use `gh pr review` or GraphQL review mutations - these create pending/draft reviews that remain invisible until submitted, and Gemini will never see them.

**Always tag `@gemini-code-assist`** in every reply to ensure Gemini receives a notification and responds.

See `$follow-up-with-gemini` for the correct API usage and examples.

## Quota Exhaustion Fallback

Before fetching comments, check if Gemini has hit its daily quota:

```bash
./scripts/agents/tooling/agentTool.ts getPrInfo --fields comments
```

Parse the comments to check for Gemini's quota message. If the response contains "You have reached your daily quota limit":

- Fall back to Codex review:

  ```bash
  ./scripts/agents/tooling/agentTool.ts solicitCodexReview
  ```

- Skip the remaining steps (no Gemini feedback to address)
- Return early with a message that Codex was used as fallback

## Deferred Fix Tracking

When addressing feedback, distinguish between:

- **On-the-fly fixes**: Feedback you address immediately in this PR cycle
- **Deferred fixes**: Feedback you explicitly defer to a follow-up PR

**Do NOT defer fixes casually.** Only defer when:

- The fix is out of scope for the current PR
- The fix requires significant refactoring that would delay merge
- The reviewer explicitly agrees to defer

When deferring, add the item to the `deferred_items` state array (tracked by `$enter-merge-queue`):

```text
deferred_items.push({
  thread_id: <thread_node_id>,
  path: <file_path>,
  line: <line_number>,
  body: <summary of what needs to be done>,
  html_url: <link to the review thread>
})
```

Reply to the thread explaining the deferral:

```text
@gemini-code-assist This feedback is valid but out of scope for this PR. I'm deferring this to a follow-up issue that will be created after merge. The issue will be labeled `deferred-fix` and reference this thread.
```

Then resolve the thread.

## Steps

1. **Fetch unresolved comments**: Use the agentTool wrapper to get review threads:

   ```bash
   ./scripts/agents/tooling/agentTool.ts getReviewThreads --number $PR_NUMBER --unresolved-only
   ```

   This returns JSON array of unresolved review threads with:

   - `id`: Thread node ID (for resolving)
   - `isResolved`: Boolean (will be false due to `--unresolved-only`)
   - `path`: File path
   - `line`: Line number
   - `comments`: Array with `{id, databaseId, author: {login}, body}`

   The wrapper handles pagination automatically.

2. **Address feedback**: For each unresolved comment that you think is relevant/important:

   - **Fix on-the-fly** (preferred): Make the necessary code changes. Make sure linting passes and TypeScript compiles.
   - **Defer** (when necessary): Add to `deferred_items` and reply explaining the deferral.

3. **Commit and push** (if code changes were made): Commit with conventional message (e.g., `fix: address Gemini review feedback`), note the SHA for thread replies, and push directly (do NOT use `$commit-and-push` to avoid loops).

4. **CRITICAL: Verify push completed before replying.**

   After pushing, verify commits are visible on remote:

   ```bash
   BRANCH=$(git branch --show-current)
   git fetch origin "$BRANCH"
   LOCAL_SHA=$(git rev-parse HEAD)
   REMOTE_SHA=$(git rev-parse "origin/$BRANCH")

   if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
     echo "ERROR: Push not yet complete. Wait and retry."
     exit 1
   fi
   ```

   **Do NOT proceed to step 5 until this verification passes.** Replying to Gemini with "Fixed in commit X" when X is not yet on remote creates confusion.

5. **Update PR description**: If changes are significant, update the PR body with `gh pr edit --body`.

6. **Follow up**: Run `$follow-up-with-gemini` to reply, wait for confirmation, and resolve threads. The follow-up skill will re-verify push status before replying.

7. **Repeat**: If Gemini requests further changes, repeat from step 1.

## Token Efficiency

Suppress verbose output where only exit codes matter:

```bash
# Suppress lint/typecheck/test output
pnpm lint >/dev/null
pnpm typecheck >/dev/null
pnpm test >/dev/null

# Suppress git operations
git commit -S -m "message" >/dev/null
git push >/dev/null
```

Use `--json` with `--jq` filtering for `gh` commands to get only needed fields. On failure, re-run without suppression to debug.
