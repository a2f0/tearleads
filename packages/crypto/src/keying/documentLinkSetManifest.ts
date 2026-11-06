import type { AccessManifest } from "./accessManifestTypes";
import { computeKeyingDomainHash } from "./canonical";
import type { KeyingCanonicalPayload } from "./canonicalJsonTypes";
import type {
  DocumentLinkSetManifestState,
  DocumentLinkSetStructural,
} from "./documentAccessTypes";
import {
  assertExactKeys,
  normalizeUniqueSortedStrings,
  readHashString,
  readNullableHashString,
  readPositiveInteger,
  readString,
  readStringArray,
  readVersion,
  throwVerification,
} from "./shared";

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
    "tearleads.keying.document-link-set-structural",
    payload,
  );
}

export async function computeDocumentLinkSetGrantRoot(): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.document-link-set-grants", {
    grants: [],
  });
}

export async function computeDocumentLinkSetKeyTargetHash(): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.keying.document-link-set-key-target",
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
