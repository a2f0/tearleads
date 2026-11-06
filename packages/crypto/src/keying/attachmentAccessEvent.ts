import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { verifySignedAccessEvent } from "./accessEvent";
import type {
  VerifiedAccessEvent,
  VerifyAccessEventInput,
} from "./accessEventTypes";
import type {
  AttachmentAccessEventBody,
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
  VerifyAttachmentBindingEventInput,
  VerifyAttachmentDetachEventInput,
} from "./attachmentAccessTypes";
import {
  makeVerifiedAttachmentBinding,
  makeVerifiedAttachmentDetach,
} from "./attachmentAccessTypes";
import type {
  KeyingCanonicalJson,
  KeyingCanonicalPayload,
} from "./canonicalJsonTypes";
import {
  assertAttachmentDocumentAuthority,
  requireEventDependency,
} from "./documentAccessAuthorization";
import {
  assertExactKeys,
  readHashString,
  readNullableString,
  readString,
  runVerifier,
  throwVerification,
} from "./shared";
import type { KeyingVerificationResult } from "./verificationError";

function normalizeAttachmentBindAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentBindAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "blobId",
      "documentId",
      "documentManifestHash",
      "eventType",
      "expectedBindingId",
      "slotId",
    ],
    "attachment.bind event body",
  );

  return {
    eventType: "attachment.bind",
    bindingId: readString(record, "bindingId", "attachment.bind event body"),
    blobId: readString(record, "blobId", "attachment.bind event body"),
    documentId: readString(record, "documentId", "attachment.bind event body"),
    slotId: readString(record, "slotId", "attachment.bind event body"),
    expectedBindingId: readNullableString(
      record,
      "expectedBindingId",
      "attachment.bind event body",
    ),
    documentManifestHash: readHashString(
      record,
      "documentManifestHash",
      "attachment.bind event body",
    ),
  };
}

function normalizeAttachmentDetachAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentDetachAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "blobId",
      "documentId",
      "documentManifestHash",
      "eventType",
      "slotId",
    ],
    "attachment.detach event body",
  );

  return {
    eventType: "attachment.detach",
    bindingId: readString(record, "bindingId", "attachment.detach event body"),
    blobId: readString(record, "blobId", "attachment.detach event body"),
    documentId: readString(
      record,
      "documentId",
      "attachment.detach event body",
    ),
    slotId: readString(record, "slotId", "attachment.detach event body"),
    documentManifestHash: readHashString(
      record,
      "documentManifestHash",
      "attachment.detach event body",
    ),
  };
}

export function normalizeAttachmentAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "attachment access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "attachment access body");

  if (eventType === "attachment.bind") {
    return normalizeAttachmentBindAccessEventBody(value);
  }

  if (eventType === "attachment.detach") {
    return normalizeAttachmentDetachAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "attachment access event body eventType is unsupported",
  );
}

function assertAttachmentAccessEventDomain(input: {
  readonly body: AttachmentAccessEventBody;
  readonly event: VerifiedAccessEvent;
}): void {
  const { body, event } = input;

  if (event.event.objectKind !== "blob") {
    throwVerification(
      "object_mismatch",
      "attachment access event must target a blob",
    );
  }

  if (event.event.objectId !== body.blobId) {
    throwVerification(
      "object_mismatch",
      "attachment access event blob id does not match body",
    );
  }

  if (event.event.eventType !== body.eventType) {
    throwVerification(
      "invalid_domain",
      "attachment access event body type does not match event type",
    );
  }

  requireEventDependency({
    event,
    manifestHash: body.documentManifestHash,
    label: "attachment access event document link-set",
  });
}

