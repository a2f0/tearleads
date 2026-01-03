---
description: Query the open PR and resolve Gemini's feedback.
---

# Address Gemini Feedback

1. **Get PR info**: Run `gh pr view --json number,title,url | cat` to obtain the PR number for this branch.

2. **Fetch unresolved comments**: Use GitHub GraphQL API to get `reviewThreads` and filter by `isResolved: false`. Handle pagination via `pageInfo.hasNextPage` and `endCursor`.

3. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

4. **Commit and push**: Commit with conventional message (e.g., `fix: address Gemini review feedback`), note the SHA for thread replies, and push directly (do NOT use `/commit-and-push` to avoid loops).

5. **Update PR description**: If changes are significant, update the PR body with `gh pr edit --body`.

6. **Follow up**: Run `/follow-up-with-gemini` to reply, wait for confirmation, and resolve threads.

7. **Repeat**: If Gemini requests further changes, repeat from step 2.
