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

1. **Fetch unresolved comments**: Use GitHub GraphQL API to get `reviewThreads` and filter by `isResolved: false`.

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
   }
   ```

   Then run:

   ```bash
   gh api graphql -F query=@/tmp/gemini-threads.graphql -f owner=a2f0 -f repo=tearleads -F pr=$PR_NUMBER
   ```

   Handle pagination via `pageInfo.hasNextPage` and `endCursor`.

2. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

3. **Commit and push**: Commit with conventional message (e.g., `fix: address Gemini review feedback`), note the SHA for thread replies, and push directly (do NOT use `/commit-and-push` to avoid loops).

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

6. **Follow up**: Run `/follow-up-with-gemini` to reply, wait for confirmation, and resolve threads. The follow-up skill will re-verify push status before replying.

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
