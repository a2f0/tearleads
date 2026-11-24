import { beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { openLocalDatabase } from "./localDatabase";

let apiBaseUrl = "";

beforeAll(async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  apiBaseUrl = server.url.origin;
});

/** The sessions the key's account holds, counted from one more sign-in. */
async function openSessions(seedPhrase: string): Promise<number> {
  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    await sdk.identity.importSeedPhrase(seedPhrase);
    expect(await sdk.session.login()).toBe(true);
    return (await sdk.session.listSessions()).length - 1;
  } finally {
    await sdk.session.logoutRemote();
    sdk.dispose();
    database.close();
  }
}

test("register creates the key's account once and saves the key", async () => {
  const seedPhrase = createIdentitySeedPhrase();
  const { context, keyStore, output } = testContext({
    apiBaseUrl,
    recoveryKey: seedPhrase,
  });

  expect(await runCli(["register"], context)).toBe(0);
  expect(output.stderr).toEqual([]);
  const [registered, saved] = output.stdout;
  expect(registered).toMatch(/^Registered [0-9a-f-]{36} on production\.$/u);
  expect(saved).toBe("The recovery key is saved in the Keychain.");
  expect(keyStore.items.get("production")).toBe(seedPhrase);
  const userId = registered?.split(" ")[1];

  output.stdout.length = 0;
  expect(await runCli(["whoami"], context)).toBe(0);
  expect(output.stdout).toContain(`user          ${userId}`);

  output.stdout.length = 0;
  const repeat = await runCli(["register"], context);
  expect(output.stderr).toEqual([]);
  expect(repeat).toBe(0);
  expect(output.stdout[0]).toBe(
    `This recovery key already has an account on production: ${userId}.`,
  );
  // Registration, whoami, and the repeat each revoked what they opened.
  expect(await openSessions(seedPhrase)).toBe(0);
}, 60_000);

test("register --api-url uses that API and keeps the key out of the Keychain", async () => {
  const seedPhrase = createIdentitySeedPhrase();
  const { context, keyStore, output } = testContext({
    recoveryKey: seedPhrase,
  });
  const targetless = {
    ...context,
    apiBaseUrl: () => {
      throw new Error("--api-url must replace the target's API");
    },
  };

  expect(
    await runCli(
      ["register", "--key-stdin", "--api-url", `${apiBaseUrl}/`],
      targetless,
    ),
  ).toBe(0);
  expect(output.stderr).toEqual([]);
  expect(output.stdout).toHaveLength(1);
  expect(output.stdout[0]).toEndWith(` on ${apiBaseUrl}.`);
  expect(keyStore.items.size).toBe(0);
  expect(await openSessions(seedPhrase)).toBe(0);
}, 60_000);

test("seed and verify-seed sign in to the --api-url API", async () => {
  const unknown = createIdentitySeedPhrase();
  for (const command of ["seed", "verify-seed"]) {
    const { context, output } = testContext({ recoveryKey: unknown });
    const targetless = {
      ...context,
      apiBaseUrl: () => {
        throw new Error("--api-url must replace the target's API");
      },
    };
    // The API on --api-url answers, and refuses a key it has no account for.
    expect(
      await runCli(
        [command, "--key-stdin", "--api-url", apiBaseUrl.toUpperCase()],
        targetless,
      ),
    ).toBe(1);
    expect(output.stderr).toEqual([
      "The API refused to sign in with this recovery key. Check that the account exists on this target.",
    ]);
  }
}, 60_000);
