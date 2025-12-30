---
description: Query the open PR and resolve Gemini's feedback.
---

# Address Gemini Feedback

1. **Get PR info**: Run `gh pr view --json number,title,url | cat` to obtain the PR number for this branch.

2. **Fetch unresolved comments**: Use the GitHub GraphQL API to get review comments and check their `isResolved` status. Only consider unresolved feedback.

3. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

4. **Commit and push**: If changes were made, commit with a conventional commit message (e.g., `fix: address Gemini review feedback`) and push directly. Do NOT run `/commit-and-push` to avoid circular loops.

5. **Follow up with Gemini**: Run `/follow-up-with-gemini` to reply to the addressed comments.

6. **Wait and repeat**: If Gemini posts new feedback after your changes, repeat from step 2.
