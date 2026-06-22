import type { CodeAssistConfig } from "../config";
import { createInstallationClient } from "../github/appAuth";
import { fetchFileWindow } from "../github/fetchFileWindow";
import { createLlmClient } from "../llm/deepseekClient";
import { recheckFinding } from "../review/recheckFinding";
import type { GithubAppConfig } from "../server/serverConfig";

interface HandleReviewCommentParams {
  readonly app: GithubAppConfig;
  readonly review: CodeAssistConfig;
  readonly installationId: number;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly headSha: string;
  readonly commentId: number;
  readonly rootCommentId: number;
  readonly path: string;
  readonly line: number | null;
  readonly body: string;
  readonly isBotAuthor: boolean;
}

/**
 * Replies to a review-thread comment that mentions the bot (e.g. "please confirm
 * this issue has been resolved") by re-reading the current code and judging
 * whether the original finding still applies. Ignores the bot's own comments so
 * it can never reply to itself.
 */
export async function handleReviewComment(
  params: HandleReviewCommentParams,
): Promise<void> {
  if (params.isBotAuthor || !params.body.includes(params.review.botHandle)) {
    return;
  }
  const octokit = createInstallationClient(params.app, params.installationId);

  let originalFinding = params.body;
  if (params.rootCommentId !== params.commentId) {
    const { data: root } = await octokit.pulls.getReviewComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: params.rootCommentId,
    });
    originalFinding = root.body;
  }

  const code = await fetchFileWindow(
    octokit,
    params.owner,
    params.repo,
    params.path,
    params.headSha,
    params.line,
  );
  const llm = createLlmClient(
    params.review.deepseekApiKey,
    params.review.baseUrl,
  );
  const verdict = await recheckFinding({
    client: llm,
    model: params.review.model,
    originalFinding,
    path: params.path,
    code,
    question: params.body,
  });

  await octokit.pulls.createReplyForReviewComment({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    comment_id: params.rootCommentId,
    body: verdict,
  });
  console.log(
    `${params.owner}/${params.repo}#${params.pullNumber}: re-check reply on ${params.path}`,
  );
}
