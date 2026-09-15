import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertStagedSourceMaps,
  hutchSourceMapIdentity,
  type StagedSourceMapIdentity,
} from "./sentrySourceMaps";
import { stageMinimalPairs } from "./sentryStagedMaps.testUtils";

const stage = (directory: string) => stageMinimalPairs(directory);

test("the packaging hook stages under the configured tier and the target Hutch is building", () => {
  const env = {
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "production",
    ELECTROBUN_OS: "linux",
    ELECTROBUN_ARCH: "x64",
  };
  expect(hutchSourceMapIdentity(env)).toEqual({
    target: "linux-x64",
    dist: "production-app-linux-x64",
  });
  expect(() =>
    hutchSourceMapIdentity({
      ...env,
      BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: undefined,
    }),
  ).toThrow(/release tier/);
  expect(() =>
    hutchSourceMapIdentity({ ...env, ELECTROBUN_OS: "macos" }),
  ).toThrow(/Desktop Sentry releases support/);
});

test("staging must hold exactly one dist directory for the release tier and, when named, target", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "staged-dist-")));
  const stagingDir = join(root, "sentry-sourcemaps");
  const staging: StagedSourceMapIdentity = { environment: "staging" };
  const linux: StagedSourceMapIdentity = { ...staging, target: "linux-x64" };
  try {
    for (const [dists, identity] of [
      // The shared-dist layout, another tier, another target, an unlisted one.
      [[""], staging],
      [["staging-app"], staging],
      [["production-app-linux-x64"], staging],
      [["staging-app-linux-arm64"], linux],
      [["staging-app-macos-arm64"], linux],
      [["staging-app-macos-x64"], staging],
      [["staging-app-linux-x64", "staging-app-macos-arm64"], staging],
    ] satisfies [string[], StagedSourceMapIdentity][]) {
      for (const dist of dists) await stage(join(stagingDir, dist));
      expect(() => assertStagedSourceMaps(stagingDir, identity)).toThrow(
        /Unexpected desktop source-map staging contents/,
      );
      await rm(stagingDir, { recursive: true, force: true });
    }
    // A linked dist directory would upload whatever it points at.
    await stage(join(root, "elsewhere"));
    await mkdir(stagingDir);
    await symlink(
      join(root, "elsewhere"),
      join(stagingDir, "staging-app-linux-x64"),
    );
    expect(() => assertStagedSourceMaps(stagingDir, staging)).toThrow(
      /Unexpected/,
    );
    await rm(stagingDir, { recursive: true, force: true });
    await stage(join(stagingDir, "staging-app-linux-x64"));
    for (const identity of [staging, linux])
      expect(assertStagedSourceMaps(stagingDir, identity)).toBe(
        "staging-app-linux-x64",
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
