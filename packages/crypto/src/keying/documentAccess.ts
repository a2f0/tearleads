import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import {
  computeAccessManifestHash,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "./accessEvent";
import { computeKeyingDomainHash } from "./canonical";
import {
  containerAccessLevelRank,
  resolveContainerPathUserAccessLevel,
} from "./containerAccess";
import {
  requireAnyDocumentLinkedContainerWriteAccess,
  requireDocumentContainerPathWriteAccess,
  requireEventDependency,
} from "./documentAccessAuthorization";
import {
  assertExactKeys,
  normalizeUniqueSortedStrings,
  ok,
  readHashString,
  readNullableHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  readStringArray,
  readVersion,
  runVerifier,
  throwVerification,
  toVerificationResult,
} from "./shared";
import type {
  AccessManifest,
  AttachmentAccessEventBody,
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  DocumentLinkSetStructural,
  DocumentUnlinkAccessEventBody,
  KeyingCanonicalJson,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  AnyVerifiedPrincipalPolicy as Policy,
  VerifiedAccessEvent,
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerParentEdge,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  VerifiedDocumentLinkSetStateEvidence,
  VerifyAccessEventInput,
  VerifyAttachmentBindingEventInput,
  VerifyAttachmentDetachEventInput,
  VerifyContainerParentEdgeInput,
  VerifyDocumentLinkSetManifestInput,
  WriteHeader,
} from "./types";
import {
  makeVerifiedAttachmentBinding,
  makeVerifiedAttachmentDetach,
  makeVerifiedContainerParentEdge,
  makeVerifiedDocumentLinkSetManifest,
} from "./types";

export { requireEventDependency } from "./documentAccessAuthorization";

function normalizeDocumentLinkSetStructural(
  value: unknown,
): DocumentLinkSetStructural {
  const record = assertExactKeys(
    value,
    ["linkedContainerIds"],
    "document link-set structural state",
  );
  const linkedContainerIds = normalizeUniqueSortedStrings(
    readStringArray(
      record,
      "linkedContainerIds",
      "document link-set structural state",
    ),
    "document link-set linkedContainerIds",
  );

  if (linkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document link-set must include at least one linked container",
    );
  }

  return { linkedContainerIds };
}

export function normalizeDocumentLinkSetManifestState(
  value: unknown,
): DocumentLinkSetManifestState {
  const record = assertExactKeys(
    value,
    [
      "documentId",
      "epoch",
      "eventHash",
      "linkedContainerIds",
      "organizationId",
      "previousManifestHash",
      "version",
    ],
    "document link-set manifest state",
  );
  const structural = normalizeDocumentLinkSetStructural({
    linkedContainerIds: record.linkedContainerIds,
  });

  return {
    version: readVersion(record, "document link-set manifest state"),
    documentId: readString(
      record,
      "documentId",
      "document link-set manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "document link-set manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "document link-set manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "document link-set manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "document link-set manifest state",
    ),
    linkedContainerIds: structural.linkedContainerIds,
  };
}

export async function computeDocumentLinkSetStructuralHash(
  structural: DocumentLinkSetStructural,
): Promise<string> {
  const payload: KeyingCanonicalPayload<DocumentLinkSetStructural> =
    normalizeDocumentLinkSetStructural(structural);

  return computeKeyingDomainHash(
    "symcrypt.keying.document-link-set-structural",
    payload,
  );
}

export async function computeDocumentLinkSetGrantRoot(): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.document-link-set-grants", {
    grants: [],
  });
}

export async function computeDocumentLinkSetKeyTargetHash(): Promise<string> {
  return computeKeyingDomainHash(
    "symcrypt.keying.document-link-set-key-target",
    { targetMode: "current-linked-container-keks" },
  );
}

export async function deriveDocumentLinkSetManifest(
  state: DocumentLinkSetManifestState,
): Promise<AccessManifest> {
  const normalizedState = normalizeDocumentLinkSetManifestState(state);

  return {
    version: 1,
    objectKind: "document",
    objectId: normalizedState.documentId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeDocumentLinkSetStructuralHash({
      linkedContainerIds: normalizedState.linkedContainerIds,
    }),
    grantRoot: await computeDocumentLinkSetGrantRoot(),
    referencedPrincipalHeads: [],
    keyTargetHash: await computeDocumentLinkSetKeyTargetHash(),
  };
}

function normalizeDocumentLinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentLinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.link event body",
  );

  return {
    eventType: "document.link",
    containerId: readString(record, "containerId", "document.link event body"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.link event body",
    ),
  };
}

function normalizeDocumentUnlinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentUnlinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.unlink event body",
  );

  return {
    eventType: "document.unlink",
    containerId: readString(
      record,
      "containerId",
      "document.unlink event body",
    ),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.unlink event body",
    ),
  };
}

export function normalizeDocumentAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "document access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "document access body");

  if (eventType === "document.link") {
    return normalizeDocumentLinkAccessEventBody(value);
  }

  if (eventType === "document.unlink") {
    return normalizeDocumentUnlinkAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "document access event body eventType is unsupported",
  );
}

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

function assertAttachmentDocumentAuthority(input: {
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly body: AttachmentAccessEventBody;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly event: VerifiedAccessEvent;
  readonly principalPolicies: readonly Policy[];
}): void {
  if (
    input.body.documentId !== input.documentManifest.state.documentId ||
    input.body.documentManifestHash !== input.documentManifest.manifestHash
  ) {
    throwVerification(
      "stale_predecessor",
      "attachment event document manifest does not match body",
    );
  }

  if (
    input.event.event.organizationId !==
    input.documentManifest.state.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event organization does not match document manifest",
    );
  }

  requireAnyDocumentLinkedContainerWriteAccess({
    authorizationMembership: "current",
    event: input.event,
    label: input.body.eventType,
    linkedContainerIds: input.documentManifest.state.linkedContainerIds,
    organizationId: input.documentManifest.state.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
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

export function requireWriteAccessThroughCommittedDocumentTarget(input: {
  readonly documentKekTargets: VerifiedDocumentKekTargets;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly Policy[];
  readonly userId: string;
}): void {
  const targetHashByContainerId = new Map(
    input.documentKekTargets.targets.map((target) => [
      target.containerId,
      target.containerManifestHash,
    ]),
  );
  const linkedContainerIds = new Set(
    input.documentManifest.state.linkedContainerIds,
  );

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !==
        input.documentManifest.state.organizationId ||
      targetHashByContainerId.get(manifest.state.containerId) !==
        manifest.manifestHash
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.userId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed linked container target`,
  );
}

export function requireWriteAccessThroughCommittedBlobTarget(input: {
  readonly blobKekTargets: VerifiedBlobKekTargets;
  readonly header: WriteHeader;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly Policy[];
}): void {
  const targetManifestHashesByContainerId = new Map<string, Set<string>>();

  for (const target of input.blobKekTargets.targets) {
    const manifestHashes =
      targetManifestHashesByContainerId.get(target.containerId) ?? new Set();
    manifestHashes.add(target.containerManifestHash);
    targetManifestHashesByContainerId.set(target.containerId, manifestHashes);
  }

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      manifest.state.organizationId !== input.header.organizationId ||
      !targetManifestHashesByContainerId
        .get(manifest.state.containerId)
        ?.has(manifest.manifestHash)
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.header.writerUserId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed blob target`,
  );
}
type DocumentLinkSetManifestDerivationInput = {
  readonly authorizationMembership: "current" | "referenced";
  readonly body: DocumentAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedDocumentLinkSetStateEvidence | null;
  readonly targetContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly Policy[];
};

interface PreviousDocumentLinkSetTransition {
  readonly nextBase: Omit<DocumentLinkSetManifestState, "linkedContainerIds">;
  readonly previousState: DocumentLinkSetManifestState;
}

function assertDocumentAccessEventDomain(
  input: DocumentLinkSetManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document access event must target a document",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "document access event body type does not match event type",
    );
  }
}

function preparePreviousDocumentLinkSetTransition(
  input: DocumentLinkSetManifestDerivationInput,
): PreviousDocumentLinkSetTransition {
  const { event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${input.body.eventType} requires the previous document link-set manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document access event previous manifest does not match supplied previous manifest",
    );
  }

  if (
    previousManifest.state.documentId !== event.event.objectId ||
    previousManifest.state.organizationId !== event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document access previous manifest targets the wrong document",
    );
  }

  return {
    previousState: previousManifest.state,
    nextBase: {
      version: 1,
      documentId: previousManifest.state.documentId,
      organizationId: previousManifest.state.organizationId,
      epoch: previousManifest.state.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
    },
  };
}

function deriveInitialDocumentLinkSetManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
): DocumentLinkSetManifestState {
  if (input.event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial document.link must not have a previous manifest",
    );
  }

  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: input.event.event.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    version: 1,
    documentId: input.event.event.objectId,
    organizationId: input.event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [body.containerId],
  });
}

function deriveDocumentLinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "duplicate_entry",
      "document.link target container is already linked",
    );
  }

  requireAnyDocumentLinkedContainerWriteAccess({
    authorizationMembership: input.authorizationMembership,
    event: input.event,
    label: "document.link existing access",
    linkedContainerIds: previous.previousState.linkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: [
      ...previous.previousState.linkedContainerIds,
      body.containerId,
    ],
  });
}

function deriveDocumentUnlinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentUnlinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (!previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "missing_dependency",
      "document.unlink target container is not linked",
    );
  }

  const remainingLinkedContainerIds =
    previous.previousState.linkedContainerIds.filter(
      (containerId) => containerId !== body.containerId,
    );

  if (remainingLinkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document.unlink must leave at least one linked container",
    );
  }

  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.unlink target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });
  requireAnyDocumentLinkedContainerWriteAccess({
    authorizationMembership: input.authorizationMembership,
    event: input.event,
    label: "document.unlink remaining access",
    linkedContainerIds: remainingLinkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: remainingLinkedContainerIds,
  });
}

function deriveDocumentLinkSetManifestStateFromEvent(
  input: DocumentLinkSetManifestDerivationInput,
): DocumentLinkSetManifestState {
  assertDocumentAccessEventDomain(input);

  if (input.body.eventType === "document.link" && !input.previousManifest) {
    return deriveInitialDocumentLinkSetManifestState(input, input.body);
  }

  const previous = preparePreviousDocumentLinkSetTransition(input);

  if (input.body.eventType === "document.link") {
    return deriveDocumentLinkManifestState(input, input.body, previous);
  }

  return deriveDocumentUnlinkManifestState(input, input.body, previous);
}

export async function verifyDocumentLinkSetManifest({
  authorizationMembership = "current",
  authorizingContainerPaths,
  checkpointPredecessors,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  previousManifest = null,
  principalPolicies = [],
  targetContainerPath,
}: VerifyDocumentLinkSetManifestInput): Promise<
  KeyingVerificationResult<VerifiedDocumentLinkSetManifest>
> {
  return runVerifier(async () => {
    const body = normalizeDocumentAccessEventBody(event.body);
    const state = deriveDocumentLinkSetManifestStateFromEvent({
      authorizationMembership,
      authorizingContainerPaths,
      body,
      event,
      previousManifest,
      principalPolicies,
      targetContainerPath,
    });
    const derivedManifest = await deriveDocumentLinkSetManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "document link-set manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "document",
        objectId: state.documentId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return makeVerifiedDocumentLinkSetManifest({
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    });
  });
}

export function verifyContainerParentEdge({
  child,
  parentHistory,
}: VerifyContainerParentEdgeInput): KeyingVerificationResult<VerifiedContainerParentEdge> {
  try {
    if (!child.state.parentContainerId || !child.state.parentManifestHash) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires a parent manifest hash",
      );
    }

    if (parentHistory.length === 0) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires parent manifest history",
      );
    }

    for (const parentManifest of parentHistory) {
      if (parentManifest.state.containerId !== child.state.parentContainerId) {
        throwVerification(
          "object_mismatch",
          "container parent edge history contains the wrong parent container",
        );
      }
    }

    if (
      !parentHistory.some(
        (parentManifest) =>
          parentManifest.manifestHash === child.state.parentManifestHash,
      )
    ) {
      throwVerification(
        "missing_dependency",
        "container parent manifest hash is not present in parent history",
      );
    }

    return ok(
      makeVerifiedContainerParentEdge({
        childContainerId: child.state.containerId,
        childManifestHash: child.manifestHash,
        parentContainerId: child.state.parentContainerId,
        parentManifestHash: child.state.parentManifestHash,
      }),
    );
  } catch (error) {
    return toVerificationResult(error);
  }
}
