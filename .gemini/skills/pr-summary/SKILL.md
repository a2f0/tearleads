---
name: pr-summary
description: Run the agentTool helper that collects the current PR’s state, description, and file list.
---

# PR Summary

Invoke the new `generatePrSummary` action when you want a concise, structured recap of the pull request.

1. Use the CLI wrapper:

```bash
./scripts/agents/tooling/agentTool.ts generatePrSummary
```

1. To target a different PR, add `--number <pr>`; to describe another branch, add `--branch <name>`.

1. Copy the multi-line output into your PR body or merge queue updates so reviewers always see the same framing.
