---
name: pr-summary
description: Output a compact summary of the current PR using agentTool for OpenCode agents.
---

# PR Summary

Run the helper that prints the title, state, description snippet, and file list for a pull request. It powers cross-agent summaries and can be embedded into release notes.

```bash
./scripts/agents/tooling/agentTool.ts generatePrSummary
```

Use `--number <pr>` or `--branch <name>` to drive the summary for a non-current PR. Paste the resulting text wherever you need a consistent recap.
