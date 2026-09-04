import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { BlobContentKeyTargetEnvelopeRequest } from "@tearleads/validators/request";
import type {
  BlobContentKeyBundleResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import {
  readLinkedContainerIdsFromDocumentManifest,
  unwrapContainerKekPath,
  verifiedDocumentWrapTargets,
} from "../../shared/projection";
import { unwrapContentKeyTargetForSuite } from "../../shared/projectionContentKeys";
import {
  assertEqualBytes,
  normalizeDocumentKekTargetResponse,
} from "../../shared/readers";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../shared/types";
import { sortBlobTargets } from "./readers";
import type { BlobContentKeyTarget, BlobEncryptedBytesRecord } from "./types";

function blobTargetsFor(
  input: { bindingId: string; documentId: string },
  targets: readonly DocumentContentKeyTarget[],
): BlobContentKeyTarget[] {
  return sortBlobTargets(
    targets.map((target) => ({
      bindingId: input.bindingId,
      documentId: input.documentId,
      ...target,
    })),
  );
}

/**
 * The targets a blob content key may be wrapped to: the verified current
 * heads of the document's linked containers. The server list only names which
 * containers a bundle must cover.
 */
export function verifiedBlobWrapTargetsFromDocumentProjection(input: {
  bindingId: string;
  documentId: string;
  writerProjection: DocumentWriterProjectionResponse;
}): BlobContentKeyTarget[] {
  return blobTargetsFor(
    input,
    verifiedDocumentWrapTargets({
      linkedContainerIds: readLinkedContainerIdsFromDocumentManifest(
        input.writerProjection,
      ),
      serverTargets: normalizeDocumentKekTargetResponse(
        input.writerProjection.documentKekTargets,
      ),
      writerProjection: input.writerProjection,
    }),
  );
}

// Not collectContainerKeksForDocumentSync: the blob upload retry classifier
// keys on the bare "Container writer projection KEK… could not be unwrapped"
// message, which the sync collector would wrap with document-sync context.
async function collectContainerKeks(
  input: {
    execSql?: ExecSql | undefined;
    secretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const keksByEpochId = new Map<string, Uint8Array>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    const projectionKeks = await unwrapContainerKekPath({
      execSql: input.execSql,
      projection,
      secretKey: input.secretKey,
      ...projectionVerificationOptions(input),
    });

    for (const [containerKeyEpochId, keyMaterial] of projectionKeks) {
      const existing = keksByEpochId.get(containerKeyEpochId);
      if (existing) {
        assertEqualBytes(
          existing,
          keyMaterial,
          "Blob writer projection contains conflicting container KEKs",
        );
        continue;
      }
      keksByEpochId.set(containerKeyEpochId, keyMaterial);
    }
  }

  return keksByEpochId;
}

export async function wrapBlobContentKey(
  input: {
    contentKey: Uint8Array;
    execSql?: ExecSql | undefined;
    secretKey: Uint8Array;
    targets: readonly BlobContentKeyTarget[];
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<BlobContentKeyTargetEnvelopeRequest[]> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    secretKey: input.secretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  return Promise.all(
    input.targets.map(async (target) => {
      const targetKek = keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Blob target KEK could not be unwrapped for ${target.containerKeyEpochId}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: BLOB_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

async function unwrapBlobContentKeyTarget(input: {
  containerKek: Uint8Array;
  envelope: BlobContentKeyTargetEnvelopeRequest;
}): Promise<Uint8Array> {
  return unwrapContentKeyTargetForSuite({
    containerKek: input.containerKek,
    envelope: input.envelope,
    label: "Blob",
    suite: BLOB_CONTENT_KEY_WRAP_SUITE,
  });
}

export async function unwrapBlobContentKey(
  input: {
    contentKeyBundle: BlobContentKeyBundleResponse;
    documentId: string;
    encrypted: BlobEncryptedBytesRecord;
    execSql?: ExecSql | undefined;
    expectedBindingId: string;
    secretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<Uint8Array> {
  const keksByEpochId = await collectContainerKeks({
    execSql: input.execSql,
    secretKey: input.secretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });
  let contentKey: Uint8Array | null = null;
  const attachmentTargets = input.contentKeyBundle.targets.filter(
    (envelope) =>
      envelope.bindingId === input.expectedBindingId &&
      envelope.documentId === input.documentId,
  );

  if (attachmentTargets.length === 0) {
    throw new Error("Blob content-key bundle is missing attachment target");
  }

  for (const envelope of attachmentTargets) {
    const containerKek = keksByEpochId.get(envelope.containerKeyEpochId);
    if (!containerKek) {
      continue;
    }
    const unwrapped = await unwrapBlobContentKeyTarget({
      containerKek,
      envelope,
    });
    if (contentKey) {
      assertEqualBytes(
        contentKey,
        unwrapped,
        "Blob content-key targets unwrap to conflicting keys",
      );
      continue;
    }
    contentKey = unwrapped;
  }

  if (!contentKey) {
    throw new Error("Blob content key could not be unwrapped");
  }
  return contentKey;
}
