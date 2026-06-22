import type { Octokit } from "@octokit/rest";
import type { ReviewComment } from "./mapFindingsToComments";

interface PostReviewParams {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly commitId: string;
  readonly comments: readonly ReviewComment[];
  readonly summary: string;
}

/**
 * Posts a single review (event COMMENT, so it never blocks merges) carrying all
 * inline comments at once — mirroring how the Gemini bot posted one review.
 */
export async function postReview(params: PostReviewParams): Promise<void> {
  await params.octokit.pulls.createReview({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    commit_id: params.commitId,
    event: "COMMENT",
    body: params.summary,
    comments: params.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    })),
  });
}
