---
description: Query the open PR and resolve Gemini's feedback.
---

# Address Gemini Feedback

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

## CRITICAL: Never Create Pending/Draft Reviews

When replying to Gemini comments, you MUST use the REST API to create immediate comment replies. Do NOT use `gh pr review` or GraphQL review mutations - these create pending/draft reviews that remain invisible until submitted, and Gemini will never see them.

**Always tag `@gemini-code-assist`** in every reply to ensure Gemini receives a notification and responds.

See `/follow-up-with-gemini` for the correct API usage and examples.

## Steps

1. **Get PR info**: Run `gh pr view --json number,title,url | cat` to obtain the PR number for this branch.

2. **Fetch unresolved comments**: Use GitHub GraphQL API to get `reviewThreads` and filter by `isResolved: false`:

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

3. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

4. **Commit and push**: Commit with conventional message (e.g., `fix: address Gemini review feedback`), note the SHA for thread replies, and push directly (do NOT use `/commit-and-push` to avoid loops).

5. **Update PR description**: If changes are significant, update the PR body with `gh pr edit --body`.

6. **Follow up**: Run `/follow-up-with-gemini` to reply, wait for confirmation, and resolve threads.

7. **Repeat**: If Gemini requests further changes, repeat from step 2.