function assertExpectedAttachmentEventFields(input: {
  readonly body: AttachmentAccessEventBody;
  readonly expectedBindingId?: string | undefined;
  readonly expectedBlobId?: string | undefined;
  readonly expectedDocumentId?: string | undefined;
  readonly expectedDocumentManifestHash?: string | undefined;
}): void {
  if (
    input.expectedBindingId !== undefined &&
    input.body.bindingId !== input.expectedBindingId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event binding id does not match expected binding id",
    );
  }

  if (
    input.expectedBlobId !== undefined &&
    input.body.blobId !== input.expectedBlobId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event blob id does not match expected blob id",
    );
  }

  if (
    input.expectedDocumentId !== undefined &&
    input.body.documentId !== input.expectedDocumentId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event document id does not match expected document id",
    );
  }

  if (
    input.expectedDocumentManifestHash !== undefined &&
    input.body.documentManifestHash !== input.expectedDocumentManifestHash
  ) {
    throwVerification(
      "stale_predecessor",
      "attachment event document manifest hash does not match expected manifest",
    );
  }
}

async function verifyAttachmentAccessEvent(
  input: VerifyAccessEventInput,
): Promise<{
  readonly body: AttachmentAccessEventBody;
  readonly event: VerifiedAccessEvent;
}> {
  const body = normalizeAttachmentAccessEventBody(input.body);
  const canonicalBody: KeyingCanonicalPayload<AttachmentAccessEventBody> = body;
  const event = await verifySignedAccessEvent({
    body: canonicalBody,
    event: input.event,
    signerPublicKey: input.signerPublicKey,
  });

  if (!event.ok) {
    throw event.error;
  }

  assertAttachmentAccessEventDomain({ body, event: event.value });
  return { body, event: event.value };
}

export async function verifyAttachmentBindingEvent({
  authorizationMembership = "current",
  authorizingContainerPaths,
  documentManifest,
  expectedBindingId,
  expectedBlobId,
  expectedDocumentId,
  expectedDocumentManifestHash,
  expectedPreviousBindingId,
  principalPolicies = [],
  ...input
}: VerifyAttachmentBindingEventInput): Promise<
  KeyingVerificationResult<VerifiedAttachmentBinding>
> {
  return runVerifier(async () => {
    const { body, event } = await verifyAttachmentAccessEvent(input);

    if (body.eventType !== "attachment.bind") {
      throwVerification(
        "invalid_domain",
        "attachment binding verifier requires an attachment.bind event",
      );
    }

    assertExpectedAttachmentEventFields({
      body,
      expectedBindingId,
      expectedBlobId,
      expectedDocumentId,
      expectedDocumentManifestHash,
    });
    if (
      expectedPreviousBindingId !== undefined &&
      body.expectedBindingId !== expectedPreviousBindingId
    ) {
      throwVerification(
        "stale_predecessor",
        "attachment binding previous binding id does not match expected binding id",
      );
    }
    assertAttachmentDocumentAuthority({
      authorizationMembership,
      authorizingContainerPaths,
      body,
      documentManifest,
      event,
      principalPolicies,
    });

    return makeVerifiedAttachmentBinding({
      bindingId: body.bindingId,
      blobId: body.blobId,
      documentId: body.documentId,
      slotId: body.slotId,
      documentManifestHash: body.documentManifestHash,
      event,
      body,
    });
  });
}

export async function verifyAttachmentDetachEvent({
  authorizationMembership = "current",
  authorizingContainerPaths,
  documentManifest,
  expectedBindingId,
  expectedBlobId,
  expectedDocumentId,
  expectedDocumentManifestHash,
  principalPolicies = [],
  ...input
}: VerifyAttachmentDetachEventInput): Promise<
  KeyingVerificationResult<VerifiedAttachmentDetach>
> {
  return runVerifier(async () => {
    const { body, event } = await verifyAttachmentAccessEvent(input);

    if (body.eventType !== "attachment.detach") {
      throwVerification(
        "invalid_domain",
        "attachment detach verifier requires an attachment.detach event",
      );
    }

    assertExpectedAttachmentEventFields({
      body,
      expectedBindingId,
      expectedBlobId,
      expectedDocumentId,
      expectedDocumentManifestHash,
    });
    assertAttachmentDocumentAuthority({
      authorizationMembership,
      authorizingContainerPaths,
      body,
      documentManifest,
      event,
      principalPolicies,
    });

    return makeVerifiedAttachmentDetach({
      bindingId: body.bindingId,
      blobId: body.blobId,
      documentId: body.documentId,
      slotId: body.slotId,
      documentManifestHash: body.documentManifestHash,
      event,
      body,
    });
  });
}
