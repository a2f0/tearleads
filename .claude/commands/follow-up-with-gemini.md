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

## Steps

1. Get the PR number: `gh pr view --json number,title,url | cat`

2. Find unresolved Gemini review comments using the GraphQL API to check `isResolved` status:

   ```bash
   gh api graphql -f query='
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
     }' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
   ```

3. For each unresolved comment that has been addressed and pushed:
   - Reply directly using the REST API (NOT GraphQL reviews):

     ```bash
     # Use the databaseId from the comment you're replying to
     gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_database_id}/replies \
       -f body="Fixed in commit abc1234. @gemini-code-assist Please confirm this addresses your feedback."
     ```

   - **Include the commit SHA** that fixed the issue
   - Tag @gemini-code-assist and ask for confirmation

   If deferring to an issue instead of fixing directly:
   - Example: "Tracked in #456 for follow-up. This is out of scope for the current PR."

4. Do NOT comment on the main PR thread. Only reply inside discussion threads.

5. **Wait for Gemini's response**: Poll for Gemini's reply every 30 seconds (up to 5 minutes):
   - Use GraphQL to fetch the comment thread and check for new replies from `gemini-code-assist`
   - To detect confirmation:
     1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
     2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
     3. Only treat as confirmation if both conditions are met (positive phrase present AND no negative qualifiers)
   - Example of false positive to avoid: "Thank you for the update, but I still see an issue" contains "thank you" but also "but" and "still" - do NOT resolve

6. **Resolve satisfied comments**: When Gemini confirms, resolve the thread via GraphQL:

   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
   ```

   Get thread IDs from `repository.pullRequest.reviewThreads` query (handle pagination via `endCursor`).

7. If Gemini requests further changes, do NOT resolve - return to `/address-gemini-feedback`.
