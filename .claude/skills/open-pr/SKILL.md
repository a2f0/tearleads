---
name: open-pr
description: Open a GitHub pull request for the current feature branch with a validated title and a reviewable description.
---

# Open PR

Use the installed `agent-tool`. Follow repository policy for validation, commits,
and branch naming. Resolve the repository and default branch with `agent-tool repo context`;
do not assume the branch is named main. Preserve unrelated work and finish
requested changes and appropriate checks before publishing them.

Ensure the intended commit is on a feature branch and use
`agent-tool branch push <reviewed-head> --remote <remote>` through normal hooks.
It names the destination explicitly and verifies local/remote HEAD afterward;
a changed result needs another review. Respect existing push authorization.
If the user only requested a draft description, prepare it without publishing.

Write a title that satisfies the data-only `agent-tool.json` subject policy.
Describe the concrete resulting behavior and relevant validation. Put multiline
body text in a temporary file, then run:

```sh
agent-tool pr open 'feat: describe the change' < /path/to/pr-body.txt
```

Omitting the title uses the latest commit subject. The tool refuses duplicate
open PRs and requires the branch to be pushed at its local HEAD. It does not
push for you. Resolve a fork's head/base identities explicitly if the repository
uses fork PRs; the initial open helper supports same-repository branches.

Report the created PR link and any remaining validation or review work.
