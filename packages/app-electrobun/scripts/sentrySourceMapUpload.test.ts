import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostedSentryEndpoint } from "./sentryCliUpload";
import {
  fixtureDsn,
  orgAuthToken,
  runHostileRelease,
  startAttacker,
  startFakeSentry,
} from "./sentrySourceMapUpload.testUtils";
import {
  bundleFiles,
  hostileMapVectors,
  sha256,
} from "./sentryStagedMaps.testUtils";
import { runDesktopSentryRelease } from "./withSentryReleaseEnv";

async function withServers(
  failing: boolean,
  run: (servers: {
    bundlePath: string;
    intended: ReturnType<typeof startFakeSentry>;
    attacker: ReturnType<typeof startAttacker>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "desktop-sourcemap-upload-"));
  const bundlePath = join(root, "bundle.zip");
  const intended = startFakeSentry(bundlePath, failing);
  const attacker = startAttacker();
  try {
    await run({ bundlePath, intended, attacker });
  } finally {
    intended.stop();
    attacker.stop();
    await rm(root, { recursive: true, force: true });
  }
}

function manifestFiles(bundlePath: string) {
  const manifest = Bun.spawnSync(["unzip", "-p", bundlePath, "manifest.json"]);
  expect(manifest.exitCode).toBe(0);
  const files: { url: string; headers?: Record<string, string> }[] =
    Object.values(JSON.parse(manifest.stdout.toString()).files);
  return files;
}

test("the release uploads exactly the renderer and main-process URLs, only to the intended endpoint and .secrets organization, whatever the ambient Sentry configuration", async () => {
  await withServers(false, async ({ bundlePath, intended, attacker }) => {
    const token = orgAuthToken(intended.url);
    const run = await runHostileRelease({
      intended: intended.url,
      attacker: attacker.url,
      token,
    });
    expect(run.code, run.output).toBe(0);
    expect(attacker.connections()).toBe(0);
    expect(intended.requests).toContain(
      "POST /api/0/organizations/test-org/chunk-upload/",
    );
    expect([...intended.authorizations]).toEqual([`Bearer ${token}`]);
    expect(
      intended.requests.filter(
        (request) => !request.includes(" /api/0/organizations/test-org/"),
      ),
    ).toEqual([]);
    expect([...intended.projects]).toEqual(["tearleads-electrobun-staging"]);
    expect(
      [...intended.releases].map((release) => release.split(" ")[1]),
    ).toEqual(["staging-app-macos-arm64"]);
    expect(run.buildDsn).toBe(fixtureDsn);
    const files = manifestFiles(bundlePath);
    expect(files.map((file) => file.url).sort()).toEqual([
      "app:///bun/index.js",
      "app:///bun/index.js.map",
      "app:///chunk-a1b2c3.js",
      "app:///chunk-a1b2c3.js.map",
    ]);
    for (const file of files.filter(({ url }) => url.endsWith(".js"))) {
      const headers = Object.fromEntries(
        Object.entries(file.headers ?? {}).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      );
      const { sourcemap } = headers;
      expect(sourcemap).toBe(`${file.url.split("/").at(-1)}.map`);
    }
    // Only the staged files' own bytes, never a rewritten map or a host file.
    const { "manifest.json": manifest, ...uploaded } = bundleFiles(bundlePath);
    expect(manifest).toBeDefined();
    expect(
      Object.fromEntries(
        Object.entries(uploaded).map(([path, bytes]) => [path, sha256(bytes)]),
      ),
    ).toEqual(run.staged ?? {});
    expect(Buffer.concat(Object.values(uploaded)).includes(run.canary)).toBe(
      false,
    );
  });
}, 60000);

test.each([...hostileMapVectors])(
  "a staged pair with %s pointing at a host file stops the release before sending anything",
  async (hostileMap) => {
    await withServers(false, async ({ intended, attacker }) => {
      const run = await runHostileRelease({
        intended: intended.url,
        attacker: attacker.url,
        token: orgAuthToken(intended.url),
        hostileMap,
      });
      expect(run.code).not.toBe(0);
      expect(run.output).toMatch(
        /Staged (source map|script) chunk-a1b2c3\.js.*release must not be published/,
      );
      expect(run.output).not.toContain(run.canary);
      expect(run.built).toBe(true);
      expect(intended.requests).toEqual([]);
      expect(attacker.connections()).toBe(0);
    });
  },
  60000,
);

test("a failed upload fails the release despite SENTRY_ALLOW_FAILURE in the environment and dotenv files", async () => {
  await withServers(true, async ({ intended, attacker }) => {
    const run = await runHostileRelease({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(intended.url),
    });
    expect(run.code, run.output).not.toBe(0);
    expect(run.output).toContain(
      "Desktop source map upload failed; release must not be published",
    );
    expect(intended.requests.length).toBeGreaterThan(0);
    expect(attacker.connections()).toBe(0);
  });
}, 60000);

test("a token embedding another URL stops the release before building or sending anything", async () => {
  await withServers(false, async ({ intended, attacker }) => {
    const run = await runHostileRelease({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(attacker.url),
    });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain("does not embed an allowed Sentry URL");
    expect(run.built).toBe(false);
    expect(intended.requests).toEqual([]);
    expect(attacker.connections()).toBe(0);
  });
}, 60000);

test("sentry-cli never runs below an inherited .sentryclirc or .env", async () => {
  await withServers(false, async ({ intended, attacker }) => {
    const run = await runHostileRelease({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(intended.url),
      tmp: "hostileAncestor",
    });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain("Refusing to run sentry-cli below");
    expect(run.built).toBe(true);
    expect(intended.requests).toEqual([]);
    expect(attacker.connections()).toBe(0);
  });
}, 60000);

test("sentry-cli never runs below a directory another user can write", async () => {
  await withServers(false, async ({ intended, attacker }) => {
    const run = await runHostileRelease({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(intended.url),
      tmp: "shared",
    });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain("another user could write there");
    expect(run.built).toBe(true);
    expect(intended.requests).toEqual([]);
    expect(attacker.connections()).toBe(0);
  });
}, 60000);

test.each(["BUN_OPTIONS", "BUN_INSPECT_PRELOAD"] as const)(
  "a release with %s stops before building or sending anything",
  async (launchVariable) => {
    await withServers(false, async ({ intended, attacker }) => {
      const run = await runHostileRelease({
        intended: intended.url,
        attacker: attacker.url,
        token: orgAuthToken(intended.url),
        launchVariable,
      });
      expect(run.code).not.toBe(0);
      expect(run.output).toContain(`must not run with ${launchVariable}`);
      expect(run.built).toBe(false);
      expect(intended.requests).toEqual([]);
      expect(attacker.connections()).toBe(0);
    });
  },
  60000,
);

test.each([
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_FALLBACK_LIBRARY_PATH",
])(
  "a release started with %s refuses it before reading secrets",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "desktop-release-launch-"));
    try {
      await expect(
        runDesktopSentryRelease({
          packageRoot: root,
          repoRoot: root,
          command: ["false"],
          env: { ELECTROBUN_RELEASE_TIER: "staging", [name]: "1" },
          endpoint: hostedSentryEndpoint,
        }),
      ).rejects.toThrow(`Desktop Sentry releases must not run with ${name}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
