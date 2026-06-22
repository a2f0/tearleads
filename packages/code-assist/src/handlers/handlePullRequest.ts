import type { CodeAssistConfig } from "../config";
import { createInstallationClient } from "../github/appAuth";
import { fetchExistingMarkerIds } from "../github/fetchExistingMarkers";
import { postReview } from "../github/postReview";
import { createLlmClient } from "../llm/deepseekClient";
import { buildReviewSummary } from "../review/reviewSummary";
import { runReview } from "../review/runReview";
import type { GithubAppConfig } from "../server/serverConfig";

interface HandlePullRequestParams {
  readonly app: GithubAppConfig;
  readonly review: CodeAssistConfig;
  readonly installationId: number;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
}

export async function handlePullRequest(
  params: HandlePullRequestParams,
): Promise<void> {
  const octokit = createInstallationClient(params.app, params.installationId);
  const llm = createLlmClient(
    params.review.deepseekApiKey,
    params.review.baseUrl,
  );
  const ref = `${params.owner}/${params.repo}#${params.pullNumber}`;

  const existingMarkerIds = await fetchExistingMarkerIds(
    octokit,
    params.owner,
    params.repo,
    params.pullNumber,
  );

  const result = await runReview({
    octokit,
    llm,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    model: params.review.model,
    existingMarkerIds,
    ignorePatterns: params.review.ignorePatterns,
    severityThreshold: params.review.severityThreshold,
    maxComments: params.review.maxComments,
    styleguide: null,
  });

  if (result.skipped) {
    console.log(`${ref}: no reviewable diff, skipped`);
    return;
  }
  if (result.comments.length === 0) {
    console.log(`${ref}: no new findings to post`);
    return;
  }

  await postReview({
    octokit,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    commitId: result.headSha,
    comments: result.comments,
    summary: buildReviewSummary(result.comments.length),
  });
  console.log(`${ref}: posted ${result.comments.length} comment(s)`);
}
