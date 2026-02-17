---
description: Generate a concise summary for the current pull request via agentTool.
---

# PR Summary

Use this skill when you need a short, reviewer-friendly recap of what the current PR contains. It runs the new `generatePrSummary` action so you can reproduce the same summary across agents.

## How to run

```bash
./scripts/agents/tooling/agentTool.ts generatePrSummary
```

Add `--number <pr>` to summarize a specific PR or `--branch <name>` to look at a branch other than the one you are on.

## What it returns

- Title + statement of states (state + merge status)
- Base/head/author information
- First few lines of the PR description and up to five changed file paths

Paste the output into your PR description, reviewer replies, or release note proposal.
