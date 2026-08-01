import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  decryptWithDek,
  encryptWithDek,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentContentKeyTargetEnvelope } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCache } from "../../keyingProjectionVerification";
import { throwKeyingVerificationErrorWithContext } from "../../keyingProjectionVerification/error";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  unwrapContainerKekPath,
  unwrapContainerKekPathWithHistoryFailures,
} from "./containerKekPath";
import {
  deriveDocumentCreateTargets,
  describeProjectionTargetKek,
} from "./projectionTargets";
import {
  assertEqualBytes,
  describeDocumentTargetKek,
  normalizeDocumentKekTargetResponse,
} from "./readers";
import type { ProjectionVerificationOptions } from "./types";
import { projectionVerificationOptions } from "./types";

function getOnlyDocumentCreateTarget(
  projection: ContainerWriterProjectionResponse,
) {
  const target = deriveDocumentCreateTargets(projection)[0];
  if (!target) {
    throw new Error("Document create target is unavailable");
  }
  return target;
}

export async function wrapDocumentContentKeyForCreate(
  input: {
    contentKey: Uint8Array;
    execSql?: ExecSql | undefined;
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    projection: ContainerWriterProjectionResponse;
    secretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<DocumentContentKeyTargetEnvelope[]> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    projection: input.projection,
    secretKey: input.secretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getOnlyDocumentCreateTarget(input.projection);
  const targetKek = keksByEpochId.get(target.containerKeyEpochId);
  if (!targetKek) {
    throw new Error("Document create target KEK could not be unwrapped");
  }

  const wrapped = await encryptWithDek(input.contentKey, targetKek);

  return [
    {
      ...target,
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: {
        suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
        iv: bytesToBase64(wrapped.iv),
      },
    },
  ];
}

export async function unwrapDocumentContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: DocumentContentKeyTargetEnvelope;
}): Promise<Uint8Array> {
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== DOCUMENT_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Document content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Document content-key target is missing an IV");
  }

  try {
    return await decryptWithDek(
      {
        iv: base64ToBytes(iv),
        ciphertext: base64ToBytes(input.envelope.wrappedKey),
      },
      input.containerKek,
    );
  } catch (error) {
    throw new Error(
      `Document content-key target for container ${input.envelope.containerId} at epoch ${input.envelope.containerKeyEpochId} could not be unwrapped`,
      { cause: error },
    );
  }
}

interface CollectedContainerKeks {
  readonly keksByEpochId: ReadonlyMap<string, Uint8Array>;
  readonly predecessorFailuresByEpochId: ReadonlyMap<string, Error>;
}

export class DocumentHistoryUnavailableError extends Error {
  constructor(readonly historyCause: unknown) {
    super(
      historyCause instanceof Error
        ? historyCause.message
        : "Document history key is unavailable",
    );
    this.name = "DocumentHistoryUnavailableError";
  }
}

