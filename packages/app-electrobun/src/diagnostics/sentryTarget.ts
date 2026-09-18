// The desktop builds a Sentry release reports from: the targets the pinned
// Hutch release ships. Each target
// reports under its own dist, because one commit's builds for different
// targets serve different bundles at the same app:/// URLs.
export const electrobunSentryTargets = [
  "linux-arm64",
  "linux-x64",
  "macos-arm64",
  "win-x64",
] as const;

export type ElectrobunSentryTarget = (typeof electrobunSentryTargets)[number];

export function isElectrobunSentryTarget(
  value: unknown,
): value is ElectrobunSentryTarget {
  return electrobunSentryTargets.some((target) => target === value);
}

// Hutch sets ELECTROBUN_OS and ELECTROBUN_ARCH to the target it is building,
// replacing any inherited value, both while it evaluates electrobun.config.ts
// and while it runs build hooks. A release for any other target stops.
export function hutchBuildTarget(
  environment: Readonly<Record<string, string | undefined>>,
): ElectrobunSentryTarget {
  const { ELECTROBUN_OS: os, ELECTROBUN_ARCH: arch } = environment;
  const target = `${os}-${arch}`;
  if (!isElectrobunSentryTarget(target))
    throw new Error(
      `Desktop Sentry releases support ${electrobunSentryTargets.join(", ")}, not Hutch target ${target}`,
    );
  return target;
}
