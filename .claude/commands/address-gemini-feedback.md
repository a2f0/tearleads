---
description: Query the open PR and resolve Gemini's feedback.
---

# Address Gemini Feedback

**First**: Determine the repository and PR number:

```bash
# Get repo (works with -R flag)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Get PR number (infers from current branch - do NOT use -R flag here)
PR_NUMBER=$(gh pr view --json number --jq '.number')
```

**IMPORTANT**: Run these as separate commands, not chained with `&&`. The `gh pr view` command without arguments infers the PR from the current branch and does NOT work with `-R` flag. After capturing `PR_NUMBER`, use `-R "$REPO"` with explicit PR number for all subsequent `gh pr` commands (e.g., `gh pr view "$PR_NUMBER" -R "$REPO"`).

## CRITICAL: Never Create Pending/Draft Reviews

When replying to Gemini comments, you MUST use the REST API to create immediate comment replies. Do NOT use `gh pr review` or GraphQL review mutations - these create pending/draft reviews that remain invisible until submitted, and Gemini will never see them.

**Always tag `@gemini-code-assist`** in every reply to ensure Gemini receives a notification and responds.

See `/follow-up-with-gemini` for the correct API usage and examples.

## Steps

1. **Fetch unresolved comments**: Use GitHub GraphQL API to get `reviewThreads` and filter by `isResolved: false`:

   ```bash
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 50) {
             nodes {
               id
               isResolved
               path
               line
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

   Handle pagination via `pageInfo.hasNextPage` and `endCursor`.

2. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

3. **Commit and push**: Commit with conventional message (e.g., `fix: address Gemini review feedback`), note the SHA for thread replies, and push directly (do NOT use `/commit-and-push` to avoid loops).

4. **Update PR description**: If changes are significant, update the PR body with `gh pr edit --body`.

5. **Follow up**: Run `/follow-up-with-gemini` to reply, wait for confirmation, and resolve threads.

6. **Repeat**: If Gemini requests further changes, repeat from step 1.
