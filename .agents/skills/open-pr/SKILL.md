---
name: open-pr
description: Open a GitHub pull request for the current feature branch with a validated title and a reviewable description.
---

# Open PR

Use the installed `agent-tool`. Follow repository policy for validation, commits,
and branch naming. Resolve the repository and default branch with Git and `gh`;
do not assume the branch is named main. Preserve unrelated work and finish
requested changes and appropriate checks before publishing them.

Ensure the intended commit is on a feature branch and push it through the
repository's normal push workflow, naming the PR repository's remote and branch
explicitly, as in `git push -u origin HEAD`; a bare push follows whatever
upstream the branch tracks, which may be a local branch. Respect existing push
authorization; do not bypass hooks. If the user only requested a draft
description, prepare that text without publishing a PR.

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
