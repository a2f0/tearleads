import { expect, test } from "bun:test";
import {
  orgAuthToken,
  startAttacker,
  startFakeSentry,
} from "./sentrySourceMapUpload.testUtils";
import {
  type LinuxUploadCase,
  runHostileLinuxUpload,
} from "./uploadLinuxSourceMaps.testUtils";

async function withServers(
  failing: boolean,
  run: (servers: {
    intended: ReturnType<typeof startFakeSentry>;
    attacker: ReturnType<typeof startAttacker>;
  }) => Promise<void>,
) {
  const intended = startFakeSentry("/dev/null", failing);
  const attacker = startAttacker();
  try {
    await run({ intended, attacker });
  } finally {
    intended.stop();
    attacker.stop();
  }
}

test("the host uploads the container's staged pairs under the checkout's release and tier dist, only to the intended endpoint", async () => {
  await withServers(false, async ({ intended, attacker }) => {
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
      `tearleads-electrobun@${run.head} staging-app`,
    ]);
    expect(run.staged).toBe(false);
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
    expect(run.staged).toBe(false);
  });
}, 60000);

test.each([
  ["dirty", "clean Git checkout"],
  ["otherCommit", "not this clean checkout's HEAD"],
  ["linkedMap", "Unexpected desktop source-map staging contents"],
  ["foreignBundle", "not built from the release commit"],
  ["relativeDir", "Usage: uploadLinuxSourceMaps.ts"],
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
