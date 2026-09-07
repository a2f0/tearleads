const publicEnvironmentNames = [
  "BUN_PUBLIC_API_BASE_URL",
  "BUN_PUBLIC_WS_URL",
  "BUN_PUBLIC_APP_VERSION",
  "BUN_PUBLIC_GIT_SHA",
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
