import { Webhooks } from "@octokit/webhooks";
import { isTrustedAssociation } from "../github/trust";
import { handlePullRequest } from "../handlers/handlePullRequest";
import { handleReviewComment } from "../handlers/handleReviewComment";
import type { ServerConfig } from "./serverConfig";

/**
 * Auto-review fires on PR open/reopen and on new commits (synchronize, with
 * finding de-dup so a push only surfaces new issues). A mention of the bot on a
 * review thread triggers an interactive re-check of that finding.
 */
export function createWebhooks(config: ServerConfig): Webhooks {
  const webhooks = new Webhooks({ secret: config.app.webhookSecret });

  webhooks.on(
    [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
    ],
    ({ payload }) => {
      const installationId = payload.installation?.id;
      if (installationId === undefined) {
        console.warn("pull_request event without an installation id; ignoring");
        return;
      }
      // Do not ship untrusted code to the LLM or act on fork/external PRs.
      if (
        payload.pull_request.head.repo?.fork === true ||
        !isTrustedAssociation(payload.pull_request.author_association)
      ) {
        console.log(
          `PR #${payload.pull_request.number} from untrusted author ` +
            `(${payload.pull_request.author_association}); skipping auto-review`,
        );
        return;
      }
      const task = handlePullRequest({
        app: config.app,
        review: config.review,
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pullNumber: payload.pull_request.number,
      });
      // Acknowledge the webhook immediately; the review runs detached.
      void task.catch((error: unknown) => {
        console.error(
          `review failed for PR #${payload.pull_request.number}`,
          error,
        );
      });
    },
  );

  webhooks.on("pull_request_review_comment.created", ({ payload }) => {
    const installationId = payload.installation?.id;
    if (installationId === undefined) {
      console.warn("review comment event without an installation id; ignoring");
      return;
    }
    const { comment } = payload;
    // Only trusted repository members may steer a re-check; an arbitrary
    // commenter must not be able to drive an LLM reply posted under the bot's
    // identity (prompt-injection / spend abuse).
    if (!isTrustedAssociation(comment.author_association)) {
      console.log(
        `review comment from untrusted author ` +
          `(${comment.author_association}) on PR #${payload.pull_request.number}; ` +
          `skipping re-check`,
      );
      return;
    }
    const task = handleReviewComment({
      app: config.app,
      review: config.review,
      installationId,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pullNumber: payload.pull_request.number,
      headSha: payload.pull_request.head.sha,
      commentId: comment.id,
      rootCommentId: comment.in_reply_to_id ?? comment.id,
      path: comment.path,
      line: comment.line ?? null,
      body: comment.body,
      isBotAuthor: comment.user?.type === "Bot",
    });
    void task.catch((error: unknown) => {
      console.error(
        `re-check failed for PR #${payload.pull_request.number}`,
        error,
      );
    });
  });

  return webhooks;
}
