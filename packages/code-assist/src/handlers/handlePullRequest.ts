import type { CodeAssistConfig } from "../config";
import { createInstallationClient } from "../github/appAuth";
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

  const result = await runReview({
    octokit,
    llm,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    model: params.review.model,
    severityThreshold: params.review.severityThreshold,
    maxComments: params.review.maxComments,
    styleguide: null,
  });

  const ref = `${params.owner}/${params.repo}#${params.pullNumber}`;
  if (result.skipped) {
    console.log(`${ref}: no reviewable diff, skipped`);
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
