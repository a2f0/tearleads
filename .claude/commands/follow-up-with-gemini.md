---
description: Respond to Gemini's comments after resolving and pushing feedback.
---

# Follow Up With Gemini

1. Get the PR number: `gh pr view --json number,title,url | cat`

2. Find unresolved Gemini review comments using the GraphQL API to check `isResolved` status.

3. For each unresolved comment that has been addressed and pushed:
   - Reply directly to that comment thread using `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies`
   - Tag @gemini-code-assist and briefly explain that the feedback has been addressed, and ask Gemini to confirm.
   - Example: "@gemini-code-assist This has been addressed in the latest push, please confirm it is fixed to your satisfaction."

4. Do NOT comment on the main PR thread. Only reply inside discussion threads.

5. **Wait for Gemini's response**: Poll for Gemini's reply every 30 seconds (up to 5 minutes):
   - Use GraphQL to fetch the comment thread and check for new replies from `gemini-code-assist`
   - To detect confirmation:
     1. Look for positive phrases: "looks good", "resolved", "satisfied", "fixed", "approved", "thank you", "lgtm"
     2. Ensure the response does NOT contain negative qualifiers: "but", "however", "still", "issue", "problem", "not yet", "almost"
     3. Only treat as confirmation if both conditions are met (positive phrase present AND no negative qualifiers)
   - Example of false positive to avoid: "Thank you for the update, but I still see an issue" contains "thank you" but also "but" and "still" - do NOT resolve

6. **Resolve satisfied comments**: When Gemini confirms a fix is satisfactory, resolve the review thread:

   ```bash
   gh api graphql -f query='
     mutation {
       resolveReviewThread(input: {threadId: "<thread_node_id>"}) {
         thread { isResolved }
       }
     }
   '
   ```

   To get the thread node ID, use the GraphQL API to fetch review threads:

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
               comments(first: 10) {
                 pageInfo { hasNextPage endCursor }
                 nodes { body author { login } }
               }
             }
           }
         }
       }
     }
   '
   ```

   **Note on pagination**: If `pageInfo.hasNextPage` is true, make subsequent requests using the `endCursor` to fetch all items. This ensures no threads or comments are missed on PRs with high feedback volume.

7. If Gemini requests further changes instead of confirming, do NOT resolve the thread - return control to `address-gemini-feedback` to make additional fixes.
