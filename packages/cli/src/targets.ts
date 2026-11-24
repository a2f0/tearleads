export const targets = {
  production: "https://api.tearleads.com",
  staging: "https://api-staging.tearleads.com",
  // The local API (scripts/dev/runApi.sh), at the URL the app uses in dev, so
  // the CLI and a local web session share one identity scope.
  development: "http://localhost:3001",
} as const;

export type TargetName = keyof typeof targets;

export function isTargetName(value: string): value is TargetName {
  return Object.hasOwn(targets, value);
}
