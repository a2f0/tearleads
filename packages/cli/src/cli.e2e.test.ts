import { afterEach, beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { openLocalDatabase } from "./localDatabase";

let apiBaseUrl = "";
// Requests matching `method pathname` get a 503 instead of reaching the API.
let failing: RegExp | null = null;
// Every `method pathname` the API received, in order.
const requests: string[] = [];

beforeAll(async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      return failing?.test(`${request.method} ${pathname}`)
        ? new Response("unavailable", { status: 503 })
        : routeApp.fetch(request);
    },
  });
  apiBaseUrl = server.url.origin;
});

afterEach(() => {
  failing = null;
});

/** Registers a fresh account the way an app install does and returns its key. */
async function registerAccount() {
  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    const { seedPhrase } = await sdk.identity.generate();
    await sdk.session.bootstrapLocalRootContainer();
    const registered = await sdk.session.registerIdentity();
    if (
      !seedPhrase ||
      !registered ||
      "status" in registered ||
      !(await sdk.session.login(registered.challenge))
    ) {
      throw new Error("could not register a test account");
    }
    const userId = sdk.session.userId;
    const organizationId = sdk.session.organizationId;
    const rootContainerId = sdk.session.containerId;
    await sdk.session.logoutRemote();
    return { organizationId, rootContainerId, seedPhrase, userId };
  } finally {
    sdk.dispose();
    database.close();
  }
}

test("login verifies and saves the key; later commands sign in with it", async () => {
  const account = await registerAccount();
  const { context, keyStore, output } = testContext({
    apiBaseUrl,
    // Identity Manager shows the words; users may paste them with stray case.
    recoveryKey: `  ${account.seedPhrase.toUpperCase()}\n`,
  });

  expect(await runCli(["login"], context)).toBe(0);
  expect(keyStore.items.get("production")).toBe(account.seedPhrase);
  expect(output.stdout).toEqual([
    `Signed in to production as ${account.userId}.`,
    "The recovery key is saved in the Keychain.",
  ]);

  output.stdout.length = 0;
  expect(await runCli(["whoami"], context)).toBe(0);
  expect(output.stdout).toContain(`user          ${account.userId}`);
  expect(output.stdout).toContain(`organization  ${account.organizationId}`);

  output.stdout.length = 0;
  expect(await runCli(["orgs"], context)).toBe(0);
  expect(output.stdout).toHaveLength(1);
  expect(output.stdout[0]).toStartWith(`${account.organizationId}  `);
  expect(output.stdout[0]).toEndWith("(personal)");

  output.stdout.length = 0;
  expect(await runCli(["ls"], context)).toBe(0);
  expect(output.stderr).toEqual([]);
  // Registration provisions the root and two system folders; all three load
  // before `ls` prints.
  expect(output.stdout).toHaveLength(3);
  expect(output.stdout[0]).toEndWith(`  ${account.rootContainerId}`);
  expect(
    output.stdout.filter((line) => line.includes("[system]")),
  ).toHaveLength(2);
}, 60_000);

test("each command revokes the session it opened", async () => {
  const account = await registerAccount();
  const { context } = testContext({
    apiBaseUrl,
    recoveryKey: account.seedPhrase,
  });
  expect(await runCli(["login"], context)).toBe(0);
  expect(await runCli(["whoami"], context)).toBe(0);

  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    await sdk.identity.importSeedPhrase(account.seedPhrase);
    expect(await sdk.session.login()).toBe(true);
    // Only this session remains: registration's, login's, and whoami's are gone.
    expect(await sdk.session.listSessions()).toHaveLength(1);
  } finally {
    await sdk.session.logoutRemote();
    sdk.dispose();
    database.close();
  }
}, 60_000);

test("a key for an account the API does not know is not saved", async () => {
  const unknown = await (async () => {
    const database = await openLocalDatabase();
    const sdk = new Tearleads({
      apiBaseUrl,
      blobStoreFactory: () => createMemoryBlobStore(),
      database: { client: database.client, id: crypto.randomUUID() },
      identityProvisioning: "manual",
      logger: { log: () => undefined, logError: () => undefined },
    });
    try {
      return (await sdk.identity.generate()).seedPhrase;
    } finally {
      sdk.dispose();
      database.close();
    }
  })();
  const { context, keyStore, output } = testContext({
    apiBaseUrl,
    recoveryKey: unknown ?? "",
  });

  expect(await runCli(["login"], context)).toBe(1);
  expect(output.stderr.join("\n")).not.toContain(unknown ?? "-");
  expect(keyStore.items.size).toBe(0);
}, 60_000);

