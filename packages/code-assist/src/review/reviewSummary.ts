export function buildReviewSummary(commentCount: number): string {
  return commentCount > 0
    ? `symcrypt-code-assist reviewed this PR and left ${commentCount} comment(s).`
    : "symcrypt-code-assist reviewed this PR and found no issues worth raising.";
}
