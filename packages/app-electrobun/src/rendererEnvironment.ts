const publicEnvironmentNames = [
  "BUN_PUBLIC_API_BASE_URL",
  "BUN_PUBLIC_WS_URL",
  "BUN_PUBLIC_APP_VERSION",
  "BUN_PUBLIC_GIT_SHA",
  // Release diagnostics, selected per tier by scripts/withSentryReleaseEnv.ts
  // from SENTRY_ELECTROBUN_STAGING_DSN / SENTRY_ELECTROBUN_PRODUCTION_DSN.
  // Scoped to this target on purpose: a shell that already exported app-web's
  // BUN_PUBLIC_SENTRY_DSN must not route desktop events into the web project.
  // A build without ELECTROBUN_RELEASE_TIER leaves them undefined and local.
  "BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT",
  "BUN_PUBLIC_SENTRY_ELECTROBUN_DSN",
  "BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT",
];

export function createRendererEnvironmentDefines(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    publicEnvironmentNames.map((name) => [
      `process.env.${name}`,
      JSON.stringify(environment[name]) ?? "undefined",
    ]),
  );
}

export function createRendererBuildConfig(
  environment: Readonly<Record<string, string | undefined>>,
  entrypoint: string,
): Bun.BuildConfig {
  return {
    define: createRendererEnvironmentDefines(environment),
    entrypoints: [entrypoint],
    format: "esm",
    target: "browser",
  };
}
