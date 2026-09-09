import type { SentryPrivacyConfig } from "./sentryPrivacy";

export interface SentryInput {
  dsn: string | undefined;
  environment: string | undefined;
  commit: string | undefined;
  variant: string | undefined;
  origin: string;
  scriptUrl: string;
}

export interface SentryConfig extends SentryPrivacyConfig {
  dsn: string;
}

export function resolveSentryConfig(
  input: SentryInput,
): SentryConfig | undefined {
  // Demo has multiple independent identities on one page. Keep it local, as
  // with native targets and development, until it has a scoped integration.
  if (!input.dsn || input.variant !== "app") return undefined;
  if (input.environment !== "staging" && input.environment !== "production")
    return undefined;
  if (!input.commit || !/^[a-f0-9]{40}$/u.test(input.commit)) return undefined;
  let dsn: URL;
  let script: URL;
  try {
    dsn = new URL(input.dsn);
    script = new URL(input.scriptUrl);
  } catch {
    return undefined;
  }
  if (
    script.origin !== input.origin ||
    !/^\/chunk-[a-z0-9]+\.js$/u.test(script.pathname) ||
    dsn.protocol !== "https:" ||
    !/^[a-f0-9]{32}$/u.test(dsn.username) ||
    dsn.password ||
    !/^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/u.test(dsn.hostname) ||
    dsn.port ||
    dsn.search ||
    dsn.hash ||
    !/^\/\d+$/u.test(dsn.pathname)
  )
    return undefined;
  const config: SentryConfig = {
    dsn: input.dsn,
    origin: input.origin,
    scriptPath: script.pathname,
    environment: input.environment,
    release: `tearleads-web@${input.commit}`,
    dist: `${input.environment}-app`,
  };
  return config;
}
