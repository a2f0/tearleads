import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifest,
  ContainerGrantPrincipalHead,
  KeyingVerificationError,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  WriteHeader,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  makeVerifiedAccessEvent,
} from "@tearleads/crypto";
import type { AccessEventBundleWireResponse } from "@tearleads/validators/util";
import { z } from "zod";
import { projectionReferencedPrincipalHeadRecord } from "./keyingProjectionManifestRecords";
import {
  type ProjectionErrorFactory,
  parseProjection,
  projectionCanonicalJson,
  projectionIssue,
  projectionNullableString,
  projectionPositiveInteger,
  projectionRecord,
  projectionString,
  projectionStringArray,
  projectionVersion,
} from "./keyingProjectionSchemas";

export {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  documentLinkSetStateRecord,
  projectionReferencedPrincipalHeadRecord,
} from "./keyingProjectionManifestRecords";

/**
 * Maps a KeyingVerificationError to the HTTP status shared by the container,
 * document, and blob mutation boundaries: bad signatures and authorization
 * failures are 403, malformed shapes 400, and everything else (stale state,
 * epoch races) a retriable 409.
 */
export function keyingVerificationHttpStatus(
  error: KeyingVerificationError,
): 400 | 403 | 409 {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (
    error.code === "invalid_domain" ||
    error.code === "invalid_shape" ||
    error.code === "object_mismatch"
  ) {
    return 400;
  }

  return 409;
}

export const projectionAccessEventTypeSchema = z.enum([
  "attachment.bind",
  "attachment.detach",
  "container.create",
  "container.grant",
  "container.move",
  "container.rekey",
  "container.recite",
  "container.revoke",
  "document.link",
  "document.purge",
  "document.unlink",
]);

const accessObjectKindSchema = z.enum(["blob", "container", "document"]);

const projectionAccessEventSchema = projectionRecord(
  {
    version: projectionVersion,
    eventId: projectionString,
    eventType: projectionAccessEventTypeSchema,
    objectKind: accessObjectKindSchema,
    objectId: projectionString,
    organizationId: projectionString,
    previousManifestHash: projectionNullableString,
    dependencyManifestHashes: projectionStringArray,
    bodyHash: projectionString,
    signerUserId: projectionString,
    signerDeviceId: projectionString,
    signerKeyFingerprint: projectionString,
    signedAt: projectionString,
    signature: projectionString,
  },
  ["eventType", "objectKind", "version"],
);

export function readProjectionAccessEvent(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): AccessEvent {
  return parseProjection(projectionAccessEventSchema, value, label, error);
}

/** A stored `{ event, body, eventHash }` bundle; `body` stays the original. */
const projectionVerifiedAccessEventSchema = projectionRecord({
  event: projectionAccessEventSchema,
  body: projectionCanonicalJson,
  eventHash: projectionString,
});

export function readProjectionVerifiedAccessEvent(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): VerifiedAccessEvent {
  return makeVerifiedAccessEvent(
    parseProjection(projectionVerifiedAccessEventSchema, value, label, error),
  );
}

const projectionReferencedPrincipalHeadSchema = projectionRecord({
  principalType: z.enum(["group", "organization"]),
  principalId: projectionString,
  version: projectionPositiveInteger,
  keyEpoch: projectionPositiveInteger,
  stateHash: projectionString,
  keyFingerprint: projectionString,
});

function referencesOnlyGroups(
  principalHeads: readonly ReferencedPrincipalHead[],
): boolean {
  return principalHeads.every(
    (principalHead) => principalHead.principalType === "group",
  );
}

/** Heads a container may cite: well formed, then group principals only. */
export const projectionContainerGrantPrincipalHeadsSchema = z
  .array(projectionReferencedPrincipalHeadSchema)
  .pipe(
    z
      .custom<ContainerGrantPrincipalHead[]>()
      .refine(
        referencesOnlyGroups,
        projectionIssue("may reference only group principals"),
      ),
  );

