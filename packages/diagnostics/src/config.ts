import type { SentryPrivacyConfig } from "./privacy";

export interface SentryConfig extends SentryPrivacyConfig {
  dsn: string;
}

export function isHostedSentryDsn(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-f0-9]{32}$/u.test(url.username) &&
      !url.password &&
      /^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/u.test(url.hostname) &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/\d+$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isSentryEnvironment(
  value: unknown,
): value is "staging" | "production" {
  return value === "staging" || value === "production";
}

export function isSentryCommit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
