import { expect, test } from "bun:test";
import { deployFixture } from "./apiDeploy.testUtils";

const heldKey = ',{"name":"TWO_FACTOR_SECRET_KEY"}';

test("a Worker holding the two-factor key refuses a new one before migrations", async () => {
  const run = await deployFixture(
    { API_DEPLOY_TEST_WORKER_SECRETS: heldKey },
    { generateCursorKey: true },
  );
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain(
    "The staging Worker holds a TWO_FACTOR_SECRET_KEY that",
  );
  expect(run.workerEnv).not.toContain("TWO_FACTOR_SECRET_KEY");
  expect(run.calls).toEqual([]);
});

test("a Worker that cannot be asked refuses a new two-factor key", async () => {
  const run = await deployFixture(
    { API_DEPLOY_TEST_WORKER_SECRETS: "fail" },
    { generateCursorKey: true },
  );
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain(
    "Could not list the staging Worker's secrets to confirm it holds no TWO_FACTOR_SECRET_KEY",
  );
  expect(run.workerEnv).not.toContain("TWO_FACTOR_SECRET_KEY");
});

test("an explicit reset replaces the key a Worker holds", async () => {
  const run = await deployFixture(
    {
      API_DEPLOY_TEST_WORKER_SECRETS: heldKey,
      TWO_FACTOR_SECRET_KEY_RESET: "1",
    },
    { generateCursorKey: true },
  );
  expect(run.exitCode, run.stderr).toBe(0);
  const [, key] =
    run.workerEnv?.match(/^export TWO_FACTOR_SECRET_KEY=(\w{64})$/m) ?? [];
  expect(key).toHaveLength(64);
  expect(run.secrets).toHaveProperty("TWO_FACTOR_SECRET_KEY", key);
});
