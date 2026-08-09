import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  makeVerifiedDocumentLinkSetManifest,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  accessManifestCheckpoint,
  createProjectionReaders,
  documentLinkSetStateRecord,
} from "../../keyingProjectionRecords";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { loadContainerManifestBundleByHash } from "../containers/writerProjection/accessPaths";
import { toManifestBundleResponse } from "../containers/writerProjection/records";
import { verifyStoredContainerManifest } from "../containers/writerProjection/storedManifestVerification";
import type { ContainerWriterProjectionContext } from "../containers/writerProjection/types";
import { loadPrincipalPoliciesForContainerPaths } from "../principals/principalPolicyProjection";
import { loadSignerPublicKey } from "../signerPublicKey";

const MAX_CONTAINER_PATH_DEPTH = 100;

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
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw integrityError("document manifest dependency is missing");
  }
  return toManifestBundleResponse(bundle);
}

async function verifyStoredEvent(input: {
  readonly executor: DatabaseSession;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<VerifiedAccessEvent> {
  const event = input.manifest.event;
  const result = await verifySignedAccessEvent({
    body: event.body,
    event: event.event,
    signerPublicKey: await loadSignerPublicKey(input.executor, {
      error: () => integrityError("access event signer is inconsistent"),
      fingerprint: event.event.signerKeyFingerprint,
      userId: event.event.signerUserId,
    }),
  });
  if (!result.ok) {
    throw integrityError(result.error.message);
  }
  if (result.value.eventHash !== event.eventHash) {
    throw integrityError("access event hash is inconsistent");
  }
  return result.value;
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

async function loadVerifiedContainerPath(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly leafManifestHash: string;
}): Promise<VerifiedContainerAccessManifest[]> {
  const reversed: VerifiedContainerAccessManifest[] = [];
  let manifestHash: string | null = input.leafManifestHash;
  while (manifestHash) {
    if (reversed.length >= MAX_CONTAINER_PATH_DEPTH) {
      throw integrityError("container path exceeds maximum depth");
    }
    const bundle = await loadContainerManifestBundleByHash(
      input.context,
      manifestHash,
    );
    const manifest = await verifyStoredContainerManifest({
      bundle,
      context: input.context,
      loadBundle: (hash) =>
        loadContainerManifestBundleByHash(input.context, hash),
    });
    reversed.push(manifest);
    manifestHash = manifest.state.parentManifestHash;
  }
  return reversed.reverse();
}

async function loadContainerPaths(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly event: VerifiedAccessEvent;
}): Promise<VerifiedContainerAccessManifest[][]> {
  const paths: VerifiedContainerAccessManifest[][] = [];
  for (const manifestHash of input.event.event.dependencyManifestHashes) {
    paths.push(
      await loadVerifiedContainerPath({
        context: input.context,
        leafManifestHash: manifestHash,
      }),
    );
  }
  return paths;
}

async function verifyBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly containerContext: ContainerWriterProjectionContext;
  readonly verifiedByHash: Map<string, VerifiedDocumentLinkSetManifest>;
  readonly visiting: ReadonlySet<string>;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    return cached;
  }
  if (input.visiting.has(input.bundle.manifestHash)) {
    throw integrityError("manifest history contains a cycle");
  }

  const visiting = new Set(input.visiting).add(input.bundle.manifestHash);
  const parsed = readStoredDocumentManifest(input.bundle);
  const event = await verifyStoredEvent({
    executor: input.containerContext.executor,
    manifest: parsed,
  });
  const previousManifest = parsed.state.previousManifestHash
    ? await verifyBundle({
        bundle: await loadStoredDocumentBundle(
          input.containerContext.executor,
          parsed.state.previousManifestHash,
        ),
        containerContext: input.containerContext,
        verifiedByHash: input.verifiedByHash,
        visiting,
      })
    : null;
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
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.containerContext.executor,
    containerPaths,
  );
  const result = await verifyDocumentLinkSetManifest({
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
  return result.value;
}

export async function verifyStoredDocumentManifest(
  input: StoredDocumentManifestVerificationInput,
): Promise<VerifiedDocumentLinkSetManifest> {
  try {
    return await verifyBundle({
      bundle: input.bundle,
      containerContext: input.containerContext,
      verifiedByHash: input.verifiedByHash ?? new Map(),
      visiting: new Set(),
    });
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw error;
    }
    throw integrityError(
      error instanceof Error ? error.message : "stored bundle is invalid",
    );
  }
}
