import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createReleaseCheckouts,
  hostileGitEnvironments,
  type ReleaseCheckouts,
  removeReleaseCheckouts,
  runRelease,
} from "./releaseCheckout.testUtils";

// Real Git: whatever GIT_* names and whichever directory it starts from, a
// release validates, reads secrets from and builds only the checkout holding
// the invoked script.
let dirty: ReleaseCheckouts | undefined;
let clean: ReleaseCheckouts | undefined;

beforeAll(async () => {
  dirty = await createReleaseCheckouts(true);
  clean = await createReleaseCheckouts(false);
});

afterAll(async () => {
  await removeReleaseCheckouts(dirty);
  await removeReleaseCheckouts(clean);
});

function fixtures() {
  if (!dirty || !clean) throw new Error("Release checkouts were not created");
  return { dirty, clean };
}

const scripts = "packages/app-electrobun/scripts";
const entries: Record<
  string,
  {
    command: (checkouts: ReleaseCheckouts) => string[];
    step: (checkouts: ReleaseCheckouts) => string;
  }
> = {
  "releaseMacos.sh": {
    command: ({ checkout }) => [
      "bash",
      join(checkout, scripts, "releaseMacos.sh"),
      "upload",
      "production",
    ],
    step: ({ checkout, head }) => `step bunx ${checkout} ${head} checkout`,
  },
  "releaseLinux.sh": {
    command: ({ checkout }) => [
      "bash",
      join(checkout, scripts, "releaseLinux.sh"),
      "upload",
      "production",
    ],
    step: ({ head }) => `step docker ${head} checkout checkout`,
  },
  "the uploadMacosRelease.sh shortcut": {
    command: ({ checkout }) => [
      "sh",
      join(checkout, "scripts/uploadMacosRelease.sh"),
    ],
    step: ({ checkout, head }) => `step bunx ${checkout} ${head} checkout`,
  },
  "a decoy's link to releaseMacos.sh": {
    command: ({ decoy }) => [
      "bash",
      join(decoy, scripts, "linkedReleaseMacos.sh"),
      "upload",
      "production",
    ],
    step: ({ checkout, head }) => `step bunx ${checkout} ${head} checkout`,
  },
};

// Each Git call saw no GIT_* variable and either ran in the checkout or named
// it with -C before the release left the decoy.
function expectBound(
  gitCalls: readonly string[],
  { checkout, decoy }: ReleaseCheckouts,
) {
  expect(gitCalls.length).toBeGreaterThan(0);
  for (const call of gitCalls) {
    const bound = [`git ${checkout} 0 `, `git ${decoy} 0 -C ${checkout} `];
    expect(
      bound.some((prefix) => call.startsWith(prefix)),
      call,
    ).toBe(true);
    expect(call.slice(call.indexOf(" 0 ")), call).not.toContain(decoy);
  }
}

for (const [entry, { command, step }] of Object.entries(entries)) {
  for (const variant of Object.keys(
    hostileGitEnvironments({ root: "", checkout: "", decoy: "", head: "" }),
  )) {
    test(`${entry} refuses its own dirty checkout from the decoy whatever ${variant} names`, async () => {
      const { dirty } = fixtures();
      const hostile = hostileGitEnvironments(dirty)[variant] ?? {};
      const result = await runRelease(dirty, command(dirty), hostile);
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.stderr).toContain("require a clean Git checkout");
      expect(result.steps).toEqual([]);
      expectBound(result.gitCalls, dirty);
    });
  }

  test(`${entry} releases its own clean checkout with every hostile GIT_* set`, async () => {
    const { clean } = fixtures();
    const hostile = Object.assign(
      {},
      ...Object.values(hostileGitEnvironments(clean)),
    );
    const result = await runRelease(clean, command(clean), hostile);
    expect(result.exitCode, result.stderr).toBe(3);
    expect(result.steps).toEqual(["secrets checkout", step(clean)]);
    expectBound(result.gitCalls, clean);
  });
}

for (const [driver, platform] of [
  ["releaseMacos.sh", "macOS"],
  ["releaseLinux.sh", "Linux"],
] as const) {
  test(`${driver} below another checkout refuses before secrets or any step`, async () => {
    const { clean } = fixtures();
    const nested = join(clean.decoy, "nested", scripts, driver);
    const result = await runRelease(
      clean,
      ["bash", nested, "upload", "production"],
      {},
    );
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      `${platform} releases must run from the top level of their own Git checkout`,
    );
    expect(result.steps).toEqual([]);
  });
}
