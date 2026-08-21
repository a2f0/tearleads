import {
  type BlobBytes,
  type BlobStore,
  type DocumentAttachmentUpload,
  defaultDocumentsPersistence,
  type Logger,
  type StoredDocumentKind,
  SymCrypt,
} from "@symcrypt/client-sdk";
import type { ExecSql } from "@symcrypt/client-sdk/sqlite";
import { DRIVER_LICENSE_ATTACHMENT_SLOTS } from "../../src/document-types/drivers-license/driverLicenseDocument";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { createBackupPayload } from "../../src/providers/db/localBackupData";
import { encodeBackupFile } from "../../src/providers/db/localBackupFormat";
import {
  CONTACTS_CONTAINER_NAME,
  deriveUserSystemContainers,
  findUserSystemContainer,
} from "../../src/stores/systemContainers";
import type { SeedFile, SeedSpec } from "./seedTypes";

// Core of the screenshot seeder: interpret a SeedSpec against the REAL client-sdk
// write path (documents.open -> setStructuredFields/setText/attachFiles) and emit
// an encrypted *.scbackup.json the app's backup-restore mini-app can restore.
//
// Why this is the only correct write path (verified): the high-level store
// mutators run the projection save on every write, populating the read models
// the mini-apps read AND writing the Loro snapshot + attachment blobs. Raw
// defaultDocumentsPersistence.saveDocument would leave read models empty and file
// docs byte-less.
//
// Identity: the artifact is authored under a FIXED seed phrase (spec
// .identitySeedPhrase), so the signing private key — and therefore the Contacts
// system slot, HMAC(definition, signingPrivateKey) — is reproducible. Contacts
// are seeded into that identity-scoped Contacts container (not the root), so once
// the Playwright run imports the same phrase and restores, the slot re-derives
// and the Contacts mini-app resolves the container. Notes + files stay in the
// root (Explorer / Notes surface them by kind). See issue #1515.
//
// Infra (a headless SQLite executor + a blob store) is INJECTED so this module
// imports nothing test-only and can live in production-adjacent app source.

const quietLogger: Required<Logger> = {
  log: () => undefined,
  logError: () => undefined,
};

const SEED_DATABASE_ID = "screenshot-seed";

const STORE_READY_TIMEOUT_MS = 5_000;

