---
description: Query the open PR and resolve Gemini's feedback.
---

# Address Gemini Feedback

1. **Get PR info**: Run `gh pr view --json number,title,url | cat` to obtain the PR number for this branch.

2. **Fetch unresolved comments**: Use the GitHub GraphQL API to get review threads and check their `isResolved` status. Only consider unresolved feedback.

   ```bash
   gh api graphql -f query='
     query {
       repository(owner: "<owner>", name: "<repo>") {
         pullRequest(number: <pr_number>) {
           reviewThreads(first: 100) {
             pageInfo { hasNextPage endCursor }
             nodes {
               id
               isResolved
               path
               line
               comments(first: 10) {
                 pageInfo { hasNextPage endCursor }
                 nodes { body author { login } databaseId }
               }
             }
           }
         }
       }
     }
   '
   ```

   **Note on pagination**: If `pageInfo.hasNextPage` is true, make subsequent requests using the `endCursor` to fetch all items. This ensures no threads or comments are missed on PRs with high feedback volume.

3. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

4. **Commit and push**: If changes were made, commit with a conventional commit message (e.g., `fix: address Gemini review feedback`) and push directly. Do NOT run `/commit-and-push` to avoid circular loops.

5. **Update PR description**: If the changes are significant or alter the original scope, update the PR body to reflect what was done:

   ```bash
   gh pr edit <pr-number> --body "$(cat <<'EOF'
   ## Summary
   - Original changes...
   - Additional: addressed Gemini feedback on X, Y, Z
   EOF
   )"
   ```

6. **Follow up with Gemini**: Run `/follow-up-with-gemini` to:
   - Reply to the addressed comments asking Gemini to confirm
   - Wait for Gemini's response
   - Resolve threads where Gemini confirms the fix is satisfactory

7. **Wait and repeat**: If Gemini posts new feedback or requests further changes, repeat from step 2.

## PR Description Guidelines

Keep the PR description accurate as you iterate:

- Add bullet points for significant changes made during review
- If the scope changed significantly, rewrite the summary
- Keep it concise - the commit history has the details
- Use `gh pr edit --body` to update
