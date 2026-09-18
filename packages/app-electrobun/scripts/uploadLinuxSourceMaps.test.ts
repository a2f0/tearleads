import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  orgAuthToken,
  startAttacker,
  startFakeSentry,
} from "./sentrySourceMapUpload.testUtils";
import {
  bundleFiles,
  hostileMapVectors,
  sha256,
} from "./sentryStagedMaps.testUtils";
import {
  type LinuxUploadCase,
  runHostileLinuxUpload,
} from "./uploadLinuxSourceMaps.testUtils";

async function withServers(
  failing: boolean,
  run: (servers: {
    bundlePath: string;
    intended: ReturnType<typeof startFakeSentry>;
    attacker: ReturnType<typeof startAttacker>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "linux-sourcemap-upload-"));
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

test("the host uploads the container's staged pairs, byte for byte, under the checkout's release and the released target's dist, only to the intended endpoint", async () => {
  await withServers(false, async ({ bundlePath, intended, attacker }) => {
    const token = orgAuthToken(intended.url);
    const run = await runHostileLinuxUpload({
      intended: intended.url,
      attacker: attacker.url,
      token,
    });
    expect(run.code, run.output).toBe(0);
    expect(attacker.connections()).toBe(0);
    expect([...intended.authorizations]).toEqual([`Bearer ${token}`]);
    expect([...intended.projects]).toEqual(["tearleads-electrobun-staging"]);
    expect([...intended.releases]).toEqual([
      `tearleads-electrobun@${run.head} staging-app-linux-x64`,
    ]);
    const { "manifest.json": manifest, ...uploaded } = bundleFiles(bundlePath);
    expect(manifest).toBeDefined();
    expect(
      Object.fromEntries(
        Object.entries(uploaded).map(([path, bytes]) => [path, sha256(bytes)]),
      ),
    ).toEqual(run.staged);
    expect(run.removed).toBe(true);
  });
}, 60000);

test("a failed upload stops the Linux release despite SENTRY_ALLOW_FAILURE", async () => {
  await withServers(true, async ({ intended, attacker }) => {
    const run = await runHostileLinuxUpload({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(intended.url),
    });
    expect(run.code, run.output).not.toBe(0);
    expect(run.output).toContain("release must not be published");
    expect(intended.requests.length).toBeGreaterThan(0);
    expect(attacker.connections()).toBe(0);
    expect(run.removed).toBe(true);
  });
}, 60000);

test.each([
  ["dirty", "clean Git checkout"],
  ["otherCommit", "not this clean checkout's HEAD"],
  ["linkedMap", "Unexpected desktop source-map staging contents"],
  ["foreignBundle", "not built from the release commit"],
  ["otherTarget", "expected staging-app-linux-x64"],
  ["foreignTargetBundle", "not built from the release commit for linux-x64"],
  ["macosTarget", "Usage: uploadDeferredSourceMaps.ts"],
  ["relativeDir", "Usage: uploadDeferredSourceMaps.ts"],
  ["launch", "must not run with BUN_INSPECT_PRELOAD"],
] satisfies [LinuxUploadCase, string][])(
  "%s staging or checkout refuses the upload before sending anything",
  async (kind, message) => {
    await withServers(false, async ({ intended, attacker }) => {
      const run = await runHostileLinuxUpload({
        intended: intended.url,
        attacker: attacker.url,
        token: orgAuthToken(intended.url),
        kind,
      });
      expect(run.code).not.toBe(0);
      expect(run.output).toContain(message);
      expect(intended.requests).toEqual([]);
      expect(attacker.connections()).toBe(0);
    });
  },
  60000,
);

test.each([...hostileMapVectors])(
  "a staged pair with %s pointing at a host file refuses the upload before sending anything",
  async (hostileMap) => {
    await withServers(false, async ({ intended, attacker }) => {
      const run = await runHostileLinuxUpload({
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
      expect(intended.requests).toEqual([]);
      expect(attacker.connections()).toBe(0);
    });
  },
  60000,
);

test("Windows source maps upload under the Windows dist from the local host", async () => {
  await withServers(false, async ({ intended, attacker }) => {
    const run = await runHostileLinuxUpload({
      intended: intended.url,
      attacker: attacker.url,
      token: orgAuthToken(intended.url),
      kind: "windows",
    });
    expect(run.code, run.output).toBe(0);
    expect([...intended.releases]).toEqual([
      `tearleads-electrobun@${run.head} staging-app-win-x64`,
    ]);
    expect(attacker.connections()).toBe(0);
  });
}, 60000);
