---
name: open-issue
description: Open a GitHub issue the user explicitly requested, assigned to the authenticated GitHub user, with a reviewable title and body.
---

# Open Issue

Open an issue only when the user explicitly asks for one; finding a bug,
recording evidence, or following another skill does not authorize it. Follow
repository guidance for where issues belong, labels, and templates.

Resolve the target repository with `agent-tool repo context` (its `repo`
field) from the checkout, or the `owner/repo` the user named; never infer it
from a folder name. Before creating, search open issues for a duplicate:

```sh
gh issue list --repo <owner/repo> --state open --search '<key words>' --json number,title,url
```

If one matches, report it instead of opening another, and assign it with
`gh issue edit <number> --repo <owner/repo> --add-assignee @me` when the user
wants it tracked.

Write a specific title and a body that states the observed behavior, the
expected behavior, and reproduction steps or evidence (commands, versions,
links). Never include secret values. Use only labels that already exist
(`gh label list --repo <owner/repo>`). Put the body in a temporary file, then
create the issue assigned to the authenticated GitHub user:

```sh
gh issue create --repo <owner/repo> --title '<title>' --body-file /path/to/issue-body.md --assignee @me
```

Always pass `--assignee @me`; assign other people only when the user names
them, in addition to `@me` unless the user says otherwise. Confirm the result
with `gh issue view <url> --json url,assignees` and, if the assignee is missing,
add it with `gh issue edit <url> --add-assignee @me`. Report the issue URL and
its assignees, or the exact error if assignment failed.
