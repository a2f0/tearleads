import { expect, test } from "bun:test";
import {
  electrobunSentryTargets,
  hutchBuildTarget,
  isElectrobunSentryTarget,
} from "./sentryTarget";

test("Hutch's build target names the release target", () => {
  for (const [os, arch, target] of [
    ["macos", "arm64", "macos-arm64"],
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["win", "x64", "win-x64"],
  ] as const)
    expect(hutchBuildTarget({ ELECTROBUN_OS: os, ELECTROBUN_ARCH: arch })).toBe(
      target,
    );
  expect([...electrobunSentryTargets].sort()).toEqual([
    "linux-arm64",
    "linux-x64",
    "macos-arm64",
    "win-x64",
  ]);
});

test("a target without its own dist stops the release", () => {
  for (const env of [
    {},
    { ELECTROBUN_OS: "macos" },
    { ELECTROBUN_ARCH: "x64" },
    // Hutch ships no macOS x64 or Windows ARM64 release.
    { ELECTROBUN_OS: "macos", ELECTROBUN_ARCH: "x64" },
    { ELECTROBUN_OS: "win", ELECTROBUN_ARCH: "arm64" },
    { ELECTROBUN_OS: "windows", ELECTROBUN_ARCH: "x64" },
    { ELECTROBUN_OS: "Linux", ELECTROBUN_ARCH: "x64" },
    { ELECTROBUN_OS: "linux", ELECTROBUN_ARCH: "amd64" },
    { ELECTROBUN_OS: "linux-x64", ELECTROBUN_ARCH: "" },
  ])
    expect(() => hutchBuildTarget(env)).toThrow(/Desktop Sentry releases/);
  for (const value of ["", "darwin-arm64", "linux-x64 ", undefined, 1])
    expect(isElectrobunSentryTarget(value)).toBe(false);
});
