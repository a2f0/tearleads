import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  continuityDocuments,
  ensureContactsContainer,
  loadContinuityAssets,
} from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

test("seed uploads the pinned dataset and a fresh device can read it", async () => {
  await initializeApiDatabase();
  let interruptUpload = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (
        interruptUpload &&
        new URL(request.url).pathname === "/blobs/stages/multipart"
      )
        return new Response("unavailable", { status: 503 });
      return routeApp.fetch(request);
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const { spec, readAttachment } = await loadContinuityAssets();
    const documents = continuityDocuments(spec);
    const run = async () => {
      const result = await runCli(["seed", "--env", "staging"], context);
      expect(output.stderr).toEqual([]);
      expect(result).toBe(0);
      expect(output.stdout.at(-1)).toBe(
        `Synced ${documents.length} Continuity documents to your staging account.`,
      );
    };
    expect(await runCli(["seed", "--env", "staging"], context)).toBe(1);
    expect(output.stderr.join("\n")).toContain("/blobs/stages/multipart");
    expect(output.stdout).toEqual([]);
    interruptUpload = false;
    output.stderr.length = 0;
    await run();
    await run();
    await withSession(
      {
        apiBaseUrl,
        recoveryKey: seedPhrase,
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      },
      async (session) => {
        const { sdk } = session;
        await loadFolderTree(session);
        const keys = sdk.identity.signingKeyPair;
        if (!keys || !rootContainerId)
          throw new Error("Missing account root or keys");
        const contacts = await ensureContactsContainer(
          sdk,
          keys.signingPrivateKey,
        );
        const found = [];
        for (const containerId of [rootContainerId, contacts]) {
          const rows =
            await sdk.containerContents.discoverContainerDocuments(containerId);
          for (const row of rows ?? []) {
            const store = sdk.containerContents.documentLinks().openDocument({
              containerId,
              localId: row.id,
              documentId: row.documentId,
            });
            expect(await store.ensureInitialized()).toBe(true);
            expect(await store.requestRemoteSyncAndWait()).toBe(true);
            const snapshot = store.getSnapshot();
            expect(containerId === contacts).toBe(
              snapshot.documentKind === "contact",
            );
            found.push(snapshot);
            for (const attachment of snapshot.attachments) {
              const key =
                snapshot.attachmentStorageKeyBySlotId[attachment.slotId];
              expect(key).toBeDefined();
              expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
                await readAttachment(attachment.name),
              );
            }
          }
        }
        expect(found.length).toBe(documents.length);
        for (const document of documents) {
          expect(found).toContainEqual(
            expect.objectContaining({
              documentKind: document.kind,
              text: document.text ?? "",
              structuredFields: expect.objectContaining(document.fields ?? {}),
              rows: (document.rows ?? []).map((fields) =>
                expect.objectContaining({ fields }),
              ),
              attachments: expect.arrayContaining(
                document.attachments.map(({ file: name }) =>
                  expect.objectContaining({ name }),
                ),
              ),
            }),
          );
        }
        session.assertNoFailures();
      },
    );
  } finally {
    server.stop(true);
  }
}, 240_000);
