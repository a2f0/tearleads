---
description: Respond to Gemini's comments after resolving and pushing feedback.
---

# Follow Up With Gemini

1. Get the PR number: `gh pr view --json number,title,url | cat`

2. Find unresolved Gemini review comments using the GraphQL API to check `isResolved` status.

3. For each unresolved comment that has been addressed and pushed:
   - Reply directly to that comment thread using `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies`
   - Tag @gemini-code-assist and briefly explain that the feedback has been addressed
   - Example: "@gemini-code-assist This has been addressed in the latest push."

4. Do NOT comment on the main PR thread. Only reply inside discussion threads.
