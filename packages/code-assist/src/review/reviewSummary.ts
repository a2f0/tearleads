export function buildReviewSummary(commentCount: number): string {
  return commentCount > 0
    ? `tearleads-code-assist reviewed this PR and left ${commentCount} comment(s).`
    : "tearleads-code-assist reviewed this PR and found no issues worth raising.";
}
