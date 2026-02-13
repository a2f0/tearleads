---
description: Respond to Gemini's comments after resolving and pushing feedback.
---

# Follow Up With Gemini

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

## CRITICAL: Avoid Pending/Draft Reviews

**DO NOT** use any of these commands - they create pending reviews that Gemini will never see:

```bash
# WRONG - creates pending review
gh pr review --comment -b "message"
gh pr review --request-changes
gh api graphql -f query='mutation { addPullRequestReview(...) }'
```

**ALWAYS** use the REST API to reply directly to comment threads - these are immediately visible:

```bash
# CORRECT - creates immediate comment reply
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies -f body="message"
```

## CRITICAL: Always Tag @gemini-code-assist

**Every reply to a Gemini comment thread MUST include `@gemini-code-assist`** in the message body. Without this tag, Gemini may not receive a notification and won't respond to your reply. This applies whether you're:

- Confirming a fix was made
- Explaining why the code is correct (disagreeing with feedback)
- Asking for clarification
- Deferring to an issue

## Quota Exhaustion Fallback

If at any point Gemini responds with quota exhaustion ("You have reached your daily quota limit"):

- Fall back to Codex review:

  ```bash
  ./scripts/agents/tooling/agentTool.sh solicitCodexReview
  ```

- Skip waiting for Gemini's response
- Return early with a message that Codex was used as fallback

## Steps

1. Get the PR number: `gh pr view --json number,title,url | cat`

2. **CRITICAL: Verify commits are pushed to remote before replying.**

   Gemini and reviewers can only see commits that are visible on the remote. Before replying to ANY comment, verify your fix commits are actually pushed:

   ```bash
   # Get the current branch
   BRANCH=$(git branch --show-current)

   # Fetch latest remote state
   git fetch origin "$BRANCH"

   # Compare local HEAD with remote - they MUST match
   LOCAL_SHA=$(git rev-parse HEAD)
   REMOTE_SHA=$(git rev-parse "origin/$BRANCH")

   if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
     echo "ERROR: Local commits not yet pushed. Push first before replying."
     exit 1
   fi
   ```

   **Do NOT proceed to reply until this verification passes.** Replying with "Fixed in commit X" when commit X is not yet on remote creates confusion for reviewers.

3. Find unresolved Gemini review comments using the GraphQL API to check `isResolved` status.

   **IMPORTANT**: Do NOT pass the query inline with `-f query='...'` as the shell mangles special characters like `!`. Instead, write the query to a temp file first using the Write tool, then reference it:

   First, use the **Write tool** to create `/tmp/gemini-threads.graphql` with this content:

   ```graphql
   query($owner: String!, $repo: String!, $pr: Int!) {
     repository(owner: $owner, name: $repo) {
       pullRequest(number: $pr) {
         reviewThreads(first: 50) {
           nodes {
             id
             isResolved
             comments(first: 10) {
               nodes {
                 id
                 databaseId
                 author { login }
                 body
               }
             }
           }
           pageInfo { hasNextPage endCursor }
         }
       }
     }
   }
   ```

   Then run:

   ```bash
   gh api graphql -F query=@/tmp/gemini-threads.graphql -f owner=a2f0 -f repo=tearleads -F pr=$PR_NUMBER
   ```

4. For each unresolved comment that has been addressed and pushed (verified in step 2):
   - Reply directly using the REST API (NOT GraphQL reviews):

     ```bash
     # Use the databaseId from the comment you're replying to
     gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies \
       -f body="Fixed in commit abc1234. @gemini-code-assist Please confirm this addresses your feedback."
     ```

   - **Include the commit SHA** that fixed the issue (must be visible on remote per step 2)
   - Tag @gemini-code-assist and ask for confirmation

   If deferring to an issue instead of fixing directly:
   - Example: "@gemini-code-assist Tracked in #456 for follow-up. This is out of scope for the current PR."

   If explaining why feedback doesn't apply (disagreeing):
   - Example: "@gemini-code-assist The code is correct as written because [explanation]. Could you please re-review?"

5. Do NOT comment on the main PR thread. Only reply inside discussion threads.

6. **Wait for Gemini's response**: Poll for Gemini's reply every 30 seconds (up to 5 minutes):
   - Use GraphQL to fetch the comment thread and check for new replies from `gemini-code-assist`
   - To detect confirmation:
     1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
     2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
     3. Only treat as confirmation if both conditions are met (positive phrase present AND no negative qualifiers)
   - Example of false positive to avoid: "Thank you for the update, but I still see an issue" contains "thank you" but also "but" and "still" - do NOT resolve

7. **Resolve satisfied comments**: When Gemini confirms, resolve the thread via GraphQL:

   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
   ```

   Get thread IDs from `repository.pullRequest.reviewThreads` query (handle pagination via `endCursor`).

8. If Gemini requests further changes, do NOT resolve - return to `/address-gemini-feedback`.

## Token Efficiency

Use `--json` with `--jq` filtering to minimize output from `gh` commands. The GraphQL queries above already return structured data - parse what you need and discard the rest.

```bash
# Only fetch needed fields
gh pr view --json number,title,url

# Suppress git operations
git commit -S -m "message" >/dev/null
git push >/dev/null
```
