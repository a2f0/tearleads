import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  decryptWithDek,
  encryptWithDek,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { BlobContentKeyTargetEnvelopeRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { readCanonicalRecordPaths } from "../../../keyingCanonicalJson";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { unwrapContainerKekPath } from "../../shared/projection";
import { assertEqualBytes } from "../../shared/readers";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../shared/types";
import { normalizeDocumentTarget, sortBlobTargets } from "./readers";
import type { BlobContentKeyTarget, BlobEncryptedBytesRecord } from "./types";

export function deriveBlobTargetsFromDocumentProjection(input: {
  bindingId: string;
  documentId: string;
  writerProjection: DocumentWriterProjectionResponse;
}): BlobContentKeyTarget[] {
  return sortBlobTargets(
    input.writerProjection.documentKekTargets.targets.map((target) => ({
      bindingId: input.bindingId,
      documentId: input.documentId,
      ...normalizeDocumentTarget(target),
    })),
  );
}

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
  const metadata = input.envelope.wrappingMetadata;
  const suite = isPlainRecord(metadata)
    ? Reflect.get(metadata, "suite")
    : undefined;
  const iv = isPlainRecord(metadata) ? Reflect.get(metadata, "iv") : undefined;
  if (suite !== BLOB_CONTENT_KEY_WRAP_SUITE) {
    throw new Error("Blob content-key target uses an unknown suite");
  }
  if (typeof iv !== "string" || iv.length === 0) {
    throw new Error("Blob content-key target is missing an IV");
  }

  return decryptWithDek(
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(input.envelope.wrappedKey),
    },
    input.containerKek,
  );
}

export function authorizingContainerPathRecords(
  writerProjection: DocumentWriterProjectionResponse,
): Record<string, unknown>[][] {
  return readCanonicalRecordPaths(
    writerProjection.authorizingContainerPaths.map(
      (projection) => projection.path,
    ),
    "Blob authorizing container paths",
  );
}

export async function unwrapBlobContentKey(
  input: {
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
  const attachmentTargets = input.encrypted.contentKeyBundle.targets.filter(
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
