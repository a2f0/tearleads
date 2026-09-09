import { expect, test } from "bun:test";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
import { nativeSentryRelease } from "../../scripts/sentryReleaseConfig";
import {
  type NativeSentryInput,
  resolveNativeSentryConfig,
} from "./sentryConfig";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const input: NativeSentryInput = {
  dsn,
  commit,
  environment: "staging",
  platform: "ios",
  runtimePlatform: "ios",
  productionBuild: true,
  origin: "https://localhost",
};
const manifest = {
  commit,
  environment: "staging",
  platform: "ios",
  paths: ["/assets/index-abc.js", "/assets/editor-def.js"],
};

test("each native platform and tier selects only its own project and release", () => {
  for (const platform of ["android", "ios"])
    for (const tier of ["staging", "production"] as const) {
      const prefix = `SENTRY_${platform.toUpperCase()}_${tier.toUpperCase()}`;
      const project = `tearleads-${platform}-${tier}`;
      const config = nativeSentryRelease(platform, tier, commit, {
        [`${prefix}_DSN`]: dsn,
        [`${prefix}_PROJECT`]: project,
        SENTRY_ORG: "tearleads",
        SENTRY_AUTH_TOKEN: "private-upload-token",
      });
      expect(config?.project).toBe(project);
      expect(config?.release).toBe(`tearleads-${platform}@${commit}`);
      expect(config?.environment).toBe(tier);
      expect(JSON.stringify(config)).not.toContain("private-upload-token");
      expect(nativeSentryRelease(platform, tier, commit, {})).toBeUndefined();
      expect(() =>
        nativeSentryRelease(platform, tier, commit, { [`${prefix}_DSN`]: dsn }),
      ).toThrow("upload token");
    }
  expect(() => nativeSentryRelease("web", "staging", commit, {})).toThrow();
  expect(() => nativeSentryRelease("ios", "prod", commit, {})).toThrow();
});

test("native runtime fails closed for dev, wrong platform, malformed DSN, or stale manifest", () => {
  expect(resolveNativeSentryConfig(input, manifest)?.release).toBe(
    `tearleads-ios@${commit}`,
  );
  for (const change of [
    { productionBuild: false },
    { runtimePlatform: "web" },
    { runtimePlatform: "android" },
    { dsn: "https://attacker.invalid/1" },
    { environment: "dev" },
    { commit: "unknown" },
  ]) {
    expect(
      resolveNativeSentryConfig({ ...input, ...change }, manifest),
    ).toBeUndefined();
  }
  for (const change of [
    { commit: "c".repeat(40) },
    { environment: "production" },
    { platform: "android" },
    { paths: [] },
    { paths: ["/assets/private/value.js"] },
  ]) {
    expect(
      resolveNativeSentryConfig(input, { ...manifest, ...change }),
    ).toBeUndefined();
  }
});

test("native errors retain only packaged code locations and finite mini-app activity", () => {
  const config = resolveNativeSentryConfig(input, manifest);
  if (!config) throw new Error("Expected configured native diagnostics");
  const secret = "SYNTHETIC_PRIVATE_CONTACT";
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "boundary", area: "explorer" },
      request: { url: secret },
      exception: {
        values: [
          {
            type: "TypeError",
            value: secret,
            stacktrace: {
              frames: [
                {
                  filename: `https://localhost/assets/index-abc.js?${secret}`,
                  lineno: 10,
                  function: secret,
                },
                {
                  filename: `https://localhost/assets/${secret}.js`,
                  lineno: 20,
                },
                {
                  filename: "https://localhost/assets/editor-def.js",
                  lineno: 30,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "app.activity",
          data: { area: "explorer", action: "move-to-trash", name: secret },
        },
        { category: "console", message: secret },
      ],
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toHaveLength(2);
  expect(event?.breadcrumbs).toEqual([
    {
      category: "app.activity",
      level: "info",
      data: { area: "explorer", action: "move-to-trash" },
    },
  ]);
  expect(JSON.stringify(event)).not.toContain(secret);
});
