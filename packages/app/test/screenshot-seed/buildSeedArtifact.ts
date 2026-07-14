import {
  type BlobBytes,
  type BlobStore,
  type DocumentAttachmentUpload,
  defaultDocumentsPersistence,
  type Logger,
  type StoredDocumentKind,
  Tearleads,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { DRIVER_LICENSE_ATTACHMENT_SLOTS } from "../../src/document-types/drivers-license/driverLicenseDocument";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { createBackupPayload } from "../../src/providers/db/localBackupData";
import { encodeBackupFile } from "../../src/providers/db/localBackupFormat";
import type { SeedSpec } from "./seedTypes";

// Core of the screenshot seeder: interpret a SeedSpec against the REAL client-sdk
// write path (documents.open -> setStructuredFields/setText/attachFiles) and emit
// an encrypted *.tlbackup.json the app's backup-restore mini-app can restore.
//
// Why this is the only correct write path (verified): the high-level store
// mutators run the projection save on every write, populating the read models
// the mini-apps read AND writing the Loro snapshot + attachment blobs. Raw
// defaultDocumentsPersistence.saveDocument would leave read models empty and file
// docs byte-less.
//
// Everything is seeded into the root container. Explorer (root) and Notes
// (by-kind) surface it after a cross-identity restore; the Contacts mini-app
// reads an identity-scoped system container that a cross-identity restore cannot
// reproduce, so contacts appear in Explorer as contact documents but not in the
// Contacts app. See issue #1515.
//
// Infra (a headless SQLite executor + a blob store) is INJECTED so this module
// imports nothing test-only and can live in production-adjacent app source.

const quietLogger: Required<Logger> = {
  log: () => undefined,
  logError: () => undefined,
};

const SEED_DATABASE_ID = "screenshot-seed";

interface BuildSeedArtifactDeps {
  readonly blobStore: BlobStore;
  readonly execSql: ExecSql;
  /** Resolve an attachment's raw bytes from its fixture reference. */
  readonly readAttachment: (fileRef: string) => Promise<BlobBytes>;
}

interface SeedArtifact {
  readonly text: string;
  readonly summary: { readonly rowCount: number; readonly blobCount: number };
}

function resolveDriverLicenseSlotId(slot: string): string {
  const match = DRIVER_LICENSE_ATTACHMENT_SLOTS.find((candidate) =>
    candidate.slotId.toLowerCase().includes(slot.toLowerCase()),
  );
  if (!match) {
    throw new Error(`Unknown driver's license attachment slot: ${slot}`);
  }
  return match.slotId;
}

export async function buildSeedArtifact(
  spec: SeedSpec,
  deps: BuildSeedArtifactDeps,
): Promise<SeedArtifact> {
  const sdk = new Tearleads({
    blobStoreFactory: () => deps.blobStore,
    database: { execSql: deps.execSql, id: SEED_DATABASE_ID },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    logger: quietLogger,
    online: false,
  });

  // Generate an unlocked identity: attachFiles requires the encapsulation
  // keypair, and this bootstraps the single root container everything links to.
  const identity = await sdk.identity.generate();
  const containerId = identity.rootContainerId;
  await defaultDocumentsPersistence.ensureSchema(deps.execSql);

  const links = sdk.containerContents.documentLinks();
  const openDocument = (kind: StoredDocumentKind) =>
    links.openDocument({
      containerId,
      initialDocumentKind: kind,
      initialText: "",
      localId: crypto.randomUUID(),
    });

  for (const contact of spec.contacts ?? []) {
    const store = openDocument("contact");
    await store.ensureInitialized();
    await store.setStructuredFields("contact", contact.fields);
    store.requestSync();
  }

  for (const note of spec.notes ?? []) {
    const store = openDocument("note");
    await store.ensureInitialized();
    await store.setText(note.text);
    store.requestSync();
  }

  for (const file of spec.files ?? []) {
    const store = openDocument(file.kind);
    await store.ensureInitialized();
    if (file.fields && Object.keys(file.fields).length > 0) {
      await store.setStructuredFields(file.kind, file.fields);
    }
    for (const attachment of file.attachments) {
      const upload: DocumentAttachmentUpload = {
        bytes: await deps.readAttachment(attachment.file),
        mimeType: attachment.mimeType,
        name: attachment.file,
      };
      if (attachment.slot) {
        const slotId =
          file.kind === "drivers_license"
            ? resolveDriverLicenseSlotId(attachment.slot)
            : attachment.slot;
        // setAttachment/attachFiles are typed void but return the write-chain
        // promise at runtime; Promise.resolve awaits the persistence either way.
        await Promise.resolve(store.setAttachment(slotId, upload));
      } else {
        await Promise.resolve(store.attachFiles([upload]));
      }
    }
    store.requestSync();
  }

  const payload = await createBackupPayload({
    blobStore: deps.blobStore,
    databaseId: SEED_DATABASE_ID,
    execSql: deps.execSql,
    signingFingerprint: sdk.identity.signingFingerprint,
  });
  const text = await encodeBackupFile({ password: spec.password, payload });

  return {
    summary: {
      blobCount: payload.summary.blobCount,
      rowCount: payload.summary.rowCount,
    },
    text,
  };
}
