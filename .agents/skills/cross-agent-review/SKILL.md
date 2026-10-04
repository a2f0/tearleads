---
name: cross-agent-review
description: Review committed branch changes with an independent Claude Code, Codex, or OpenCode reviewer, and repair actionable findings when requested.
---

# Cross-Agent Review

Use the installed `agent-tool` executable. Read the repository's development and
review policy and `agent-tool.json` when present. Keep project validation commands
and release rules in the repository; do not assume Bun, a workspace layout, or
particular CI job names.

Select a reviewer different from the coordinating agent when possible. Honor a
requested reviewer or effort; otherwise use an available independent reviewer.
Run `agent-tool doctor` if CLI compatibility is uncertain.

Review committed changes with `agent-tool review claude`, `agent-tool review codex`,
or `agent-tool review opencode`. Optional effort is `low`, `medium`, `high`,
`xhigh`, or `max`. For a local or non-GitHub repository, add `--base <commit-or-ref>`.
For a coordinated GitHub review, pin the fetched base using
`AGENT_TOOL_REVIEW_BASE_REF` and `AGENT_TOOL_REVIEW_BASE_OID`; fetch from the
repository that owns the PR, which can differ from the checkout's origin.

Record the exact base and HEAD before reviewing. The tool reviews raw committed
files and excludes worktree edits. A zero exit means a complete review was
returned; it does not mean the findings are non-blocking. Read the final
`VERDICT: BLOCKER|MAJOR|MINOR|SUGGESTION|CLEAN` and the findings. A reviewer
that labels findings `[P0]` through `[P3]` uses the same scale: `[P0]` and
`[P1]` are BLOCKER and MAJOR, `[P2]` and `[P3]` are MINOR and SUGGESTION.

If a CLI is unavailable, out of credits, or returns an unusable review, try another
available reviewer and disclose the fallback. Do not silently convert a failed
review into CLEAN or call an in-session review independent.

For report-only requests, report findings without changing files or history.
When repairs are authorized, address actionable BLOCKER and MAJOR findings,
validate with the repository's relevant checks, commit the repairs, and review
the new HEAD. Continue while meaningful progress is possible; report an impasse
when progress requires a material user decision. A repaired commit is unreviewed
until the next review completes. Preserve unrelated work.

Before reporting success, confirm HEAD still matches the reviewed commit and
that an existing PR points to that same commit. If the base moved, refresh it and
review again before shipping. Report reviewer, exact base and head IDs, verdict,
remaining findings, validation, and any repairs performed. This skill does not
authorize pushing, opening a PR, or merging unless the user requested that work.
