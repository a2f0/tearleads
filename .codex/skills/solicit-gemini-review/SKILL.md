---
name: solicit-gemini-review
description: Request a fresh Gemini Code Assist review on the current PR, wait for review signals, and summarize any inline feedback.
---

# Solicit Gemini Review

Request a new Gemini Code Assist review on the current PR.

## Setup

Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Always pass `-R "$REPO"` to `gh` commands that support it.

## Workflow

1. Get PR number for the current branch:

```bash
PR_NUM=$(gh pr view --json number -q .number)
```

1. Request a Gemini review by posting the command comment:

```bash
gh pr comment "$PR_NUM" -R "$REPO" --body "/gemini review"
```

1. Wait for Gemini review (poll up to 5 minutes):

```bash
gh pr view "$PR_NUM" -R "$REPO" --json reviews \
  --jq '.reviews[] | select(.author.login == "gemini-code-assist")'
```

Poll every 30 seconds until a matching review appears.

1. Fetch Gemini inline review comments:

```bash
gh api /repos/$REPO/pulls/$PR_NUM/comments \
  --jq '.[] | select(.user.login == "gemini-code-assist[bot]") | {path, line, body}'
```

1. Summarize results:

- Report whether a Gemini review was found.
- List unresolved or actionable inline comments.
- Recommend running `address-gemini-feedback` next when comments exist.

## Important Notes

- Do not run `gh pr view -R "$REPO"` without specifying PR number or branch context.
- Use in-thread replies for follow-up on review comments (REST replies endpoint), not `gh pr review`.

## Token Efficiency

Use `--json` with `--jq` filtering to minimize output:

```bash
# Only fetch needed fields
gh pr view --json number -q .number
gh pr view --json reviews --jq '.reviews[] | select(...)'

# Filter comments to relevant author
gh api ... --jq '.[] | select(.user.login == "gemini-code-assist") | {path, line, body}'
```
