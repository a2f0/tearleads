import { expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { RemoteDocumentService } from "@tearleads/client-sdk";
import { writeContinuityDocument } from "app/continuity";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

test.each([
  "database switch",
  "oversized birth",
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
        { apiBaseUrl, recoveryKey: seedPhrase },
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
