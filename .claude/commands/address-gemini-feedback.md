---
description: Query the open PR and resolve Gemini's feedback.
---

# Update

Use the command `gh pr view --json number,title,url | cat` to obtain the PR number for this branch, and:

- Address any open feedback that you think is relevant / important (make sure not to consider resolved feedback).
- Make sure linting passes and typescript compiles.
- Write a one line PR description using conventional commit synax (do not commit just output it)
