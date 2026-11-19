import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";

test("a seed retry never reuploads a bound avatar whose bytes cannot be downloaded", async () => {
  await initializeApiDatabase();
  let uploads = 0;
  let downloads = 0;
  let blockDownloads = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
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
    const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const seed = () => runCli(["seed", "--env", "staging"], context);
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
