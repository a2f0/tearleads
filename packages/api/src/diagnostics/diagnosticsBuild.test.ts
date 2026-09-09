import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
import { diagnosticsBuild } from "../../scripts/diagnosticsBuild";
import { resolveApiSentryConfig } from "./sentryConfig";

test("the executable builder's trailing-slash root preserves absolute and relative API frames", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(root.endsWith("/")).toBe(true);
  const build = diagnosticsBuild(root);
  expect(build.sourceRoot.endsWith("/")).toBe(false);
  expect(build.commit).toMatch(/^[a-f0-9]{40}$/u);
  expect(build.sourcePaths).toContain("/packages/api/src/index.ts");
  expect(
    build.sourcePaths.some(
      (path) => path.includes("/app/") || path.includes(".test."),
    ),
  ).toBe(false);
  const config = resolveApiSentryConfig({
    ...build,
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "staging",
  });
  if (!config) throw new Error("Expected API diagnostics build configuration");
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: `${root}packages/api/src/index.ts`, lineno: 10 },
                { filename: "packages/api/src/index.ts", lineno: 20 },
                { filename: "app:///packages/api/src/index.ts", lineno: 30 },
              ],
            },
          },
        ],
      },
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual(
    [10, 20, 30].map((lineno) => ({
      filename: "app:///packages/api/src/index.ts",
      lineno,
      in_app: true,
    })),
  );
  expect(JSON.stringify(event)).not.toContain(root);
});