// Poll a container-contents store to readiness. openTree() hydrates from local
// SQLite asynchronously; ensureSystemContainer must run against a ready tree.
async function waitForStoreReady(store: {
  getSnapshot: () => { ready: boolean };
}): Promise<void> {
  const deadline = Date.now() + STORE_READY_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (store.getSnapshot().ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Container contents store did not become ready.");
}

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

type SeedDocumentLinks = ReturnType<
  InstanceType<typeof SymCrypt>["containerContents"]["documentLinks"]
>;
type OpenSeedDocument = (
  kind: StoredDocumentKind,
  containerId: string,
) => ReturnType<SeedDocumentLinks["openDocument"]>;

// Create the identity-scoped Contacts system container so the Contacts mini-app
// (which resolves it by slot) surfaces the seeded contacts after a same-phrase
// restore. Offline + unauthenticated, ensureSystemContainer takes the local
// device-first path (no remote probe).
async function ensureContactsContainer(
  sdk: InstanceType<typeof SymCrypt>,
  signingPrivateKey: Uint8Array,
): Promise<string> {
  const systemContainers = await deriveUserSystemContainers(signingPrivateKey);
  const contactsSystemContainer = findUserSystemContainer(
    systemContainers,
    "contacts",
  );
  if (!contactsSystemContainer) {
    throw new Error("Contacts system container definition is missing.");
  }
  const tree = sdk.containerContents.openTree();
  // openTree() does not hydrate on its own; the app drives it via updateRuntime
  // when the runtime changes. Push the current runtime once, then refresh from
  // the local root so the store reports ready.
  tree.updateRuntime(sdk.containerContents.workflowRuntime());
  await tree.refreshLocalContainers();
  await waitForStoreReady(tree);
  const contactsNode = await tree.ensureSystemContainer(
    contactsSystemContainer.systemSlot,
    CONTACTS_CONTAINER_NAME,
    { skipAdvancedManagedRoot: true },
  );
  if (!contactsNode) {
    throw new Error("Failed to create the Contacts system container.");
  }
  return contactsNode.id;
}

// Seed non-note documents (images, driver's license, ...) with their structured
// fields + attachment blobs into the given container.
async function seedFiles(
  openDocument: OpenSeedDocument,
  containerId: string,
  files: readonly SeedFile[],
  readAttachment: (fileRef: string) => Promise<BlobBytes>,
): Promise<void> {
  for (const file of files) {
    const store = openDocument(file.kind, containerId);
    await store.ensureInitialized();
    if (file.fields && Object.keys(file.fields).length > 0) {
      await store.setStructuredFields(file.kind, file.fields);
    }
    for (const attachment of file.attachments) {
      const upload: DocumentAttachmentUpload = {
        bytes: await readAttachment(attachment.file),
        mimeType: attachment.mimeType,
        name: attachment.file,
      };
      if (attachment.slot) {
        const slotId =
          file.kind === "drivers_license"
            ? resolveDriverLicenseSlotId(attachment.slot)
            : attachment.slot;
        await store.replaceAttachment(slotId, upload);
      } else {
        // attachFiles is typed void but returns the write-chain promise at
        // runtime; cast to Promise<void> so the await is explicit. A plain
        // Promise.resolve() wrapper reads as redundant and invites a
        // refactor that would drop the await and race the persistence.
        await (store.attachFiles([upload]) as unknown as Promise<void>);
      }
    }
    store.requestSync();
  }
}

export async function buildSeedArtifact(
  spec: SeedSpec,
  deps: BuildSeedArtifactDeps,
): Promise<SeedArtifact> {
  const sdk = new SymCrypt({
    blobStoreFactory: () => deps.blobStore,
    database: { execSql: deps.execSql, id: SEED_DATABASE_ID },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    logger: quietLogger,
    online: false,
  });

  // Import the fixed seed phrase for a deterministic (unlocked) identity:
  // attachFiles needs the encapsulation keypair, and the deterministic signing
  // key makes the Contacts system slot reproducible. Unlike generate(),
  // importSeedPhrase does not bootstrap a root, so create it explicitly.
  await sdk.identity.importSeedPhrase(spec.identitySeedPhrase);
  const signingKeyPair = sdk.identity.signingKeyPair;
  if (!signingKeyPair) {
    throw new Error("Seed identity is missing its signing key pair.");
  }
  const { containerId: rootContainerId } =
    await sdk.session.bootstrapLocalRootContainer();
  await defaultDocumentsPersistence.ensureSchema(deps.execSql);

  // Contacts live in the identity-scoped Contacts container; notes + files stay
  // in the root (Explorer / Notes surface them by kind).
  const contactsContainerId = await ensureContactsContainer(
    sdk,
    signingKeyPair.signingPrivateKey,
  );

  const links = sdk.containerContents.documentLinks();
  const openDocument: OpenSeedDocument = (kind, containerId) =>
    links.openDocument({
      containerId,
      initialDocumentKind: kind,
      initialText: "",
      localId: crypto.randomUUID(),
    });

  for (const contact of spec.contacts ?? []) {
    const store = openDocument("contact", contactsContainerId);
    await store.ensureInitialized();
    await store.setStructuredFields("contact", contact.fields);
    store.requestSync();
  }

  for (const note of spec.notes ?? []) {
    const store = openDocument("note", rootContainerId);
    await store.ensureInitialized();
    await store.setText(note.text);
    store.requestSync();
  }

  await seedFiles(
    openDocument,
    rootContainerId,
    spec.files ?? [],
    deps.readAttachment,
  );

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
