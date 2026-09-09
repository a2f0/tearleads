import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";

export function nativeSentryRelease(
  platform: string,
  tier: string,
  commit: string,
  env: Record<string, string | undefined>,
) {
  if (
    (platform !== "android" && platform !== "ios") ||
    !isSentryEnvironment(tier)
  ) {
    throw new Error(
      "Native release requires android/ios and staging/production",
    );
  }
  const prefix = `SENTRY_${platform.toUpperCase()}_${tier.toUpperCase()}`;
  const dsn = env[`${prefix}_DSN`];
  if (!dsn) return undefined;
  const project = env[`${prefix}_PROJECT`];
  const { SENTRY_ORG: org, SENTRY_AUTH_TOKEN } = env;
  if (
    !isHostedSentryDsn(dsn) ||
    !isSentryCommit(commit) ||
    !project ||
    !org ||
    !SENTRY_AUTH_TOKEN
  ) {
    throw new Error(
      "Configured native Sentry release requires a valid DSN, commit, project, organization, and upload token",
    );
  }
  return {
    dsn,
    project,
    org,
    platform,
    environment: tier,
    commit,
    release: `tearleads-${platform}@${commit}`,
    dist: `${tier}-app`,
  };
}
