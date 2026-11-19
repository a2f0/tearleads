import { expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { RemoteDocumentService } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  ensureContactsContainer,
  writeContinuityDocument,
} from "app/continuity";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

test.each([
  "database switch",
  "oversized birth",
  "invalid attachment metadata",
  "rows on a note",
  "unknown contact field",
  "reserved row field",
  "switch while reading fixture",
] as const)(
  "%s prevents seeded document submission",
  async (scenario) => {
    await initializeApiDatabase();
    let watch = false;
    let posts = 0;
    const creates = spyOn(
      RemoteDocumentService.prototype,
      "createRemoteDocument",
    );
    let switchDatabase: (() => void) | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (watch && path === "/documents" && request.method === "POST") {
          posts++;
          return new Response(null, { status: 503 });
        }
        const response = await routeApp.fetch(request);
        if (watch && path.endsWith("/writer-projection") && switchDatabase) {
          const change = switchDatabase;
          switchDatabase = undefined;
          change();
        }
        return response;
      },
    });
    try {
      const apiBaseUrl = server.url.origin;
      const { seedPhrase, rootContainerId } =
        await registerCliTestAccount(apiBaseUrl);
      if (!rootContainerId) throw new Error("Missing root");
      await withSession(
        {
          apiBaseUrl,
          recoveryKey: seedPhrase,
          documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        },
        async (session) => {
          const { sdk } = session;
          await loadFolderTree(session);
          sdk.documents
            .workflowRuntime()
            .apiClient.evictContainerWriterProjection(rootContainerId);
          if (scenario === "database switch") {
            switchDatabase = () => {
              const active = creates.mock.lastCall?.[0].stillCurrent;
              expect(active?.()).toBe(true);
              sdk.database.configure({
                ...sdk.database.snapshot,
                id: crypto.randomUUID(),
              });
              expect(active?.()).toBe(false);
            };
          }
          if (scenario === "reserved row field") {
            watch = true;
            await expect(
              sdk.documents.createSeeded({
                containerId: rootContainerId,
                documentId: crypto.randomUUID(),
                initialDocumentKind: "weight",
                initialRows: [{ "@createdAt": "Reserved" }],
              }),
            ).rejects.toThrow("Invalid initial document row fields");
            expect(posts).toBe(0);
            return;
          }
          if (scenario === "unknown contact field") {
            watch = true;
            await expect(
              sdk.documents.createSeeded({
                containerId: rootContainerId,
                documentId: crypto.randomUUID(),
                initialDocumentKind: "contact",
                initialStructuredFields: { typoField: "Invisible" },
              }),
            ).rejects.toThrow("Invalid initial document fields");
            expect(posts).toBe(0);
            return;
          }
          if (scenario === "rows on a note") {
            watch = true;
            await expect(
              sdk.documents.createSeeded({
                containerId: rootContainerId,
                documentId: crypto.randomUUID(),
                initialRows: [{ label: "Hidden row" }],
              }),
            ).rejects.toThrow("A seeded note cannot contain rows");
            expect(posts).toBe(0);
            return;
          }
          if (scenario === "invalid attachment metadata") {
            const avatar = {
              slotId: "avatar",
              name: "avatar.png",
              mimeType: "image/png",
              byteLength: 3,
              contentSha256: "f".repeat(64),
            };
            watch = true;
            for (const initialAttachments of [
              [avatar, avatar],
              [{ ...avatar, contentSha256: "broken" }],
              [{ ...avatar, slotId: "" }],
            ]) {
              await expect(
                sdk.documents.createSeeded({
                  containerId: rootContainerId,
                  documentId: crypto.randomUUID(),
                  initialAttachments,
                }),
              ).rejects.toThrow(
                "Invalid or duplicate initial attachment metadata",
              );
            }
            expect(posts).toBe(0);
            return;
          }
          if (scenario === "switch while reading fixture") {
            const create = spyOn(sdk.documents, "createSeeded");
            try {
              watch = true;
              await expect(
                writeContinuityDocument({
                  sdk,
                  destination: "account",
                  containerId: rootContainerId,
                  localId: crypto.randomUUID(),
                  document: {
                    key: "test",
                    kind: "contact",
                    attachments: [
                      { file: "avatar.png", mimeType: "image/png" },
                    ],
                  },
                  readAttachment: async () => {
                    sdk.database.configure({
                      ...sdk.database.snapshot,
                      id: crypto.randomUUID(),
                    });
                    return new Uint8Array([1]);
                  },
                }),
              ).rejects.toThrow("writer scope changed");
              expect(create).not.toHaveBeenCalled();
              expect(posts).toBe(0);
            } finally {
              create.mockRestore();
            }
            return;
          }
          // Incompressible plaintext exceeds the signed sync request limit.
          const initialText =
            scenario === "oversized birth"
              ? randomBytes(16 * 1024 * 1024).toString("base64")
              : "Initial text";
          watch = true;
          await expect(
            sdk.documents.createSeeded({
              containerId: rootContainerId,
              documentId: crypto.randomUUID(),
              initialText,
            }),
          ).rejects.toThrow(
            scenario === "database switch"
              ? "scope changed"
              : "fit in one seeded create",
          );
          expect(switchDatabase).toBeUndefined();
          expect(posts).toBe(0);
        },
      );
    } finally {
      creates.mockRestore();
      server.stop(true);
    }
  },
  60_000,
);

