import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { publishSeedEdit } from "./seedAttachmentMetadata.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("verification preserves a binding whose slot disappears on a later history page", async () => {
  await initializeApiDatabase();
  let targetPath = "";
  let verifying = false;
  let continued = false;
  let detached = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (verifying && path === targetPath) {
        const body = await request.clone().json();
        if (body.pullCursor) continued = true;
      }
      if (verifying && path.endsWith("/detach")) detached = true;
      return routeApp.fetch(request);
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase: recoveryKey, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", recoveryKey);
    expect(await runCli(["seed", "--env", "staging"], context)).toBe(0);
    await onFreshDevice(
      { apiBaseUrl, recoveryKey, rootContainerId },
      async (stores, sdk) => {
        const store = stores.find(
          (item) =>
            item.getSnapshot().documentKind === "contact" &&
            item.getSnapshot().attachments.length,
        );
        const slot = store?.getSnapshot().attachments[0];
        if (!store || !slot) throw new Error("Missing seeded avatar");
        targetPath = `/documents/${store.getSnapshot().documentId}/sync`;
        // The API returns up to 64 updates per pull. The final page removes the slot.
        for (let i = 0; i < 65; i++) {
          await store.setStructuredFields("contact", { nickname: String(i) });
          expect(await store.requestRemoteSyncAndWait()).toBe(true);
        }
        await publishSeedEdit(sdk, store, (doc) =>
          doc.getMap("content").delete(`attachment:${slot.slotId}`),
        );
      },
    );
    verifying = true;
    expect(await runCli(["verify-seed", "--env", "staging"], context)).toBe(1);
    expect(continued).toBe(true);
    expect(detached).toBe(false);
    expect(output.stderr.at(-1)).toMatch(/differs/);
  } finally {
    server.stop(true);
  }
}, 180_000);
