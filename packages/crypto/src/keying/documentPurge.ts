import type { VerifiedDocumentLinkSetSnapshot } from "./accessManifestSnapshot";
import {
  containerAccessLevelRank,
  requireContainerPathLast,
  resolveHistoricalContainerPathUserAccessLevel,
} from "./containerAccess";
import {
  assertExactKeys,
  readHashArray,
  readHashString,
  readString,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  AnyVerifiedPrincipalPolicy,
  KeyingCanonicalJson,
  KeyingVerificationResult,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "./types";

export interface DocumentPurgeAccessEventBody {
  eventType: "document.purge";
  authorizingContainerManifestHashes: string[];
  containerId: string;
  containerManifestHash: string;
  documentManifestHash: string;
}

export interface VerifyDocumentPurgeEventInput {
  readonly event: VerifiedAccessEvent;
  readonly documentManifest:
    | VerifiedDocumentLinkSetManifest
    | VerifiedDocumentLinkSetSnapshot;
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly AnyVerifiedPrincipalPolicy[];
  readonly expectedDocumentId?: string;
}

export function normalizeDocumentPurgeAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentPurgeAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "authorizingContainerManifestHashes",
      "containerId",
      "containerManifestHash",
      "documentManifestHash",
      "eventType",
    ],
    "document.purge event body",
  );
  const authorizingContainerManifestHashes = readHashArray(
    record.authorizingContainerManifestHashes,
    "document.purge event body.authorizingContainerManifestHashes",
  );
  if (authorizingContainerManifestHashes.length === 0) {
    throwVerification(
      "missing_dependency",
      "document purge authorization path hashes are required",
    );
  }
  if (
    new Set(authorizingContainerManifestHashes).size !==
    authorizingContainerManifestHashes.length
  ) {
    throwVerification(
      "duplicate_entry",
      "document purge authorization path hashes contain a duplicate",
    );
  }
  if (record.eventType !== "document.purge") {
    throwVerification(
      "invalid_domain",
      "document purge event body must use document.purge",
    );
  }
  return {
    authorizingContainerManifestHashes,
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
    body.authorizingContainerManifestHashes.at(-1) !==
    body.containerManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      "document purge authorization path does not end at its container head",
    );
  }
  const expectedDependencies = [
    ...body.authorizingContainerManifestHashes,
  ].sort();
  if (
    event.dependencyManifestHashes.length !== expectedDependencies.length ||
    event.dependencyManifestHashes.some(
      (hash, index) => hash !== expectedDependencies[index],
    )
  ) {
    throwVerification(
      "missing_dependency",
      "document purge event must bind exactly its authorizing container path",
    );
  }
}

function assertPurgeAuthorizationPath(
  input: VerifyDocumentPurgeEventInput,
  body: DocumentPurgeAccessEventBody,
): void {
  const root = input.authorizingContainerPath[0];
  if (
    !root ||
    root.state.parentContainerId !== null ||
    root.state.parentManifestHash !== null
  ) {
    throwVerification(
      "missing_dependency",
      "document purge authorization path must start at a root container",
    );
  }
  for (const [index, manifest] of input.authorizingContainerPath.entries()) {
    if (
      body.authorizingContainerManifestHashes[index] !== manifest.manifestHash
    ) {
      throwVerification(
        "missing_dependency",
        "document purge authorization path does not match the signed path",
      );
    }
    if (
      manifest.state.organizationId !==
      input.documentManifest.state.organizationId
    ) {
      throwVerification(
        "object_mismatch",
        "document purge authorization path crosses organizations",
      );
    }
    const parent = input.authorizingContainerPath[index - 1];
    if (
      parent &&
      manifest.state.parentContainerId !== parent.state.containerId
    ) {
      throwVerification(
        "missing_dependency",
        "document purge authorization path is not contiguous",
      );
    }
  }
  if (
    body.authorizingContainerManifestHashes.length !==
    input.authorizingContainerPath.length
  ) {
    throwVerification(
      "missing_dependency",
      "document purge authorization path does not match the signed path",
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
  assertPurgeAuthorizationPath(input, body);
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
