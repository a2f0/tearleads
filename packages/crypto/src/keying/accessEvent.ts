import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { toFingerprint } from "../fingerprint";
import { sign } from "../signing/sign";
import { verify } from "../signing/verify";
import {
  computeKeyingDomainHash,
  encodeDomainPayload,
  normalizeCanonicalJsonValue,
} from "./canonical";
import {
  accessManifestCheckpointFromManifest,
  verifyAccessManifestLocalCheckpoint,
} from "./checkpoints";
import {
  assertExactKeys,
  compareCanonicalStrings,
  expectedObjectKindForEventType,
  normalizeAccessEventType,
  normalizeAccessObjectKind,
  normalizeManagedPrincipalKind,
  normalizeUniqueSortedStrings,
  readHashString,
  readNullableHashString,
  readPositiveInteger,
  readSignedAt,
  readString,
  readStringArray,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  AccessEvent,
  AccessManifest,
  KeyingCanonicalJson,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  ReferencedPrincipalHead,
  UnsignedAccessEvent,
  VerifiedAccessEvent,
  VerifiedAccessManifest,
  VerifyAccessEventInput,
  VerifyAccessManifestInput,
} from "./types";
import { makeVerifiedAccessEvent, makeVerifiedAccessManifest } from "./types";

function normalizeUnsignedAccessEvent(value: unknown): UnsignedAccessEvent {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const eventType = normalizeAccessEventType(record.eventType, "access event");
  const objectKind = normalizeAccessObjectKind(
    record.objectKind,
    "access event",
  );
  const expectedObjectKind = expectedObjectKindForEventType(eventType);

  if (objectKind !== expectedObjectKind) {
    throwVerification(
      "object_mismatch",
      `access event ${eventType} must use objectKind ${expectedObjectKind}`,
    );
  }

  return {
    version: readVersion(record, "access event"),
    eventId: readString(record, "eventId", "access event"),
    eventType,
    objectKind,
    objectId: readString(record, "objectId", "access event"),
    organizationId: readString(record, "organizationId", "access event"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access event",
    ),
    dependencyManifestHashes: normalizeUniqueSortedStrings(
      readStringArray(record, "dependencyManifestHashes", "access event"),
      "access event dependencyManifestHashes",
    ),
    bodyHash: readHashString(record, "bodyHash", "access event"),
    signerUserId: readString(record, "signerUserId", "access event"),
    signerDeviceId: readString(record, "signerDeviceId", "access event"),
    signerKeyFingerprint: readHashString(
      record,
      "signerKeyFingerprint",
      "access event",
    ),
    signedAt: readSignedAt(record, "signedAt", "access event"),
  };
}

function normalizeAccessEvent(value: unknown): AccessEvent {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signature",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const unsignedEvent = normalizeUnsignedAccessEvent({
    version: record.version,
    eventId: record.eventId,
    eventType: record.eventType,
    objectKind: record.objectKind,
    objectId: record.objectId,
    organizationId: record.organizationId,
    previousManifestHash: record.previousManifestHash,
    dependencyManifestHashes: record.dependencyManifestHashes,
    bodyHash: record.bodyHash,
    signerUserId: record.signerUserId,
    signerDeviceId: record.signerDeviceId,
    signerKeyFingerprint: record.signerKeyFingerprint,
    signedAt: record.signedAt,
  });

  return {
    ...unsignedEvent,
    signature: readString(record, "signature", "access event"),
  };
}

function unsignedAccessEventPayload(
  event: UnsignedAccessEvent,
): KeyingCanonicalPayload<UnsignedAccessEvent> {
  return normalizeUnsignedAccessEvent(event);
}

function accessEventSigningBytes(event: UnsignedAccessEvent): Uint8Array {
  return encodeDomainPayload(
    "symcrypt.keying.access-event-signing",
    unsignedAccessEventPayload(event),
  );
}

function toUnsignedAccessEvent(event: AccessEvent): UnsignedAccessEvent {
  return {
    version: event.version,
    eventId: event.eventId,
    eventType: event.eventType,
    objectKind: event.objectKind,
    objectId: event.objectId,
    organizationId: event.organizationId,
    previousManifestHash: event.previousManifestHash,
    dependencyManifestHashes: event.dependencyManifestHashes,
    bodyHash: event.bodyHash,
    signerUserId: event.signerUserId,
    signerDeviceId: event.signerDeviceId,
    signerKeyFingerprint: event.signerKeyFingerprint,
    signedAt: event.signedAt,
  };
}

export async function computeAccessEventBodyHash(
  body: KeyingCanonicalJson,
): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.access-event-body", body);
}

export async function signAccessEvent(
  event: UnsignedAccessEvent,
  signingPrivateKey: Uint8Array,
): Promise<AccessEvent> {
  const normalizedEvent = normalizeUnsignedAccessEvent(event);
  const signature = sign(
    accessEventSigningBytes(normalizedEvent),
    signingPrivateKey,
  );

  return {
    ...normalizedEvent,
    signature: bytesToBase64(signature),
  };
}

export async function computeAccessEventHash(
  event: AccessEvent,
): Promise<string> {
  const payload: KeyingCanonicalPayload<AccessEvent> =
    normalizeAccessEvent(event);

  return computeKeyingDomainHash("symcrypt.keying.access-event", payload);
}

export async function verifySignedAccessEvent({
  body,
  event,
  signerPublicKey,
}: VerifyAccessEventInput): Promise<
  KeyingVerificationResult<VerifiedAccessEvent>
