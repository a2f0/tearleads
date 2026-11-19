import {
  type BlobBytes,
  type BlobStore,
  defaultDocumentsPersistence,
  type Logger,
  Tearleads,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { ensureContactsContainer } from "../../src/document-types/continuity/contactsContainer";
import { continuityDocuments } from "../../src/document-types/continuity/seedDocuments";
import type { SeedSpec } from "../../src/document-types/continuity/seedTypes";
import { validateSeedSpec } from "../../src/document-types/continuity/validateSeedSpec";
import { writeContinuityDocument } from "../../src/document-types/continuity/writeContinuityDocument";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { createBackupPayload } from "../../src/providers/db/localBackupData";
import { encodeBackupFile } from "../../src/providers/db/localBackupFormat";

// The screenshot runner restores this encrypted backup using the fixture phrase.

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

export async function buildSeedArtifact(
  spec: SeedSpec,
  deps: BuildSeedArtifactDeps,
): Promise<SeedArtifact> {
  validateSeedSpec(spec);
  const sdk = new Tearleads({
    blobStoreFactory: () => deps.blobStore,
    database: { execSql: deps.execSql, id: SEED_DATABASE_ID },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    logger: quietLogger,
    online: false,
  });

  try {
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

    for (const document of continuityDocuments(spec)) {
      await writeContinuityDocument({
        sdk,
        document,
        localId: crypto.randomUUID(),
        containerId:
          document.kind === "contact" ? contactsContainerId : rootContainerId,
        readAttachment: deps.readAttachment,
      });
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
  } finally {
    sdk.dispose();
  }
}
