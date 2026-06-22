import { Webhooks } from "@octokit/webhooks";
import { handlePullRequest } from "../handlers/handlePullRequest";
import type { ServerConfig } from "./serverConfig";

/**
 * Auto-review fires on PR open/reopen. New commits (synchronize) and the
 * interactive @mention re-check arrive in later phases, so a push does not yet
 * trigger a noisy re-review.
 */
export function createWebhooks(config: ServerConfig): Webhooks {
  const webhooks = new Webhooks({ secret: config.app.webhookSecret });

  webhooks.on(
    ["pull_request.opened", "pull_request.reopened"],
    ({ payload }) => {
      const installationId = payload.installation?.id;
      if (installationId === undefined) {
        console.warn("pull_request event without an installation id; ignoring");
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

  return webhooks;
}
