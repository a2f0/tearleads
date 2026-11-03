export const targets = {
  production: "https://api.tearleads.com",
  staging: "https://api-staging.tearleads.com",
} as const;

export type TargetName = keyof typeof targets;

export function isTargetName(value: string): value is TargetName {
  return Object.hasOwn(targets, value);
}
