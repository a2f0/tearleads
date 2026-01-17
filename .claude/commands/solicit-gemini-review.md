---
description: Request a new review from Gemini Code Assist
---

# Solicit Gemini Review

Request a fresh review from Gemini Code Assist on the current PR.

## Steps

1. **Get PR number and repo**: Get PR info without using `--repo` flag (it requires an argument):

   ```bash
   # Get PR number from current branch (no --repo flag needed)
   PR_NUM=$(gh pr view --json number -q .number)

   # Get repo for subsequent commands that need explicit repo
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```

2. **Request review**: Post a `/gemini review` comment on the PR:

   ```bash
   gh pr comment "$PR_NUM" -R "$REPO" --body "/gemini review"
   ```

3. **Wait for review**: Poll for Gemini's review (up to 5 minutes):

   ```bash
   gh pr view "$PR_NUM" -R "$REPO" --json reviews --jq '.reviews[] | select(.author.login == "gemini-code-assist")'
   ```

   Check every 30 seconds until a review from `gemini-code-assist` is found.

4. **Get review comments**: Fetch any inline comments Gemini left:

   ```bash
   gh api repos/${REPO}/pulls/${PR_NUM}/comments --jq '.[] | select(.user.login == "gemini-code-assist") | {path: .path, line: .line, body: .body}'
   ```

5. **Report**: Output a summary of Gemini's review and any specific comments.

## Important

- **Do NOT use `--repo` or `-R` without also specifying the PR number** - this causes an error
- Get the PR number first with `gh pr view --json number -q .number` (works without `--repo`)
- Then use `-R "$REPO"` with the PR number for subsequent commands

## Notes

- This is useful when you've made changes and want Gemini to re-review the PR
- Gemini will post new review comments if it finds issues
- Use `/address-gemini-feedback` after this to handle any new feedback
