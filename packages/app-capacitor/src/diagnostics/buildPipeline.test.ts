import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nativeSentryBuildEnvironment,
  readSentrySecrets,
} from "../../scripts/sentryBuildEnvironment";
import { uploadNativeSentryMaps } from "../../scripts/sentryReleaseArtifacts";
import { nativeSentryRelease } from "../../scripts/sentryReleaseConfig";

const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;

test("exported secrets load literally and only selected public values reach the build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sentry-build-env-"));
  try {
    const path = join(directory, "staging.env");
    await Bun.write(
      path,
      `# shell-compatible assignments\nexport SENTRY_ORG='tearleads'\nexport SENTRY_AUTH_TOKEN="synthetic-private-token"\nexport SENTRY_ANDROID_STAGING_DSN='${dsn}'\nexport SENTRY_ANDROID_STAGING_PROJECT='tearleads-android-staging'\nexport SENTRY_LITERAL='\${NOT_EXPANDED}'\n`,
    );
    const secrets = await readSentrySecrets(path);
    expect(secrets).toMatchObject({
      SENTRY_ORG: "tearleads",
      SENTRY_AUTH_TOKEN: "synthetic-private-token",
      SENTRY_LITERAL: `\${NOT_EXPANDED}`,
    });
    const release = nativeSentryRelease(
      "android",
      "staging",
      "b".repeat(40),
      secrets,
    );
    expect(release?.dsn).toBe(dsn);
    const apiUrl = "https://api-staging.tearleads.com";
    const parent: Record<string, string | undefined> = {
      ...secrets,
      VITE_SENTRY_DSN: "wrong-dsn",
      VITE_SENTRY_AUTH_TOKEN: "another-private-token",
      VITE_API_BASE_URL: apiUrl,
    };
    const build = nativeSentryBuildEnvironment(parent, release);
    expect(build).toEqual({
      VITE_API_BASE_URL: apiUrl,
      VITE_SENTRY_DSN: dsn,
      VITE_SENTRY_ENVIRONMENT: "staging",
      VITE_SENTRY_COMMIT: "b".repeat(40),
      VITE_SENTRY_PLATFORM: "android",
    });
    const { SENTRY_AUTH_TOKEN: originalToken } = parent;
    expect(originalToken).toBe("synthetic-private-token");
    expect(await readSentrySecrets(join(directory, "missing.env"))).toEqual({});
    expect(nativeSentryBuildEnvironment(parent, undefined)).toMatchObject({
      VITE_SENTRY_DSN: "",
      VITE_SENTRY_ENVIRONMENT: "",
      VITE_SENTRY_COMMIT: "",
      VITE_SENTRY_PLATFORM: "",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("maps are available to upload but cannot survive success, rejection, or a thrown upload error", async () => {
  for (const outcome of ["success", "reject", "throw"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "sentry-map-cleanup-"));
    try {
      await Bun.write(join(directory, "assets/main.js"), "safe-code");
      await Bun.write(
        join(directory, "assets/main.js.map"),
        "synthetic-source",
      );
      await Bun.write(
        join(directory, "nested/worker.js.map"),
        "synthetic-worker-source",
      );
      const operation = uploadNativeSentryMaps(directory, async () => {
        expect(
          await readFile(join(directory, "assets/main.js.map"), "utf8"),
        ).toBe("synthetic-source");
        if (outcome === "throw") throw new Error("Upload unavailable");
        return outcome === "success" ? 0 : 1;
      });
      if (outcome === "success") await operation;
      else await expect(operation).rejects.toThrow();
      expect(
        await Array.fromAsync(new Bun.Glob("**/*.map").scan(directory)),
      ).toEqual([]);
      expect(await readFile(join(directory, "assets/main.js"), "utf8")).toBe(
        "safe-code",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
