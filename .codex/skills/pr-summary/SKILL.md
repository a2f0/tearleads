---
name: pr-summary
description: Generate a concise summary for the current pull request using `agentTool`.
---

# PR Summary

Use this meta-skill whenever you need to articulate the current PR for reviewers, chat partners, or documentation. The skill runs the new `generatePrSummary` action in `agentTool` and prints a short overview of the title, state, description snippet, and changed files.

## Run steps

1. Invoke the helper:

```bash
./scripts/agents/tooling/agentTool.ts generatePrSummary
```

1. Optionally pass `--number <PR>` if you are targeting a PR that is not tied to the current branch, or `--branch <name>` to summarize a different branch. The command defaults to the current branch’s open PR.

1. Collect the text output and copy it into your PR description, release notes, or conversation.

## When to use

- After rebasing/landing key changes, so you can restate the delta for the reviewer.
- When a reviewer asks “what changed in this PR?” and you want a structured reply.
- As a starting point for adding a PR summary block to your PR body or release notes.
