---
name: ship-pr
description: Complete an authorized commit, independent review, repair, PR, CI, and squash-merge workflow for a GitHub repository.
---

# Ship PR

Use the installed `agent-tool`. Read repository guidance and policy first;
validation, versioning, package management, and hook installation remain project
concerns. Shipping authorizes this workflow within the user's stated scope.
Preserve unrelated edits and honor requested stopping points such as open-PR
only, report-only review, or keeping the feature branch.

1. Finish the requested change on a feature branch. Validate it with appropriate
   project checks and commit only the intended files.
2. Determine the current PR's base repository and branch, or the repository's
   default branch when no PR exists. Fetch and pin its exact base. Integrate it
   using the repository's normal workflow, resolving conflicts without losing
   user work. If project policy versions packages, prepare versions against the
   pinned base after every integration or repair and before each review, using
   the project's commands or `agent-tool versions prepare <base-oid>`, which
   commits bumped manifests and the refreshed lockfile.
   `agent-tool versions resolve-conflicts` resolves conflicts confined to
   version fields. Review the resulting committed HEAD with an independent
   reviewer using the bundled cross-agent-review skill. Repair blocking findings
   and review every changed HEAD again. Review failure blocks shipping.
3. Push the reviewed HEAD through normal hooks, then verify the pushed SHA still
   equals the reviewed SHA. If a hook changed content or HEAD, review that result.
   Open the PR using the open-pr skill, or update the existing PR as needed.
4. Allow any configured review bots time to respond, then fetch unresolved PR
   review threads. Follow repository policy for feedback: fix valid findings,
   reply in the original threads, and resolve only fully addressed comments.
   Validate, commit, push, and independently review every feedback or CI repair.
   Wait for CI, recheck the live base, PR base branch, and local and remote heads.
   A changed base requires integration, validation, and another review. When
   versions are managed, `agent-tool versions check <base-oid>` must pass for the
   live base. Use the squash-merge skill to merge the exact reviewed HEAD.
5. After confirmed MERGED, honor keep-branch; otherwise use the reset skill to
   return to the updated default branch and apply any documented project setup.
6. When the project deploys the merged branch, verify the deployment for the
   merge commit and run its documented live checks. Report deployment failures
   separately from a successful merge; follow project policy for repairs.

Never infer a clean review from process success alone or carry a review across
content changes. Do not weaken configured CI policy to get a merge through.
If a step fails, preserve useful intermediate work and report the concrete
remaining issue. Report PR link, merged commit, review verdict, validation, and
final checkout state.
