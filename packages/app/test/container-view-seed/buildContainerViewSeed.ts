import {
  createMemoryBlobStore,
  type DocumentStore,
  defaultDocumentsPersistence,
  Tearleads,
} from "@tearleads/client-sdk";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { CONTACT_AVATAR_SLOT_ID } from "../../src/document-types/contact/contactAvatarSlot";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { createBackupPayload } from "../../src/providers/db/localBackupData";
import { encodeBackupFile } from "../../src/providers/db/localBackupFormat";

function waitForTree(
  tree: ReturnType<Tearleads["containerContents"]["openTree"]>,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Fixture tree not ready"));
    }, 5_000);
    const ready = () => {
      if (tree.getSnapshot().ready) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = tree.subscribe(ready);
    ready();
  });
}

async function seedContact(store: DocumentStore, index: number) {
  await store.setStructuredFields("contact", {
    firstName: index === 0 ? "Ada" : "Grace",
    lastName: index === 0 ? "Lovelace" : "Hopper",
    email: index === 0 ? "ada@example.test" : "grace@example.test",
  });
  if (index === 0)
    await store.replaceAttachment(CONTACT_AVATAR_SLOT_ID, {
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>',
      ),
      mimeType: "image/svg+xml",
      name: "avatar.svg",
    });
}

// Synthetic, already-registered document fixtures, not a sync/registration test.
// Documents start with canonical ids; production never assigns a remote id to a
// local draft. All edits, metadata and backup bytes use the real SDK/app paths.
async function buildContainerViewSeed(output: string) {
  const db = await createTestExecSql("container-view-browser-fixture");
  const blobStore = createMemoryBlobStore();
  const sdk = new Tearleads({
    database: { execSql: db.execSql, id: "container-view-browser" },
    blobStoreFactory: () => blobStore,
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    online: false,
    logger: { log() {}, logError() {} },
  });
  try {
    await sdk.identity.generate();
    const { containerId } = await sdk.session.bootstrapLocalRootContainer();
    const tree = sdk.containerContents.openTree();
    tree.updateRuntime(sdk.containerContents.workflowRuntime());
    await tree.refreshLocalContainers();
    await waitForTree(tree);
    const folder = await tree.createChild(containerId, "Person dossier");
    if (!folder) throw new Error("Fixture folder unavailable");
    await tree.createChild(folder.id, "Supporting files");
    const links = sdk.containerContents.documentLinks();
    await defaultDocumentsPersistence.ensureSchema(db.execSql);
    for (const [index, kind, title] of [
      [0, "contact", "Ada Lovelace"],
      [1, "contact", "Grace Hopper"],
      [2, "note", "Meeting notes"],
      [3, "note", "Follow-up notes"],
    ] as const) {
      const localId = crypto.randomUUID();
      const documentId = crypto.randomUUID();
      await defaultDocumentsPersistence.saveDocument(db.execSql, {
        id: localId,
        documentId,
        containerId: folder.id,
        documentKind: kind,
        title,
        text: "",
        accessEpoch: 1,
        effectiveAccessLevel: "admin",
        snapshotEndVersion: emptyVersionVector(),
      });
      const store = links.openDocument({
        localId,
        documentId,
        containerId: folder.id,
        initialDocumentKind: kind,
      });
      await store.ensureInitialized();
      if (kind === "contact") await seedContact(store, index);
      else await store.setText(`${title}\nExisting note content ${index}.`);
    }
    const draft = links.openDocument({
      localId: crypto.randomUUID(),
      containerId: folder.id,
      initialDocumentKind: "note",
    });
    await draft.ensureInitialized();
    await draft.setText("Offline draft\nNot yet synced.");
    const payload = await createBackupPayload({
      blobStore,
      execSql: db.execSql,
      databaseId: "container-view-browser",
      signingFingerprint: sdk.identity.signingFingerprint,
    });
    const text = await encodeBackupFile({
      payload,
      password: "container-view-test-only",
    });
    await Bun.write(output, text);
    return { folderId: folder.id, rowCount: payload.summary.rowCount };
  } finally {
    sdk.dispose();
    db.close();
  }
}
if (import.meta.main) {
  const output = process.argv[2];
  if (!output) throw new Error("Expected output path");
  console.log(JSON.stringify(await buildContainerViewSeed(output)));
}
