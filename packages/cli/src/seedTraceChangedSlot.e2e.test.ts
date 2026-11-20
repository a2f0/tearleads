import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { continuityDocuments, loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("seed traces an acknowledged upload whose slot disappears before confirmation", async () => {
  await initializeApiDatabase();
  let removeSlot: (() => Promise<void>) | undefined;
  let stages = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/blobs/stages/multipart" && ++stages > 1)
        return new Response(null, { status: 503 });
      const response = await routeApp.fetch(request);
      if (
        removeSlot &&
        response.ok &&
        request.method === "POST" &&
        path.endsWith("/attachment-bindings")
      ) {
        const remove = removeSlot;
        removeSlot = undefined;
        await remove();
      }
      return response;
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const first = continuityDocuments((await loadContinuityAssets()).spec)[0];
    const file = first?.attachments[0]?.file;
    if (!first || !file) throw new Error("Missing first fixture avatar");
    removeSlot = () =>
      onFreshDevice(
        { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase },
        async ([store]) => {
          const attachment = store?.getSnapshot().attachments[0];
          if (!store || !attachment) throw new Error("Missing bound fixture");
          await store.removeAttachment(attachment.slotId);
          expect(await store.requestRemoteSyncAndWait()).toBe(true);
        },
      );
    expect(await runCli(["seed", "--env", "staging", "--trace"], context)).toBe(
      1,
    );
    expect(removeSlot).toBeUndefined();
    expect(stages).toBeGreaterThan(1);
    const trace = output.stderr.join("\n");
    expect(trace).toContain(
      `seed ${first.key} uploaded ${file} (slot changed before confirmation)`,
    );
    expect(trace).not.toContain(`seed ${first.key} confirmed ${file} in `);
  } finally {
    server.stop(true);
  }
}, 60_000);
