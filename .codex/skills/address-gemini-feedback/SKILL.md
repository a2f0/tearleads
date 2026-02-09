---
name: address-gemini-feedback
description: Query the open PR and resolve Gemini review feedback, replying in-thread via REST API.
---

# Address Gemini Feedback

Resolve open Gemini review comments on the current PR.

## Setup

Determine repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Always pass `-R "$REPO"` where supported.

## Critical Rules

- Never use `gh pr review` to reply to Gemini comments.
- Never create pending/draft reviews for thread replies.
- Always reply in-thread with REST API and include `@gemini-code-assist`.

## Workflow

1. Get PR metadata for current branch:

```bash
gh pr view --json number,title,url,headRefName,baseRefName -R "$REPO"
```

1. Fetch unresolved review threads (GraphQL, paginate as needed):

```bash
gh api graphql -f query='\
  query($owner: String!, $repo: String!, $pr: Int!) {\
    repository(owner: $owner, name: $repo) {\
      pullRequest(number: $pr) {\
        reviewThreads(first: 50) {\
          nodes {\
            id\
            isResolved\
            path\
            line\
            comments(first: 10) {\
              nodes {\
                id\
                databaseId\
                author { login }\
                body\
              }\
            }\
          }\
          pageInfo { hasNextPage endCursor }\
        }\
      }\
    }\
  }' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
```

1. Implement fixes for important unresolved feedback.

1. Run relevant tests/lint/type-check.

1. Commit and push fixes directly (do not invoke commit-and-push recursively).

1. Reply in each addressed thread via REST API:

```bash
gh api -X POST /repos/$REPO/pulls/<pr_number>/comments/<comment_id>/replies \
  -f body="@gemini-code-assist Fixed in <commit_sha>. Please confirm this addresses the issue."
```

1. Repeat until no actionable unresolved Gemini comments remain.
