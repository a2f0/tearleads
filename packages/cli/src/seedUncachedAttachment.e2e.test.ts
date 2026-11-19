import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("a seed retry never reuploads a bound avatar whose bytes cannot be downloaded", async () => {
  await initializeApiDatabase();
  let uploads = 0;
  let downloads = 0;
  let blockDownloads = false;
  let interruptBirth = false;
  let seededAttempts = 0;
  let plainAttempts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (
        interruptBirth &&
        path === "/documents" &&
        request.method === "POST"
      ) {
        const body = await request.clone().json();
        if (body.initialSync) {
          seededAttempts++;
          return new Response(null, { status: 503 });
        }
        plainAttempts++;
      }
      if (interruptBirth && seededAttempts > 0 && path.endsWith("/sync"))
        return new Response(null, { status: 503 });
      if (path === "/blobs/stages/multipart" && ++uploads > 1)
        return new Response(null, { status: 503 });
      if (blockDownloads && path.endsWith("/download")) {
        downloads++;
        return new Response(null, { status: 503 });
      }
      return routeApp.fetch(request);
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const seed = () => runCli(["seed", "--env", "staging"], context);
    interruptBirth = true;
    expect(await seed()).toBe(1);
    expect(seededAttempts).toBeGreaterThan(0);
    expect(plainAttempts).toBe(0);
    interruptBirth = false;
    await onFreshDevice(
      { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase },
      async (stores) => {
        expect(stores).toHaveLength(0);
      },
    );
    expect(await seed()).toBe(1);
    expect(uploads).toBeGreaterThan(1);
    // A new CLI session has empty local storage. The first avatar is already
    // bound remotely even when hydration cannot read its bytes this time.
    const before = uploads;
    blockDownloads = true;
    expect(await seed()).toBe(1);
    expect(downloads).toBeGreaterThan(0);
    expect(uploads).toBe(before);
  } finally {
    server.stop(true);
  }
}, 60_000);
