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

2. Find unresolved Gemini review comments using GraphQL.

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

3. For each unresolved comment that has been addressed and pushed, reply using the REST API:

   ```bash
   gh api repos/$REPO/pulls/$PR_NUMBER/comments/<comment_database_id>/replies \
     -f body="Fixed in commit <sha>. @gemini-code-assist Please confirm this addresses your feedback."
   ```

   - Include the commit SHA that fixed the issue
   - Tag @gemini-code-assist and ask for confirmation

   If deferring to an issue:
   - Example: "@gemini-code-assist Tracked in #456 for follow-up. This is out of scope for the current PR."

   If explaining why feedback doesn't apply:
   - Example: "@gemini-code-assist The code is correct as written because [explanation]. Could you please re-review?"

4. Do NOT comment on the main PR thread. Only reply inside discussion threads.

5. **Wait for Gemini's response**: Poll for Gemini's reply every 30 seconds (up to 5 minutes):
   - Use GraphQL to fetch the comment thread and check for new replies from `gemini-code-assist`
   - Confirmation detection:
     1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
     2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
     3. Only treat as confirmation if both conditions are met
   - Example of false positive to avoid: "Thank you for the update, but I still see an issue" - do NOT resolve

6. **Resolve satisfied comments**: When Gemini confirms, resolve the thread via GraphQL:

   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
   ```

7. If Gemini requests further changes, do NOT resolve - return to `/address-gemini-feedback`.