async function signedInContext() {
  const account = await registerAccount();
  const setup = testContext({ apiBaseUrl, recoveryKey: account.seedPhrase });
  expect(await runCli(["login"], setup.context)).toBe(0);
  setup.output.stdout.length = 0;
  return setup;
}

test("ls fails instead of printing a partial tree when the listing fails", async () => {
  const { context, output } = await signedInContext();
  failing = /^POST \/containers\/parent-lanes\/query$/u;

  expect(await runCli(["ls"], context)).toBe(1);
  expect(output.stdout).toEqual([]);
  expect(output.stderr.join("\n")).toContain("/containers/parent-lanes/query");
}, 60_000);

test("ls fails when a folder's metadata cannot be pulled", async () => {
  const { context, output } = await signedInContext();
  failing = /^POST \/documents\/[^/]+\/sync$/u;

  expect(await runCli(["ls"], context)).toBe(1);
  expect(output.stdout).toEqual([]);
  expect(output.stderr.join("\n")).toContain("may be partial");
}, 60_000);

test("a session the API will not revoke fails the command", async () => {
  const { context, output } = await signedInContext();
  failing = /^POST \/auth\/logout$/u;

  expect(await runCli(["whoami"], context)).toBe(1);
  expect(output.stdout).toEqual([]);
  expect(output.stderr).toEqual([
    "Could not revoke this command's session on the API; it stays valid until it expires.",
  ]);
}, 60_000);

test("ls applies the user's sync pauses before pulling any folder", async () => {
  const { context } = await signedInContext();
  requests.length = 0;

  expect(await runCli(["ls"], context)).toBe(0);
  const memberships = requests.indexOf("GET /organization-memberships");
  const firstPull = requests.findIndex(
    (request) =>
      request.startsWith("POST /containers/") ||
      request.startsWith("POST /documents/"),
  );
  expect(memberships).toBeGreaterThan(-1);
  expect(firstPull).toBeGreaterThan(memberships);
}, 60_000);

test("ls fails when memberships, and so sync pauses, cannot be read", async () => {
  const { context, output } = await signedInContext();
  failing = /^GET \/organization-memberships$/u;

  expect(await runCli(["ls"], context)).toBe(1);
  expect(output.stdout).toEqual([]);
  expect(output.stderr).toEqual([
    "Could not read organization memberships from the API.",
  ]);
}, 60_000);

/** Signs in with `seedPhrase`, runs `work`, and signs out. */
async function asDevice<T>(
  seedPhrase: string,
  work: (sdk: Tearleads) => Promise<T>,
): Promise<T> {
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
    if (!(await sdk.session.login())) throw new Error("could not sign in");
    return await work(sdk);
  } finally {
    await sdk.session.logoutRemote();
    sdk.dispose();
    database.close();
  }
}

test("ls --org refuses an organization whose sync the user paused", async () => {
  const account = await registerAccount();
  const organizationId = await asDevice(account.seedPhrase, async (sdk) => {
    const created = await sdk.session.createOrganization();
    if (!created) throw new Error("could not create an organization");
    const paused = await sdk.organizations.memberships.setSyncPaused(
      created.organizationId,
      true,
    );
    expect(paused.status).toBe("updated");
    return created.organizationId;
  });
  const { context, output } = testContext({
    apiBaseUrl,
    recoveryKey: account.seedPhrase,
  });
  expect(await runCli(["login"], context)).toBe(0);
  output.stdout.length = 0;
  requests.length = 0;

  expect(await runCli(["ls", "--org", organizationId], context)).toBe(1);
  expect(output.stdout).toEqual([]);
  expect(output.stderr).toEqual([
    `Sync of organization ${organizationId} is paused for your devices; resume it in the app to list it here.`,
  ]);
  expect(
    requests.filter(
      (request) =>
        request.startsWith("POST /containers/") ||
        request.startsWith("POST /documents/"),
    ),
  ).toEqual([]);

  await asDevice(account.seedPhrase, (sdk) =>
    sdk.organizations.memberships.setSyncPaused(organizationId, false),
  );
  expect(await runCli(["ls", "--org", organizationId], context)).toBe(0);
  expect(output.stdout.length).toBeGreaterThan(0);
}, 60_000);

test("ls --org refuses an organization the user does not belong to", async () => {
  const { context, output } = await signedInContext();
  const stranger = crypto.randomUUID();

  expect(await runCli(["ls", "--org", stranger], context)).toBe(1);
  expect(output.stderr).toEqual([
    `You are not a member of organization ${stranger}.`,
  ]);
}, 60_000);
