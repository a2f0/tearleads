---
name: follow-up-with-gemini
description: Respond to Gemini's comments after resolving and pushing feedback, wait for confirmation, and resolve satisfied threads.
---

# Follow Up With Gemini

Reply to Gemini review threads after pushing fixes, wait for confirmation, and resolve satisfied threads.

## Setup

Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Always pass `-R "$REPO"` to `gh` commands.

## Critical Rules

- **Avoid pending/draft reviews**: Do NOT use `gh pr review` or GraphQL review mutations - they create pending reviews that Gemini will never see.
- **Always tag @gemini-code-assist**: Every reply must include `@gemini-code-assist` in the message body to ensure Gemini receives a notification.
- **Use REST API for replies**: Reply directly using the comment reply endpoint.

## Workflow

1. Get PR number:

   ```bash
   PR_NUMBER=$(gh pr view --json number -q .number)
   ```

2. **CRITICAL: Verify commits are pushed to remote before replying.**

   Gemini can only see commits that are visible on the remote. Before replying to ANY comment, verify:

   ```bash
   BRANCH=$(git branch --show-current)
   git fetch origin "$BRANCH"
   LOCAL_SHA=$(git rev-parse HEAD)
   REMOTE_SHA=$(git rev-parse "origin/$BRANCH")

   if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
     echo "ERROR: Local commits not yet pushed. Push first before replying."
     exit 1
   fi
   ```

   **Do NOT proceed to reply until this verification passes.**

3. Find unresolved Gemini review comments using GraphQL.

   First, write the query to a temp file:

   ```bash
   cat > /tmp/gemini-threads.graphql <<'EOF'
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
   EOF
   ```

   Then run:

   ```bash
   gh api graphql -F query=@/tmp/gemini-threads.graphql -f owner=OWNER -f repo=REPO -F pr=$PR_NUMBER
   ```

4. For each unresolved comment that has been addressed and pushed (verified in step 2), reply using the parameterized agent tool action:

   ```bash
   ./scripts/agents/tooling/agentTool.ts replyToGemini \
     --number "$PR_NUMBER" \
     --comment-id <comment_database_id> \
     --commit <sha>
   ```

   - `replyToGemini` guarantees the reply includes `@gemini-code-assist` and the commit SHA
   - Use the exact commit SHA that fixed the issue

   If deferring to an issue:
   - Example: `./scripts/agents/tooling/agentTool.ts replyToComment --number "$PR_NUMBER" --comment-id <comment_database_id> --body "@gemini-code-assist Tracked in #456 for follow-up. This is out of scope for the current PR."`

   If explaining why feedback doesn't apply:
   - Example: `./scripts/agents/tooling/agentTool.ts replyToComment --number "$PR_NUMBER" --comment-id <comment_database_id> --body "@gemini-code-assist The code is correct as written because [explanation]. Could you please re-review?"`

5. Do NOT comment on the main PR thread. Only reply inside discussion threads.

6. **Wait for Gemini's response**: Poll for Gemini's reply every 30 seconds (up to 5 minutes):
   - Use GraphQL to fetch the comment thread and check for new replies from `gemini-code-assist`
   - Confirmation detection:
     1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
     2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
     3. Only treat as confirmation if both conditions are met
   - Example of false positive to avoid: "Thank you for the update, but I still see an issue" - do NOT resolve

7. **Resolve satisfied comments**: When Gemini confirms, resolve the thread via GraphQL:

   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
   ```

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
