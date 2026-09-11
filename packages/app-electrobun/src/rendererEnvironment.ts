const publicEnvironmentNames = [
  "BUN_PUBLIC_API_BASE_URL",
  "BUN_PUBLIC_WS_URL",
  "BUN_PUBLIC_APP_VERSION",
  "BUN_PUBLIC_GIT_SHA",
];

// Release diagnostics, selected per tier by scripts/withSentryReleaseEnv.ts from
// SENTRY_ELECTROBUN_STAGING_DSN / SENTRY_ELECTROBUN_PRODUCTION_DSN. Scoped to
// this target on purpose: a shell that already exported app-web's
// BUN_PUBLIC_SENTRY_DSN must not route desktop events into the web project.
const releaseDiagnosticsNames = [
  "BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT",
  "BUN_PUBLIC_SENTRY_ELECTROBUN_DSN",
  "BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT",
];

export function createRendererEnvironmentDefines(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  // Only the release build sets NODE_ENV=production (see scripts/
  // buildElectrobun.sh), and it is the only path through the tier wrapper. The
  // dev server and Electrobun's own config read this process environment
  // directly, so without this gate a developer who had exported a desktop DSN
  // would ship their local session's errors to the release project.
  const { NODE_ENV } = environment;
  const release = NODE_ENV === "production";
  return Object.fromEntries(
    [...publicEnvironmentNames, ...releaseDiagnosticsNames].map((name) => [
      `process.env.${name}`,
      release || !releaseDiagnosticsNames.includes(name)
        ? (JSON.stringify(environment[name]) ?? "undefined")
        : "undefined",
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
