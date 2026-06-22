import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { GithubAppConfig } from "../server/serverConfig";

/**
 * Builds an Octokit authenticated as a specific App installation. The strategy
 * mints and refreshes short-lived (1 hour) installation tokens automatically.
 */
export function createInstallationClient(
  app: GithubAppConfig,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: app.appId,
      privateKey: app.privateKey,
      installationId,
    },
  });
}
