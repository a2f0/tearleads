---
description: Request a new review from Gemini Code Assist
---

# Solicit Gemini Review

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')
```

Use `-R "$REPO"` with all `gh` commands in this skill.

Request a fresh review from Gemini Code Assist on the current PR.

## Steps

1. **Get PR info**: Run `gh pr view --json number,url | cat` to get the PR number.

2. **Request review**: Use the GitHub CLI to post a `/gemini review` comment on the PR:

   ```bash
   gh pr comment <pr-number> --body "/gemini review"
   ```

3. **Wait for review**: Poll for Gemini's review (up to 5 minutes):

   ```bash
   gh pr view <pr-number> --json reviews
   ```

   Check every 30 seconds until a new review from `gemini-code-assist` is found.

4. **Report**: Once Gemini has reviewed, output a summary of any new comments.

## Notes

- This is useful when you've made changes and want Gemini to re-review the PR
- Gemini will post new review comments if it finds issues
- Use `/address-gemini-feedback` after this to handle any new feedback