> {
  return runVerifier(async () => {
    const normalizedBody = normalizeCanonicalJsonValue(
      body,
      "access event body",
    );
    const normalizedEvent = normalizeAccessEvent(event);
    const computedBodyHash = await computeAccessEventBodyHash(normalizedBody);

    if (computedBodyHash !== normalizedEvent.bodyHash) {
      throwVerification(
        "hash_mismatch",
        "access event body hash does not match body",
      );
    }

    const signerKeyFingerprint = await toFingerprint(signerPublicKey);
    if (signerKeyFingerprint !== normalizedEvent.signerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "access event signer fingerprint does not match signer public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedEvent.signature);
    } catch {
      throwVerification("signature_mismatch", "access event signature invalid");
    }

    if (
      !verify(
        signature,
        accessEventSigningBytes(toUnsignedAccessEvent(normalizedEvent)),
        signerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "access event signature verification failed",
      );
    }

    return makeVerifiedAccessEvent({
      event: normalizedEvent,
      body: normalizedBody,
      eventHash: await computeAccessEventHash(normalizedEvent),
    });
  });
}

export function normalizeReferencedPrincipalHead(
  value: unknown,
): ReferencedPrincipalHead {
  const record = assertExactKeys(
    value,
    [
      "keyEpoch",
      "keyFingerprint",
      "principalId",
      "principalType",
      "stateHash",
      "version",
    ],
    "referenced principal head",
  );

  return {
    principalType: normalizeManagedPrincipalKind(
      record.principalType,
      "referenced principal head",
    ),
    principalId: readString(record, "principalId", "referenced principal head"),
    version: readPositiveInteger(
      record,
      "version",
      "referenced principal head",
    ),
    keyEpoch: readPositiveInteger(
      record,
      "keyEpoch",
      "referenced principal head",
    ),
    stateHash: readHashString(record, "stateHash", "referenced principal head"),
    keyFingerprint: readHashString(
      record,
      "keyFingerprint",
      "referenced principal head",
    ),
  };
}

export function referencedPrincipalKey(
  principal: ReferencedPrincipalHead,
): string {
  return `${principal.principalType}:${principal.principalId}`;
}

export function normalizeReferencedPrincipalHeads(
  values: readonly unknown[],
): ReferencedPrincipalHead[] {
  const normalizedValues = values
    .map(normalizeReferencedPrincipalHead)
    .sort((left, right) =>
      compareCanonicalStrings(
        referencedPrincipalKey(left),
        referencedPrincipalKey(right),
      ),
    );

  let previousKey: string | null = null;
  for (const principalHead of normalizedValues) {
    const principalKey = referencedPrincipalKey(principalHead);
    if (previousKey === principalKey) {
      throwVerification(
        "duplicate_entry",
        "access manifest referencedPrincipalHeads contains a duplicate",
      );
    }
    previousKey = principalKey;
  }

  return normalizedValues;
}

function normalizeAccessManifest(value: unknown): AccessManifest {
  const record = assertExactKeys(
    value,
    [
      "epoch",
      "eventHash",
      "grantRoot",
      "keyTargetHash",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "structuralHash",
      "version",
    ],
    "access manifest",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "access manifest.referencedPrincipalHeads must be an array",
    );
  }

  return {
    version: readVersion(record, "access manifest"),
    objectKind: normalizeAccessObjectKind(record.objectKind, "access manifest"),
    objectId: readString(record, "objectId", "access manifest"),
    organizationId: readString(record, "organizationId", "access manifest"),
    epoch: readPositiveInteger(record, "epoch", "access manifest"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access manifest",
    ),
    eventHash: readHashString(record, "eventHash", "access manifest"),
    structuralHash: readHashString(record, "structuralHash", "access manifest"),
    grantRoot: readHashString(record, "grantRoot", "access manifest"),
    referencedPrincipalHeads: normalizeReferencedPrincipalHeads(
      referencedPrincipalHeads,
    ),
    keyTargetHash: readHashString(record, "keyTargetHash", "access manifest"),
  };
}

export async function computeAccessManifestHash(
  manifest: AccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<AccessManifest> =
    normalizeAccessManifest(manifest);

  return computeKeyingDomainHash("symcrypt.keying.access-manifest", payload);
}

export async function verifyAccessManifest({
  checkpointPredecessors,
  event,
  expectedManifestHash,
  expectedObject,
  expectedPreviousManifestHash,
  localCheckpoint,
  manifest,
}: VerifyAccessManifestInput): Promise<
  KeyingVerificationResult<VerifiedAccessManifest>
> {
  return runVerifier(async () => {
    const normalizedManifest = normalizeAccessManifest(manifest);
    const manifestHash = await computeAccessManifestHash(normalizedManifest);

    if (manifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest hash does not match expected hash",
      );
    }

    if (event.eventHash !== normalizedManifest.eventHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest event hash does not match verified event",
      );
    }

    if (
      event.event.objectKind !== normalizedManifest.objectKind ||
      event.event.objectId !== normalizedManifest.objectId ||
      event.event.organizationId !== normalizedManifest.organizationId
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match verified event",
      );
    }

    if (
      event.event.previousManifestHash !==
      normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match verified event",
      );
    }

    if (
      expectedPreviousManifestHash !== undefined &&
      expectedPreviousManifestHash !== normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match expected predecessor",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedManifest.objectKind ||
        expectedObject.objectId !== normalizedManifest.objectId)
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match expected object",
      );
    }

    const checkpoint = accessManifestCheckpointFromManifest({
      manifest: normalizedManifest,
      manifestHash,
    });
    verifyAccessManifestLocalCheckpoint({
      current: {
        ...checkpoint,
        previousManifestHash: normalizedManifest.previousManifestHash,
      },
      localCheckpoint,
      checkpointPredecessors,
    });

    return makeVerifiedAccessManifest({
      manifest: normalizedManifest,
      manifestHash,
      event,
      checkpoint,
    });
  });
}