test("changing organizations during Contacts slot derivation never opens the replacement tree", async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: routeApp.fetch,
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
    await withSession(
      { apiBaseUrl, recoveryKey: seedPhrase },
      async ({ sdk }) => {
        const open = spyOn(
          sdk.containerContents,
          "openTree",
        ).mockImplementation(() => {
          throw new Error("Opened the replacement tree");
        });
        try {
          const setup = ensureContactsContainer(sdk);
          sdk.session.setOrganizationId(crypto.randomUUID());
          await expect(setup).rejects.toThrow("writer scope changed");
          expect(open).not.toHaveBeenCalled();
        } finally {
          open.mockRestore();
        }
      },
    );
  } finally {
    server.stop(true);
  }
}, 30_000);

test("a later edit identical to a fixture cannot stand in for its original seed", async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: routeApp.fetch,
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    if (!rootContainerId) throw new Error("Missing personal root");
    await withSession(
      { apiBaseUrl, recoveryKey: seedPhrase },
      async (session) => {
        await loadFolderTree(session);
        const { sdk } = session;
        const documentId = crypto.randomUUID();
        const receipt = await sdk.documents.createSeeded({
          containerId: rootContainerId,
          documentId,
          initialText: "My note",
        });
        if (receipt === "purged") throw new Error("Unexpected purge");
        const [summary] = await sdk.containerContents
          .documentQueries()
          .upsertDiscoveredDocuments([receipt]);
        if (!summary) throw new Error("Missing note");
        const store = sdk.containerContents.documentLinks().openDocument({
          containerId: rootContainerId,
          documentId,
          localId: summary.id,
        });
        expect(await store.ensureInitialized()).toBe(true);
        expect(await store.requestRemoteSyncAndWait()).toBe(true);
        const text = "Looks like the fixture";
        await store.setText(text);
        expect(await store.requestRemoteSyncAndWait()).toBe(true);
        await expect(
          writeContinuityDocument({
            destination: "account",
            sdk,
            existing: { documentId, localId: summary.id },
            localId: summary.id,
            containerId: rootContainerId,
            document: { key: "note/0", kind: "note", text, attachments: [] },
            readAttachment: async () => new Uint8Array(),
          }),
        ).rejects.toThrow("no synced birth content");
        expect(store.getSnapshot().text).toBe(text);
      },
    );
  } finally {
    server.stop(true);
  }
}, 30_000);
