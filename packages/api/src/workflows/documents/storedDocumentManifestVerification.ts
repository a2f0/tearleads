import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  KeyingVerificationError,
  makeVerifiedDocumentLinkSetManifest,
  verifyDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  accessManifestCheckpoint,
  createProjectionReaders,
  documentLinkSetStateRecord,
} from "../../keyingProjectionRecords";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { verifyStoredAccessEvent } from "../../utils/storedAccessEventVerification";
import {
  type StoredManifestVerificationStep,
  verifyStoredManifestGraph,
} from "../../utils/storedManifestGraph";
import { loadContainerManifestBundleByHash } from "../containers/writerProjection/accessPaths";
import { toManifestBundleResponse } from "../containers/writerProjection/records";
import { verifyStoredContainerManifest } from "../containers/writerProjection/storedManifestVerification";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "../containers/writerProjection/types";
import {
  type AccessManifestVerificationMarkerStore,
  hasAccessManifestVerificationMarker,
  recordAccessManifestVerificationMarker,
} from "../containers/writerProjection/verificationMarkers";
import {
  loadPrincipalAuthorizationPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "../principals/principalPolicyProjection";
import { loadSignerPublicKey } from "../signerPublicKey";

import { loadCitedDocumentContainerPaths } from "./storedDocumentContainerPaths";

export class StoredDocumentManifestError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(`Stored document manifest failed integrity verification: ${message}`);
    this.name = "StoredDocumentManifestError";
  }
}

interface StoredDocumentManifestVerificationInput {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly containerContext: ContainerWriterProjectionContext;
  /** Markers for document manifests; the container context's by default. */
  readonly documentMarkers?: AccessManifestVerificationMarkerStore | undefined;
  readonly verifiedByHash?:
    | Map<string, VerifiedDocumentLinkSetManifest>
    | undefined;
}

function integrityError(message: string): StoredDocumentManifestError {
  return new StoredDocumentManifestError(message);
}

const {
  readAccessManifest,
  readNullableString,
  readPlainRecord,
  readPositiveInteger,
  readString,
  readStringArray,
  readValue,
  readVerifiedAccessEvent,
  readVersion,
} = createProjectionReaders(integrityError);

