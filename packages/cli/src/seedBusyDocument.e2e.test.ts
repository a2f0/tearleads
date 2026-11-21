import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("an unrelated edit that refuses the importer's bind still lets the seed finish", async () => {
  await initializeApiDatabase();
  let interrupt = true;
  let hooking = false;
  let refusedBinds = 0;
  let peerEdit: (() => Promise<void>) | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      // The other device's own requests pass straight through.
      if (hooking) return routeApp.fetch(req);
      if (interrupt && path === "/blobs/stages/multipart")
        return new Response(null, { status: 503 });
      if (!path.endsWith("/attachment-bindings")) return routeApp.fetch(req);
      // The edit commits after the importer pulled, so the API refuses this
      // bind; the importer pulls, checks the slot again, and binds.
      const edit = peerEdit;
      peerEdit = undefined;
      hooking = true;
      try {
        await edit?.();
      } finally {
        hooking = false;
      }
      const response = await routeApp.fetch(req);
      if (response.status === 409) refusedBinds += 1;
      return response;
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { rootContainerId, seedPhrase } =
      await registerCliTestAccount(apiBaseUrl);
    const device = { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase };
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const seed = () => runCli(["seed", "--env", "staging"], context);
    expect(await seed()).toBe(1);
    interrupt = false;
    const peerText = "Written on another device during the import";
    let contactId: string | null = null;
    peerEdit = () =>
      onFreshDevice(device, async ([other]) => {
        if (!other?.getSnapshot().attachments[0])
          throw new Error("Missing partial avatar");
        contactId = other.getSnapshot().documentId;
        await other.setText(peerText);
        expect(await other.requestRemoteSyncAndWait()).toBe(true);
      });

    output.stderr.length = 0;
    const exitCode = await seed();
    expect(output.stderr).toEqual([]);
    expect(exitCode).toBe(0);
    expect(peerEdit).toBeUndefined();
    expect(refusedBinds).toBe(1);
    await onFreshDevice(device, async (stores, sdk) => {
      const snapshot = stores
        .find((store) => store.getSnapshot().documentId === contactId)
        ?.getSnapshot();
      const avatar = snapshot?.attachments[0];
      if (!snapshot?.documentId || !avatar)
        throw new Error("Missing seeded avatar");
      expect(snapshot.text).toBe(peerText);
      const bindings = await sdk.documents
        .workflowRuntime()
        .apiClient.listDocumentAttachments(snapshot.documentId, {
          refresh: true,
        });
      expect(bindings?.map((binding) => binding.slotId)).toEqual([
        avatar.slotId,
      ]);
      expect(
        await sdk.blobs.store.readBytes(
          snapshot.attachmentStorageKeyBySlotId[avatar.slotId] ?? "",
        ),
      ).toEqual(
        new Uint8Array(
          await (await loadContinuityAssets()).readAttachment(avatar.name),
        ),
      );
    });
  } finally {
    server.stop(true);
  }
}, 90_000);
