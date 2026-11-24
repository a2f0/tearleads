import { expect, test } from "bun:test";
import { runCli, usage } from "./cli";
import { testContext } from "./cli.testUtils";
import { type TargetName, targets } from "./targets";

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
    "Unknown --env dev; use production, staging, or development.",
  ]);
});

test("--api-url is a one-time-key origin in place of --env", async () => {
  const cases: [string[], string][] = [
    [
      ["whoami", "--key-stdin"],
      "--key-stdin applies to register, seed, and verify-seed.",
    ],
    [
      ["seed", "--api-url", "http://127.0.0.1:1"],
      "--api-url needs --key-stdin.",
    ],
    [
      [
        "seed",
        "--key-stdin",
        "--env",
        "staging",
        "--api-url",
        "http://127.0.0.1:1",
      ],
      "Use either --env or --api-url.",
    ],
    ...["ftp://127.0.0.1", "http://127.0.0.1:1/api", "localhost:1"].map(
      (url): [string[], string] => [
        ["register", "--key-stdin", "--api-url", url],
        `--api-url ${url} is not an http(s) origin such as http://127.0.0.1:3001.`,
      ],
    ),
  ];
  for (const [argv, message] of cases) {
    const { context, output } = testContext();
    expect(await runCli(argv, context)).toBe(2);
    expect(output.stderr).toEqual([message]);
  }
});

test("--env development resolves the local API", async () => {
  const { context, keyStore, output } = testContext();
  await keyStore.save("development", "abandon ability able");
  const requested: string[] = [];
  // Stops at URL resolution, before the session makes any request.
  const resolving = {
    ...context,
    apiBaseUrl: (target: TargetName) => {
      requested.push(target);
      throw new Error(`resolved ${targets[target]}`);
    },
  };

  expect(await runCli(["whoami", "--env", "development"], resolving)).toBe(1);
  expect(requested).toEqual(["development"]);
  expect(output.stderr).toEqual(["resolved http://localhost:3001"]);
});

test("commands that need a session ask for login first", async () => {
  for (const command of ["whoami", "orgs", "ls", "seed"]) {
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
