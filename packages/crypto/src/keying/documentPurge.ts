import {
  containerAccessLevelRank,
  requireContainerPathLast,
  resolveHistoricalContainerPathUserAccessLevel,
} from "./containerAccess";
import {
  assertExactKeys,
  readHashString,
  readString,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  KeyingCanonicalJson,
  KeyingVerificationResult,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "./types";

export interface DocumentPurgeAccessEventBody {
  eventType: "document.purge";
  containerId: string;
  containerManifestHash: string;
  documentManifestHash: string;
}

export interface VerifyDocumentPurgeEventInput {
  readonly event: VerifiedAccessEvent;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly expectedDocumentId?: string;
}

export function normalizeDocumentPurgeAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentPurgeAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerManifestHash",
      "documentManifestHash",
      "eventType",
    ],
    "document.purge event body",
  );
  if (record.eventType !== "document.purge") {
    throwVerification(
      "invalid_domain",
      "document purge event body must use document.purge",
    );
  }
  return {
    containerId: readString(record, "containerId", "document.purge event body"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.purge event body",
    ),
    documentManifestHash: readHashString(
      record,
      "documentManifestHash",
      "document.purge event body",
    ),
    eventType: "document.purge",
  };
}

function assertPurgeEventIdentity(
  input: VerifyDocumentPurgeEventInput,
  body: DocumentPurgeAccessEventBody,
): void {
  const event = input.event.event;
  const documentState = input.documentManifest.state;
  if (event.eventType !== "document.purge" || event.objectKind !== "document") {
    throwVerification(
      "invalid_domain",
      "document purge event must target a document",
    );
  }
  if (
    input.expectedDocumentId !== undefined &&
    event.objectId !== input.expectedDocumentId
  ) {
    throwVerification(
      "object_mismatch",
      "document purge event targets the wrong document",
    );
  }
  if (
    event.objectId !== documentState.documentId ||
    event.organizationId !== documentState.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document purge event does not match the document manifest",
    );
  }
  if (
    event.previousManifestHash !== input.documentManifest.manifestHash ||
    body.documentManifestHash !== input.documentManifest.manifestHash
  ) {
    throwVerification(
      "stale_predecessor",
      "document purge event does not bind the supplied document head",
    );
  }
}

function assertPurgeDependencies(
  input: VerifyDocumentPurgeEventInput,
  body: DocumentPurgeAccessEventBody,
): void {
  const event = input.event.event;
  const linkedContainerIds = input.documentManifest.state.linkedContainerIds;
  if (
    linkedContainerIds.length !== 1 ||
    linkedContainerIds[0] !== body.containerId
  ) {
    throwVerification(
      "missing_dependency",
      "document purge requires exactly one linked container",
    );
  }
  if (
    event.dependencyManifestHashes.length !== 1 ||
    event.dependencyManifestHashes[0] !== body.containerManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      "document purge event must bind exactly its authorizing container head",
    );
  }
}

function requirePurgeAuthorization(
  input: VerifyDocumentPurgeEventInput,
  body: DocumentPurgeAccessEventBody,
): void {
  const containerManifest = requireContainerPathLast(
    input.authorizingContainerPath,
    "document.purge authorization",
  );
  if (
    containerManifest.state.containerId !== body.containerId ||
    containerManifest.manifestHash !== body.containerManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      "document.purge authorization path does not end at the signed container manifest",
    );
  }
  if (
    containerManifest.state.organizationId !==
    input.documentManifest.state.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document.purge authorization container belongs to the wrong organization",
    );
  }
  const accessLevel = resolveHistoricalContainerPathUserAccessLevel({
    path: input.authorizingContainerPath,
    principalPolicies: input.principalPolicies ?? [],
    userId: input.event.event.signerUserId,
  });
  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) < containerAccessLevelRank("write")
  ) {
    throwVerification(
      "unauthorized",
      "document.purge authorization signer lacks write access",
    );
  }
}

export async function verifyDocumentPurgeEvent(
  input: VerifyDocumentPurgeEventInput,
): Promise<KeyingVerificationResult<VerifiedAccessEvent>> {
  return runVerifier(async () => {
    const body = normalizeDocumentPurgeAccessEventBody(input.event.body);
    assertPurgeEventIdentity(input, body);
    assertPurgeDependencies(input, body);
    requirePurgeAuthorization(input, body);
    return input.event;
  });
}
