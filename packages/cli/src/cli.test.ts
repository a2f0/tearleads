import { expect, test } from "bun:test";
import { runCli, usage } from "./cli";
import { testContext } from "./cli.testUtils";

test("help prints usage", async () => {
  for (const argv of [[], ["help"], ["--help"], ["ls", "-h"]]) {
    const { context, output } = testContext();
    expect(await runCli(argv, context)).toBe(0);
    expect(output.stdout).toEqual([usage]);
  }
});

test("unknown commands, options, and targets are usage errors", async () => {
  for (const argv of [["nope"], ["ls", "extra"], ["ls", "--bogus"]]) {
    const { context, output } = testContext();
    expect(await runCli(argv, context)).toBe(2);
    expect(output.stderr.at(-1)).toBe(usage);
  }
  const { context, output } = testContext();
  expect(await runCli(["whoami", "--env", "dev"], context)).toBe(2);
  expect(output.stderr).toEqual([
    "Unknown --env dev; use production or staging.",
  ]);
});

test("commands that need a session ask for login first", async () => {
  for (const command of ["whoami", "orgs", "ls"]) {
    const { context, output } = testContext();
    expect(await runCli([command], context)).toBe(1);
    expect(output.stderr).toEqual([
      "Not signed in to production. Run `tearleads login --env production` first.",
    ]);
  }
});

test("logout removes only the chosen target's key", async () => {
  const { context, keyStore, output } = testContext();
  await keyStore.save("staging", "abandon ability able");

  expect(await runCli(["logout"], context)).toBe(0);
  expect(await runCli(["logout", "--env", "staging"], context)).toBe(0);
  expect(output.stdout).toEqual([
    "No production recovery key was saved.",
    "Removed the staging recovery key from the Keychain.",
  ]);
  expect(keyStore.items.size).toBe(0);
});

test("a malformed recovery key is refused before any request", async () => {
  const { context, keyStore, output } = testContext({
    recoveryKey: "not a key!",
  });

  expect(await runCli(["login"], context)).toBe(1);
  expect(output.stderr[0]).toContain("A recovery key is a list of words");
  expect(keyStore.items.size).toBe(0);
});
