import type { BlobWriteAuthorization } from "@tearleads/api-shared/schema";
import type {
  AccessEvent,
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  WriteHeader,
} from "@tearleads/crypto";
import { makeVerifiedBlobKekTargets } from "@tearleads/crypto";
import type {
  BlobContentKeyBundleRequest,
  BlobContentKeyTargetEnvelopeRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobContentKeyBundleResponse,
  BlobKekTargetsResponse,
} from "@tearleads/validators/response";
import { z } from "zod";
import type {
  BlobContentKeyTargetEnvelope,
  StoredBlobContentKeyBundleWithTargets,
} from "../../../access/read/blobContentKeyStore";
import type { resolveCurrentBlobKekTargets } from "../../../access/read/blobKekTargets";
import {
  readProjectionAccessEvent,
  readProjectionWriteHeader,
} from "../../../keyingProjectionRecords";
import {
  copyProjectionRecord,
  parseProjection,
  projectionCanonicalJson,
  projectionString,
} from "../../../keyingProjectionSchemas";
import { BlobMutationError } from "./types";

export type ResolvedBlobKekTargets = Awaited<
  ReturnType<typeof resolveCurrentBlobKekTargets>
>;

function blobShapeError(message: string): BlobMutationError {
  return new BlobMutationError(message, 400);
}

const attachmentDetachClaimsSchema = z.object({
  bindingId: projectionString,
  blobId: projectionString,
  documentId: projectionString,
  slotId: projectionString,
  documentManifestHash: projectionString,
});

const attachmentBindClaimsSchema = z.object({
  bindingId: projectionString,
  blobId: projectionString,
  documentId: projectionString,
  slotId: projectionString,
  expectedBindingId: projectionString.nullable(),
  documentManifestHash: projectionString,
});

/** Signed body claims; the first missing or empty claim names the error. */
function readBodyClaims<Schema extends z.ZodObject>(
  schema: Schema,
  body: unknown,
  label: string,
): z.output<Schema> {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }
  const [claim = "bindingId"] = result.error.issues[0]?.path ?? [];
  throw new BlobMutationError(`${label}.${String(claim)} is required`, 400);
}

export function readBindBodyClaim(
  body: unknown,
): AttachmentBindAccessEventBody {
  return {
    eventType: "attachment.bind",
    ...readBodyClaims(attachmentBindClaimsSchema, body, "attachment.bind body"),
  };
}

export function readDetachBodyClaim(
  body: unknown,
): AttachmentDetachAccessEventBody {
  return {
    eventType: "attachment.detach",
    ...readBodyClaims(
      attachmentDetachClaimsSchema,
      body,
      "attachment.detach body",
    ),
  };
}

export function readBlobEvent(value: unknown, label: string): AccessEvent {
  return readProjectionAccessEvent(value, label, blobShapeError);
}

export function readWriteHeader(value: unknown, label: string): WriteHeader {
  return readProjectionWriteHeader(value, label, blobShapeError);
}

export function verifiedBlobKekTargetsFromResolved(
  targets: ResolvedBlobKekTargets,
): VerifiedBlobKekTargets {
  return makeVerifiedBlobKekTargets({
    blobId: targets.blobId,
    organizationId: targets.organizationId,
    activeBindingIds: [...targets.activeBindingIds],
    documentManifestHashes: [...targets.documentManifestHashes],
    linkedContainerManifestHashes: [...targets.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...targets.linkedContainerKeyEpochIds],
    targets: targets.targets.map((target) => ({ ...target })),
    blobKeyTargetHash: targets.blobKeyTargetHash,
    blobAccessManifestHash: targets.blobAccessManifestHash,
  });
}

function readContentKeyWrappingMetadata(
  value: unknown,
  label: string,
): KeyingCanonicalJson {
  return parseProjection(projectionCanonicalJson, value, label, blobShapeError);
}

function contentKeyWrappingMetadataRecord(
  value: KeyingCanonicalJson,
  label: string,
): Record<string, unknown> {
  return copyProjectionRecord(value, label, blobShapeError);
}

function toStoredTargetEnvelope(
  target: BlobContentKeyTargetEnvelopeRequest,
): BlobContentKeyTargetEnvelope {
  return {
    bindingId: target.bindingId,
    documentId: target.documentId,
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
    wrappedKey: target.wrappedKey,
    wrappingMetadata: readContentKeyWrappingMetadata(
      target.wrappingMetadata,
      "Blob content-key target wrapping metadata",
    ),
  };
}

export function toStoredContentKeyBundleInput(
  binding: VerifiedAttachmentBinding,
  bundle: BlobContentKeyBundleRequest,
) {
  return {
    blobId: binding.blobId,
    bindingId: binding.bindingId,
    documentId: binding.documentId,
    contentKeyEpoch: bundle.contentKeyEpoch,
    targetHash: bundle.targetHash,
    targets: bundle.targets.map(toStoredTargetEnvelope),
  };
}

export function toContentKeyBundleResponse(input: {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly BlobContentKeyTargetEnvelope[];
}): BlobContentKeyBundleResponse {
  return {
    blobId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash: input.targetHash,
    targets: input.targets.map((target) => ({
      bindingId: target.bindingId,
      documentId: target.documentId,
      containerId: target.containerId,
      containerManifestHash: target.containerManifestHash,
      containerKeyEpochId: target.containerKeyEpochId,
      containerKeyEpoch: target.containerKeyEpoch,
      wrappedKey: target.wrappedKey,
      wrappingMetadata: contentKeyWrappingMetadataRecord(
        target.wrappingMetadata,
        "Blob content-key target wrapping metadata",
      ),
    })),
  };
}

function blobKekTargetsProjection(input: ResolvedBlobKekTargets) {
  return {
    blobId: input.blobId,
    organizationId: input.organizationId,
    activeBindingIds: [...input.activeBindingIds],
    documentManifestHashes: [...input.documentManifestHashes],
    linkedContainerManifestHashes: [...input.linkedContainerManifestHashes],
    linkedContainerKeyEpochIds: [...input.linkedContainerKeyEpochIds],
    targets: input.targets.map((target) => ({ ...target })),
    blobKeyTargetHash: input.blobKeyTargetHash,
    blobAccessManifestHash: input.blobAccessManifestHash,
  };
}

export function toBlobKekTargetsResponse(
  input: ResolvedBlobKekTargets,
): BlobKekTargetsResponse {
  return blobKekTargetsProjection(input);
}

export function toBlobWriteAuthorization(
  input: ResolvedBlobKekTargets,
): BlobWriteAuthorization {
  return blobKekTargetsProjection(input);
}

export function toBindResponse(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly blobId: string;
  readonly contentKeyBundle: StoredBlobContentKeyBundleWithTargets;
  readonly currentTargets: ResolvedBlobKekTargets;
  readonly writeHeaderHash: string;
}): BlobAttachmentBindResponse {
  return {
    bindingId: input.binding.bindingId,
    blobId: input.blobId,
    blobKekTargets: toBlobKekTargetsResponse(input.currentTargets),
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId: input.binding.documentId,
    documentManifestHash: input.binding.documentManifestHash,
    eventHash: input.binding.event.eventHash,
    previousBindingId: input.binding.body.expectedBindingId,
    slotId: input.binding.slotId,
    writeHeaderHash: input.writeHeaderHash,
  };
}
