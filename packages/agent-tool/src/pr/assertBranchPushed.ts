/**
 * `gh pr create` needs the head branch on the repository at the commit being
 * proposed, and this tool never pushes: a push runs the pre-push gate, which
 * the caller owns. Refuse clearly rather than let `gh` report a blank head.
 */
export function assertBranchPushed(input: {
  readonly branch: string;
  readonly localHead: string;
  readonly remoteHead: string | null;
}): void {
  if (input.remoteHead === null) {
    throw new Error(
      `Branch '${input.branch}' is not on the repository. openPr does not push; run 'git push -u origin ${input.branch}' first.`,
    );
  }
  if (input.remoteHead !== input.localHead) {
    throw new Error(
      `Branch '${input.branch}' is at ${input.remoteHead} on the repository but ${input.localHead} locally. Fetch and reconcile, then push (never force) before opening the PR.`,
    );
  }
}
