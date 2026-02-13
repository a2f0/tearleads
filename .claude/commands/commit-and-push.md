---
description: Commit staged changes and push to remote using conventional commits
---

# Commit and Push

**First**: Determine the repository for all `gh` commands:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` with all `gh` commands in this skill.

Track these state flags during execution:

- `gemini_quota_exhausted`: Boolean, starts `false`. Set to `true` when Gemini returns its daily quota message.
- `used_fallback_agent_review`: Boolean, starts `false`. Set to `true` after running one fallback cross-agent review.
- `deferred_items`: Array of `{thread_id, path, line, body, html_url}`, starts empty. Populated by `/address-gemini-feedback` when review feedback is deferred rather than fixed on-the-fly. Pass this state to `/enter-merge-queue` for issue creation.

Commit and push the current changes following these rules:

1. **Check branch**: If on `main`, create a new branch with an appropriate name based on the changes. After creating or switching branches, update the VS Code title:

   ```bash
   ./scripts/agents/tooling/agentTool.ts setVscodeTitle
   ```

2. **Analyze changes**: Run `git status` and `git diff --staged` to understand what's being committed.
   - If tooling reports actions (e.g., postinstall builds) but `git status` shows no unexpected changes, proceed without asking about generated files or extra diffs.

3. **Commit format**: Follow `CLAUDE.md` guidelines (conventional commits, GPG signed with 5s timeout, no co-author/footers, no binary files). Don't bump versions on PR branches - that happens in `main` CI (`main-version-bump` workflow).

4. **Push**: After successful commit, push to the current branch's remote.
   - The pre-push hook runs full builds and all unit tests; it can take several minutes. Use a longer command timeout and do not assume a timeout means failure.

5. **Verify push completed**: Before proceeding to PR creation or Gemini follow-up, verify the push actually completed:

   ```bash
   BRANCH=$(git branch --show-current)
   git fetch origin "$BRANCH"
   LOCAL_SHA=$(git rev-parse HEAD)
   REMOTE_SHA=$(git rev-parse "origin/$BRANCH")

   if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
     echo "ERROR: Push not yet complete. Retry push before proceeding."
     exit 1
   fi
   ```

   **Do NOT proceed to step 6 or 7 until this verification passes.** Replying to Gemini with "Fixed in commit X" when X is not yet visible on remote creates confusion.

6. **Open PR**: If no PR exists for this branch, create one with `gh pr create`. Do NOT include auto-close keywords (e.g., `Closes`, `Fixes`, `Resolves`) - all issues are marked `needs-qa` after merge via `/enter-merge-queue`. Use the Claude-style PR body format and include the computed agent ID.
   - To avoid shell escaping/substitution bugs in PR bodies, always render content with a **single-quoted heredoc** and pass it using `--body-file`.

   **Compute agent id**:

   ```bash
   AGENT_ID=$(basename "$(git rev-parse --show-toplevel)")
   ```

   **PR body template** (fill in real bullets, keep sections and ordering). Safe pattern:

   ```bash
   PR_BODY_FILE=$(mktemp)
   cat <<'EOF' > "$PR_BODY_FILE"
   ## Summary
   - <verb-led, concrete change>
   - <second concrete change if needed>

   ## Testing
   - <command run or "not run (reason)">

   ## Issue
   - #<issue-number>

   Agent: __AGENT_ID__
   EOF
   perl -0pi -e "s/__AGENT_ID__/${AGENT_ID}/g" "$PR_BODY_FILE"
   gh pr create ... --body-file "$PR_BODY_FILE"
   rm -f "$PR_BODY_FILE"
   ```

   If there is no associated issue, replace the `## Issue` section with:

   ```text
   ## Related
   - <link or short reference>
   ```

   After creating the PR, run:
   - `./scripts/agents/tooling/agentTool.ts setVscodeTitle`
   - `./scripts/agents/tooling/agentTool.ts tagPrWithTuxedoInstance`

7. **Wait for Gemini**: Wait 60 seconds for Gemini Code Assist to review.

8. **Check for quota exhaustion**: After waiting, check Gemini responses for quota limit:

   ```bash
   QUOTA_MSG="You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!"
   {
     gh pr view "$PR_NUMBER" -R "$REPO" --json reviews --jq '.reviews[].body' 2>/dev/null;
     gh api "/repos/$REPO/pulls/$PR_NUMBER/comments" --jq '.[].body' 2>/dev/null;
     gh api "/repos/$REPO/issues/$PR_NUMBER/comments" --jq '.[].body' 2>/dev/null;
   } | grep -F "$QUOTA_MSG"
   ```

   If that quota message is found at any point:

   - Set `gemini_quota_exhausted=true`.
   - If `used_fallback_agent_review=false`, run one fallback review via cross-agent review (Codex):

   ```bash
   # Equivalent skill invocation: /cross-agent-review codex
   ./scripts/agents/tooling/agentTool.ts solicitCodexReview
   ```

   - Set `used_fallback_agent_review=true`.
   - Skip further Gemini follow-ups for this run.
   - Proceed to `/enter-merge-queue` or end the skill

9. **Address feedback**: If `gemini_quota_exhausted=false`, run `/address-gemini-feedback` to handle unresolved comments.

   - Re-run the same quota check after each Gemini interaction (including follow-up replies). Quota exhaustion can appear after an initial review was already posted.
   - If quota is detected later, immediately apply step 8 fallback behavior and stop Gemini-specific follow-ups.
   - `/address-gemini-feedback` may populate `deferred_items` if any feedback is deferred rather than fixed on-the-fly.

   **IMPORTANT**: When replying to Gemini comments, use the agentTool wrappers:

   ```bash
   ./scripts/agents/tooling/agentTool.ts replyToComment --number $PR_NUMBER --comment-id <id> --body "message @gemini-code-assist"
   # Or for commit-fix replies:
   ./scripts/agents/tooling/agentTool.ts replyToGemini --number $PR_NUMBER --comment-id <id> --commit <sha>
   ```

   Do NOT use `gh pr review` - it creates pending/draft reviews that Gemini cannot see. **Always include `@gemini-code-assist` in your reply** to ensure Gemini receives a notification.

10. **Report state for downstream skills**: After completing feedback handling, report:
    - PR number and URL
    - Whether Gemini quota was exhausted
    - Any `deferred_items` that were collected

    If `deferred_items` is non-empty, mention that `/enter-merge-queue` will create a tracking issue with the `deferred-fix` label after merge.

## Token Efficiency (CRITICAL - DO NOT SKIP)

**MANDATORY**: ALL git commit and push commands MUST redirect stdout to `/dev/null`. Failure to do this wastes thousands of tokens on hook output.

### Required pattern for ALL git operations

```bash
# CORRECT - always use these forms
git commit -S -m "message" >/dev/null
git push >/dev/null

# WRONG - NEVER run without stdout suppression
git commit -m "message"  # Burns 1000+ tokens on pre-commit output
git push                 # Burns 5000+ tokens on pre-push output
```

### Why this is non-negotiable

- Husky pre-commit hooks output lint results, type-check results
- Husky pre-push hooks run full test suites and builds
- A single unsuppressed `git push` can add 5,000+ lines to context
- This is pure waste - on success, only exit code matters
- Errors go to stderr, which `>/dev/null` preserves