export async function collectContainerKeksForDocumentSync(
  input: {
    execSql?: ExecSql | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    secretKey: Uint8Array;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<CollectedContainerKeks> {
  const keksByEpochId = new Map<string, Uint8Array>();
  const predecessorFailuresByEpochId = new Map<string, Error>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    let projectionKeks: Awaited<
      ReturnType<typeof unwrapContainerKekPathWithHistoryFailures>
    >;
    try {
      projectionKeks = await unwrapContainerKekPathWithHistoryFailures({
        execSql: input.execSql,
        knownContainerKeks: keksByEpochId,
        principalPolicyCache: input.principalPolicyCache,
        projection,
        secretKey: input.secretKey,
        verifiedByHash: input.verifiedByHash,
        ...projectionVerificationOptions(input),
      });
    } catch (error) {
      throwKeyingVerificationErrorWithContext(
        error,
        `Document authorizing container KEK path could not be unwrapped for ${describeProjectionTargetKek(projection)}`,
      );
    }
    for (const [
      containerKeyEpochId,
      failure,
    ] of projectionKeks.predecessorFailuresByEpochId) {
      if (!predecessorFailuresByEpochId.has(containerKeyEpochId)) {
        predecessorFailuresByEpochId.set(containerKeyEpochId, failure);
      }
    }
    for (const [
      containerKeyEpochId,
      keyMaterial,
    ] of projectionKeks.keksByEpochId) {
      const existing = keksByEpochId.get(containerKeyEpochId);
      if (existing) {
        assertEqualBytes(
          existing,
          keyMaterial,
          "Document writer projection contains conflicting container KEKs",
        );
        continue;
      }
      keksByEpochId.set(containerKeyEpochId, keyMaterial);
    }
  }

  return { keksByEpochId, predecessorFailuresByEpochId };
}

export async function unwrapDocumentContentKeyFromBundle(
  bundle: DocumentContentKeyBundleResponse,
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>,
  predecessorFailuresByEpochId: ReadonlyMap<string, Error> = new Map(),
): Promise<Uint8Array> {
  let contentKey: Uint8Array | null = null;
  let predecessorFailure: unknown;

  for (const envelope of bundle.targets) {
    const containerKek = containerKeksByEpochId.get(
      envelope.containerKeyEpochId,
    );
    if (!containerKek) {
      predecessorFailure ??= predecessorFailuresByEpochId.get(
        envelope.containerKeyEpochId,
      );
      continue;
    }
    const unwrapped = await unwrapDocumentContentKeyTarget({
      containerKek,
      envelope,
    });
    if (contentKey) {
      assertEqualBytes(
        contentKey,
        unwrapped,
        "Document content-key targets unwrap to conflicting keys",
      );
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    if (predecessorFailure !== undefined) {
      throw new DocumentHistoryUnavailableError(predecessorFailure);
    }
    throw new Error("Document content key could not be unwrapped");
  }
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  return contentKey;
}

export async function unwrapDocumentContentKeyFromWriterProjection(
  input: {
    execSql?: ExecSql | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    secretKey: Uint8Array;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<Uint8Array> {
  const collectedKeks = await collectContainerKeksForDocumentSync(input);

  return unwrapDocumentContentKeyFromBundle(
    input.writerProjection.contentKeyBundle,
    collectedKeks.keksByEpochId,
    collectedKeks.predecessorFailuresByEpochId,
  );
}

/**
 * Builds the healing bundle for a stale content-key bundle: wraps a FRESH
 * content key to the projection's CURRENT KEK targets at the next
 * content-key epoch. A current reader can recover the stale bundle through
 * the container predecessor chain; the fresh key is still required so a
 * holder revoked by the container rotation cannot decrypt future updates.
 * Recovery re-encrypts a full-history snapshot under that fresh key.
 *
 * Like every content-key rotation (unlink included), this requires the KEK
 * of EVERY linked-container target: all envelopes in a bundle must wrap the
 * same key, so an inaccessible target's envelope can neither be carried
 * forward (it wraps the old key) nor fabricated. A writer authorized through
 * only a subset of a multi-container link set fails here with a named target
 * and leaves the heal to a member who spans all of them.
 */
export async function buildRotatedDocumentContentKeyBundle(input: {
  containerKeksByEpochId: ReadonlyMap<string, Uint8Array>;
  contentKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentContentKeyBundleResponse> {
  const { contentKeyBundle, documentKekTargets } = input.writerProjection;
  const targets = normalizeDocumentKekTargetResponse(documentKekTargets);
  const envelopes: DocumentContentKeyBundleResponse["targets"] = [];

  for (const target of targets) {
    const containerKek = input.containerKeksByEpochId.get(
      target.containerKeyEpochId,
    );
    if (!containerKek) {
      throw new Error(
        `Document content-key re-wrap KEK is unavailable for ${describeDocumentTargetKek(target)}`,
      );
    }
    const wrapped = await encryptWithDek(input.contentKey, containerKek);
    envelopes.push({
      ...target,
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: {
        suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
        iv: bytesToBase64(wrapped.iv),
      },
    });
  }

  return {
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch + 1,
    documentId: contentKeyBundle.documentId,
    linkSetManifestHash: documentKekTargets.linkSetManifestHash,
    targetHash: documentKekTargets.documentKeyTargetHash,
    targets: envelopes,
  };
}
