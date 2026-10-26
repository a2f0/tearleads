import { expect, test } from "bun:test";
import type { Options } from "../options";
import { runDatabaseExperiment } from "./run";
import { runFixture } from "./run.testUtils";

const options: Options = {
  environment: "staging",
  samples: 1,
  cloudflare: true,
};

test("abort before deployment retains not-created and touches no Worker", async () => {
  const f = runFixture();
  await expect(
    runDatabaseExperiment(
      options,
      AbortSignal.abort(new Error("interrupted")),
      f.dependencies,
    ),
  ).rejects.toThrow("interrupted");
  expect(f.dependencies.deploy).not.toHaveBeenCalled();
  expect(f.api).not.toHaveBeenCalled();
  expect(f.saved.at(-1)).toMatchObject({
    status: "failed",
    cleanup: "not-created",
  });
});

test("failed deployment still verifies absence before recording cleanup", async () => {
  const f = runFixture();
  f.dependencies.deploy.mockRejectedValue(new Error("upload failed"));
  await expect(
    runDatabaseExperiment(
      options,
      new AbortController().signal,
      f.dependencies,
    ),
  ).rejects.toThrow("upload failed");
  expect(f.api).toHaveBeenCalledWith("/workers/scripts/probe/settings");
  expect(f.saved.at(-1)).toMatchObject({
    status: "failed",
    cleanup: "deleted",
  });
});

test("failed readiness closes the tail and deletes the deployed Worker", async () => {
  const f = runFixture();
  f.dependencies.ready.mockRejectedValue(new Error("not ready"));
  await expect(
    runDatabaseExperiment(
      options,
      new AbortController().signal,
      f.dependencies,
    ),
  ).rejects.toThrow("not ready");
  expect(f.closeTail).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.dependencies.collectSamples).not.toHaveBeenCalled();
  expect(f.saved.at(-1)).toMatchObject({
    status: "failed",
    cleanup: "deleted",
  });
});

test("tail close failure cannot prevent Worker deletion", async () => {
  const f = runFixture();
  f.closeTail.mockRejectedValue(new Error("tail close failed"));
  await expect(
    runDatabaseExperiment(
      options,
      new AbortController().signal,
      f.dependencies,
    ),
  ).rejects.toThrow("Tail cleanup failed");
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.saved.at(-1)).toMatchObject({
    status: "failed",
    cleanup: "deleted",
  });
});

test("a surviving Worker makes the run fail even when close resolves", async () => {
  const f = runFixture();
  f.close.mockImplementation(async () => {});
  await expect(
    runDatabaseExperiment(
      options,
      new AbortController().signal,
      f.dependencies,
    ),
  ).rejects.toThrow("Worker cleanup failed");
  expect(f.saved.at(-1)).toMatchObject({ status: "failed", cleanup: "failed" });
});

test("successful cleanup is reported only after checking the Worker is absent", async () => {
  const f = runFixture();
  await runDatabaseExperiment(
    options,
    new AbortController().signal,
    f.dependencies,
  );
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.api).toHaveBeenCalledTimes(1);
  expect(f.saved.at(-1)).toMatchObject({
    status: "complete",
    cleanup: "deleted",
  });
});
