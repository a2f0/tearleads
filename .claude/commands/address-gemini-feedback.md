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
             nodes {
               id
               isResolved
               path
               line
               comments(first: 10) {
                 nodes { body author { login } databaseId }
               }
             }
           }
         }
       }
     }
   '
   ```

3. **Address feedback**: For each unresolved comment that you think is relevant/important:
   - Make the necessary code changes
   - Make sure linting passes and TypeScript compiles

4. **Commit and push**: If changes were made, run `/commit-and-push` to commit and push the fixes.

5. **Follow up with Gemini**: Run `/follow-up-with-gemini` to:
   - Reply to the addressed comments asking Gemini to confirm
   - Wait for Gemini's response
   - Resolve threads where Gemini confirms the fix is satisfactory

6. **Wait and repeat**: If Gemini posts new feedback or requests further changes, repeat from step 2.
