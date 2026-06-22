import type { PullRequestFile } from "../github/fetchPullRequest";

/**
 * Rebuilds a unified diff from per-file patches (the listFiles API returns each
 * file's patch without a header). We prepend a git-style header so the model
 * knows the path each hunk belongs to.
 */
export function renderDiff(files: readonly PullRequestFile[]): string {
  return files
    .filter(
      (file): file is PullRequestFile & { patch: string } =>
        file.patch !== null,
    )
    .map(
      (file) =>
        `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}`,
    )
    .join("\n\n");
}
