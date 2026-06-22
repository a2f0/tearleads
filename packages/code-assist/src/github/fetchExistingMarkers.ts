import type { Octokit } from "@octokit/rest";
import { extractMarkerIds } from "./findingMarker";

/**
 * Marker ids already present in the PR's inline review comments. Only our bot
 * emits markers, so any marker found is one we previously posted — used to avoid
 * re-posting the same finding when a PR receives new commits.
 */
export async function fetchExistingMarkerIds(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<Set<string>> {
  const comments = await octokit.paginate(octokit.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return extractMarkerIds(comments.map((comment) => comment.body));
}
