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
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCache } from "../../keyingProjectionVerification";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { unwrapContainerKekPath } from "./containerKekPath";
import {
  deriveDocumentCreateTargets,
  describeProjectionTargetKek,
} from "./projectionTargets";
import { assertEqualBytes, errorMessage } from "./readers";
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

  return decryptWithDek(
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(input.envelope.wrappedKey),
    },
    input.containerKek,
  );
}

export async function collectContainerKeksForDocumentSync(
  input: {
    execSql?: ExecSql | undefined;
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    secretKey: Uint8Array;
    verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const keksByEpochId = new Map<string, Uint8Array>();

  for (const projection of input.writerProjection.authorizingContainerPaths) {
    let projectionKeks: ReadonlyMap<string, Uint8Array>;
    try {
      projectionKeks = await unwrapContainerKekPath({
        execSql: input.execSql,
        principalPolicyCache: input.principalPolicyCache,
        projection,
        secretKey: input.secretKey,
        verifiedByHash: input.verifiedByHash,
        ...projectionVerificationOptions(input),
      });
    } catch (error) {
      throw new Error(
        `Document authorizing container KEK path could not be unwrapped for ${describeProjectionTargetKek(projection)}: ${errorMessage(error)}`,
      );
    }
    for (const [containerKeyEpochId, keyMaterial] of projectionKeks) {
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

  return keksByEpochId;
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
  const keksByEpochId = await collectContainerKeksForDocumentSync(input);
  let contentKey: Uint8Array | null = null;

  for (const envelope of input.writerProjection.contentKeyBundle.targets) {
    const containerKek = keksByEpochId.get(envelope.containerKeyEpochId);
    if (!containerKek) {
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
    throw new Error(
      `Document content key could not be unwrapped from any of ${input.writerProjection.contentKeyBundle.targets.length} target(s)`,
    );
  }
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  return contentKey;
}
