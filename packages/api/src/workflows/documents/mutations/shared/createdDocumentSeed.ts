import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import type { StoredDocumentContentKeyBundle } from "../../../../access/read/documentContentKeyStore";
import type {
  DocumentKekTargetsRead,
  DocumentLinkSetFrontier,
} from "../../../../access/read/documentKekTargets";

const createdDocumentSeed = Symbol("created document seed");

/** Opaque, single-use handoff from a real create, never request material. */
export interface CreatedDocumentSeed {
  readonly [createdDocumentSeed]: true;
}

interface CreatedDocumentSeedRead {
  readonly executor: DatabaseTransaction;
  readonly frontier: DocumentLinkSetFrontier;
  readonly targets: DocumentKekTargetsRead;
  readonly bundle: StoredDocumentContentKeyBundle;
}

const reads = new WeakMap<CreatedDocumentSeed, CreatedDocumentSeedRead>();

export function rememberCreatedDocumentSeed(
  executor: DatabaseTransaction,
  manifest: VerifiedDocumentLinkSetManifest,
  bundle: StoredDocumentContentKeyBundle & {
    readonly currentTargets: DocumentKekTargetsRead["targets"];
  },
): CreatedDocumentSeed {
  const seed = Object.freeze({ [createdDocumentSeed]: true as const });
  reads.set(seed, {
    executor,
    bundle,
    // The create bundle store resolves strictly before returning these targets.
    targets: {
      allowHistoricalParentEpochs: false,
      targets: bundle.currentTargets,
    },
    frontier: Object.freeze({
      documentId: manifest.state.documentId,
      linkSetManifestHash: manifest.manifestHash,
      linkedContainerIds: Object.freeze([...manifest.state.linkedContainerIds]),
    }),
  });
  return seed;
}

/** Only the creating transaction and document can consume this handoff. */
export function takeCreatedDocumentSeed(input: {
  readonly seed: CreatedDocumentSeed | undefined;
  readonly executor: DatabaseTransaction;
  readonly documentId: string;
}): CreatedDocumentSeedRead | undefined {
  if (!input.seed) return undefined;
  const read = reads.get(input.seed);
  reads.delete(input.seed);
  return read?.executor === input.executor &&
    read.frontier.documentId === input.documentId
    ? read
    : undefined;
}
