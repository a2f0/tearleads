import { expect, test } from "bun:test";
import { runWindowsRelease } from "./releaseWindows.testUtils";

for (const tier of ["staging", "production"]) {
  test(`the ${tier} operator command uploads maps before all S3 publication`, async () => {
    const result = await runWindowsRelease("upload", tier);
    expect(result.code, result.output).toBe(0);
    const sentry = result.calls.indexOf(`sentry ${tier} win-x64`);
    const aws = result.calls.findIndex((call) => call.startsWith("aws "));
    expect(sentry).toBeGreaterThan(0);
    expect(aws).toBeGreaterThan(sentry);
    expect(result.calls.filter((call) => call.startsWith("aws "))).toHaveLength(
      5,
    );
    expect(result.calls.at(-1)).toContain(
      `${tier === "staging" ? "canary" : "stable"}-win-x64-download.json`,
    );
  });
}

for (const failure of [
  "failed-run",
  "wrong-event",
  "wrong-workflow",
  "wrong-commit",
  "missing-artifact",
  "wrong-tier",
  "corrupt-artifact",
  "missing-maps",
  "sentry",
]) {
  test(`the operator command refuses ${failure} before any S3 write`, async () => {
    const result = await runWindowsRelease("upload", "staging", failure);
    expect(result.code, result.output).not.toBe(0);
    expect(result.calls.filter((call) => call.startsWith("aws "))).toEqual([]);
    if (failure !== "sentry")
      expect(result.calls.filter((call) => call.startsWith("sentry "))).toEqual(
        [],
      );
  });
}

test("download retrieves packages without any Sentry or AWS call", async () => {
  const result = await runWindowsRelease("download", "production");
  expect(result.code, result.output).toBe(0);
  expect(result.calls.every((call) => call.startsWith("gh "))).toBe(true);
});

test("build dispatches a verified pushed branch and refuses an unpushed commit", async () => {
  const built = await runWindowsRelease("build", "staging");
  expect(built.code, built.output).toBe(0);
  expect(built.calls.at(-1)).toContain("--ref release/fixture");
  const unpushed = await runWindowsRelease("build", "staging", "unpushed");
  expect(unpushed.code, unpushed.output).not.toBe(0);
  expect(unpushed.calls.some((call) => call.startsWith("gh workflow"))).toBe(
    false,
  );
});