function readStoredDocumentManifest(
  bundle: AccessManifestBundleWireResponse,
): VerifiedDocumentLinkSetManifest {
  const stateRecord = readPlainRecord(
    bundle.state,
    "Stored document manifest state",
  );
  readVersion(stateRecord, "Stored document manifest state");
  const state = documentLinkSetStateRecord({
    version: 1,
    documentId: readString(
      stateRecord,
      "documentId",
      "Stored document manifest state",
    ),
    organizationId: readString(
      stateRecord,
      "organizationId",
      "Stored document manifest state",
    ),
    epoch: readPositiveInteger(
      stateRecord,
      "epoch",
      "Stored document manifest state",
    ),
    previousManifestHash: readNullableString(
      stateRecord,
      "previousManifestHash",
      "Stored document manifest state",
    ),
    eventHash: readString(
      stateRecord,
      "eventHash",
      "Stored document manifest state",
    ),
    linkedContainerIds: readStringArray(
      readValue(stateRecord, "linkedContainerIds"),
      "Stored document manifest state.linkedContainerIds",
    ),
  });
  const manifest = readAccessManifest(
    bundle.manifest,
    "Stored document manifest",
  );
  return makeVerifiedDocumentLinkSetManifest({
    event: readVerifiedAccessEvent(
      bundle.event,
      "Stored document access event",
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state,
    checkpoint: accessManifestCheckpoint({
      manifest,
      manifestHash: bundle.manifestHash,
    }),
  });
}

async function loadStoredDocumentBundle(
  executor: DatabaseSession,
  manifestHash: string,
): Promise<AccessManifestBundleWireResponse> {
  const bundle = await getAccessManifestBundle(manifestHash, executor);
  if (bundle?.manifest.objectKind !== "document") {
    throw integrityError("document manifest dependency is missing");
  }
  return toManifestBundleResponse(bundle);
}

export function verifyStoredDocumentManifestTransition(
  input: Parameters<typeof verifyDocumentLinkSetManifest>[0],
) {
  return verifyDocumentLinkSetManifest({
    ...input,
    authorizationMembership: "referenced",
  });
}

async function loadStoredEventSigner(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<Uint8Array> {
  const event = input.manifest.event;
  return loadSignerPublicKey(
    input.context.executor,
    {
      error: () => integrityError("access event signer is inconsistent"),
      fingerprint: event.event.signerKeyFingerprint,
      userId: event.event.signerUserId,
    },
    input.context.signerByUserId,
  );
}

function targetContainerManifestHash(
  manifest: VerifiedDocumentLinkSetManifest,
): string {
  const body = manifest.event.body;
  const hash =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? Reflect.get(body, "containerManifestHash")
      : null;
  if (typeof hash !== "string" || hash.length === 0) {
    throw integrityError("signed event target manifest is missing");
  }
  return hash;
}

async function loadContainerPaths(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly event: VerifiedAccessEvent;
}): Promise<VerifiedContainerAccessManifest[][]> {
  return loadCitedDocumentContainerPaths({
    dependencyManifestHashes: input.event.event.dependencyManifestHashes,
    lineageByHash: input.context.manifestLineageByHash,
    loadManifest: async (manifestHash) => {
      const bundle = await loadContainerManifestBundleByHash(
        input.context,
        manifestHash,
      );
      return verifyStoredContainerManifest({
        bundle,
        context: input.context,
        loadBundle: (hash) =>
          loadContainerManifestBundleByHash(input.context, hash),
      });
    },
  }).catch((error: unknown) => {
    if (error instanceof KeyingVerificationError)
      throw integrityError(error.message);
    throw error;
  });
}

type PreparedDocumentInput = StoredDocumentManifestVerificationInput & {
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
};

function documentMarkerStore(
  input: StoredDocumentManifestVerificationInput,
): AccessManifestVerificationMarkerStore {
  return input.documentMarkers ?? input.containerContext.verificationMarkers;
}

interface PreparedDocumentBundle {
  readonly parsed: VerifiedDocumentLinkSetManifest;
  readonly event: VerifiedAccessEvent;
  readonly signerPublicKey: Uint8Array;
}

async function verifyPreparedBundle(
  input: PreparedDocumentInput,
  { parsed, event, signerPublicKey }: PreparedDocumentBundle,
  previousManifest: VerifiedDocumentLinkSetManifest | null,
): Promise<VerifiedDocumentLinkSetManifest> {
  const containerPaths = await loadContainerPaths({
    context: input.containerContext,
    event,
  });
  const targetHash = targetContainerManifestHash(parsed);
  const targetContainerPath = containerPaths.find(
    (path) => path.at(-1)?.manifestHash === targetHash,
  );
  if (!targetContainerPath) {
    throw integrityError("signed target container path is missing");
  }
  const principalPolicies =
    await loadPrincipalAuthorizationPoliciesForContainerPaths(
      input.containerContext.executor,
      containerPaths,
      input.containerContext.principalPolicyAuthorizationEvidence,
    );
  const result = await verifyStoredDocumentManifestTransition({
    authorizingContainerPaths: containerPaths,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest: parsed.manifest,
    previousManifest,
    principalPolicies,
    targetContainerPath,
  });
  if (!result.ok) {
    throw integrityError(result.error.message);
  }
  if (!canonicalJsonEquals(result.value.state, parsed.state)) {
    throw integrityError("stored state does not match the signed transition");
  }
  input.verifiedByHash.set(input.bundle.manifestHash, result.value);
  // Every dependency was verified (or marked) first, so the marker attests
  // this manifest's whole history.
  await recordAccessManifestVerificationMarker(
    documentMarkerStore(input),
    input.bundle,
    signerPublicKey,
  );
  return result.value;
}

async function prepareBundle(
  input: PreparedDocumentInput,
): Promise<StoredManifestVerificationStep<VerifiedDocumentLinkSetManifest>> {
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) return { value: cached };
  const parsed = readStoredDocumentManifest(input.bundle);
  // As for containers: the signer resolves first, and a marker rebinds the
  // stored bytes and signer key of a manifest verified after its history.
  const signerPublicKey = await loadStoredEventSigner({
    context: input.containerContext,
    manifest: parsed,
  });
  if (
    await hasAccessManifestVerificationMarker(
      documentMarkerStore(input),
      input.bundle,
      signerPublicKey,
    )
  ) {
    input.verifiedByHash.set(input.bundle.manifestHash, parsed);
    return { value: parsed };
  }
  const event = await verifyStoredAccessEvent({
    stored: parsed.event,
    signerPublicKey,
    error: integrityError,
  });
  const previousHash = parsed.state.previousManifestHash;
  return {
    dependencies: previousHash ? [previousHash] : [],
    verify: (dependency) =>
      verifyPreparedBundle(
        input,
        { parsed, event, signerPublicKey },
        previousHash ? dependency(previousHash) : null,
      ),
  };
}

export async function verifyStoredDocumentManifest(
  input: StoredDocumentManifestVerificationInput,
): Promise<VerifiedDocumentLinkSetManifest> {
  try {
    const verifiedByHash = input.verifiedByHash ?? new Map();
    const cached = verifiedByHash.get(input.bundle.manifestHash);
    if (cached) return cached;
    const verified = await verifyStoredManifestGraph({
      rootHash: input.bundle.manifestHash,
      error: integrityError,
      prepare: async (hash) => {
        const bundle =
          hash === input.bundle.manifestHash
            ? input.bundle
            : await loadStoredDocumentBundle(
                input.containerContext.executor,
                hash,
              );
        if (bundle.manifestHash !== hash)
          throw integrityError("manifest dependency hash is inconsistent");
        return prepareBundle({
          bundle,
          containerContext: input.containerContext,
          documentMarkers: input.documentMarkers,
          verifiedByHash,
        });
      },
    });
    verifiedByHash.set(input.bundle.manifestHash, verified);
    return verified;
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw error;
    }
    if (
      error instanceof ContainerWriterProjectionError ||
      error instanceof KeyingVerificationError ||
      error instanceof PrincipalPolicyProjectionError
    ) {
      throw integrityError(error.message);
    }
    throw error;
  }
}