const projectionAccessManifestSchema = projectionRecord(
  {
    version: projectionVersion,
    objectKind: accessObjectKindSchema,
    objectId: projectionString,
    organizationId: projectionString,
    epoch: projectionPositiveInteger,
    previousManifestHash: projectionNullableString,
    eventHash: projectionString,
    structuralHash: projectionString,
    grantRoot: projectionString,
    referencedPrincipalHeads: z.array(projectionReferencedPrincipalHeadSchema),
    keyTargetHash: projectionString,
  },
  ["objectKind", "version"],
);

export function readProjectionAccessManifest(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): AccessManifest {
  return parseProjection(projectionAccessManifestSchema, value, label, error);
}

function hasContainerObjectKind(manifest: AccessManifest): boolean {
  return manifest.objectKind === "container";
}

function containerManifestReferencesOnlyGroups(
  manifest: AccessManifest,
): boolean {
  return referencesOnlyGroups(manifest.referencedPrincipalHeads);
}

/** A well-formed manifest, then a container's, then group heads only. */
export const projectionContainerAccessManifestSchema =
  projectionAccessManifestSchema
    .pipe(
      z.custom<AccessManifest>().refine(hasContainerObjectKind, {
        path: ["objectKind"],
        ...projectionIssue("must be container"),
      }),
    )
    .pipe(
      z
        .custom<ContainerAccessManifest>()
        .refine(containerManifestReferencesOnlyGroups, {
          path: ["referencedPrincipalHeads"],
          ...projectionIssue("may reference only group principals"),
        }),
    );

/** A blob or document content write header, signed by its writer. */
const projectionWriteHeaderSchema = projectionRecord(
  {
    version: projectionVersion,
    dependencyManifestHashes: projectionStringArray,
    organizationId: projectionString,
    objectKind: z.enum(["blob", "document"]),
    objectId: projectionString,
    accessManifestHash: projectionString,
    contentKeyEpoch: projectionPositiveInteger,
    targetHash: projectionString,
    encryptionSuite: z.literal(CONTENT_RECORD_ENCRYPTION_SUITE),
    contentRecordId: projectionString,
    nonceDomainHash: projectionString,
    metadataHash: projectionString,
    ciphertextHash: projectionString,
    writerUserId: projectionString,
    writerDeviceId: projectionString,
    writerKeyFingerprint: projectionString,
    signedAt: projectionString,
    signature: projectionString,
  },
  ["objectKind", "encryptionSuite", "version"],
);

export function readProjectionWriteHeader(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): WriteHeader {
  return parseProjection(projectionWriteHeaderSchema, value, label, error);
}

function accessEventRecord(event: AccessEvent): Record<string, unknown> {
  return {
    version: event.version,
    eventId: event.eventId,
    eventType: event.eventType,
    objectKind: event.objectKind,
    objectId: event.objectId,
    organizationId: event.organizationId,
    previousManifestHash: event.previousManifestHash,
    dependencyManifestHashes: [...event.dependencyManifestHashes],
    bodyHash: event.bodyHash,
    signerUserId: event.signerUserId,
    signerDeviceId: event.signerDeviceId,
    signerKeyFingerprint: event.signerKeyFingerprint,
    signedAt: event.signedAt,
    signature: event.signature,
  };
}

export function projectionVerifiedAccessEventRecord(
  event: VerifiedAccessEvent,
): AccessEventBundleWireResponse {
  return {
    event: accessEventRecord(event.event),
    body: event.body,
    eventHash: event.eventHash,
  };
}

export function projectionAccessManifestRecord(
  manifest: AccessManifest,
): Record<string, unknown> {
  return {
    version: manifest.version,
    objectKind: manifest.objectKind,
    objectId: manifest.objectId,
    organizationId: manifest.organizationId,
    epoch: manifest.epoch,
    previousManifestHash: manifest.previousManifestHash,
    eventHash: manifest.eventHash,
    structuralHash: manifest.structuralHash,
    grantRoot: manifest.grantRoot,
    referencedPrincipalHeads: manifest.referencedPrincipalHeads.map(
      projectionReferencedPrincipalHeadRecord,
    ),
    keyTargetHash: manifest.keyTargetHash,
  };
}
