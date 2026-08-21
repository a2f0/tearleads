import { expect, test } from "bun:test";
import type {
  AccessManifest,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  DocumentLinkSetManifestState,
  ReferencedPrincipalHead,
} from "@symcrypt/crypto";
import {
  accessManifestCheckpoint,
  containerAccessManifestStateRecord,
  documentLinkSetStateRecord,
} from "./keyingProjectionManifestRecords";

test("projects the canonical container manifest state field set", () => {
  const directGrant = {
    accessLevel: "admin",
    subjectId: "subject-id",
    subjectType: "user",
    ignored: "grant-extension",
  } satisfies ContainerDirectGrant & { readonly ignored: string };
  const principalHead = {
    principalType: "group",
    principalId: "principal-id",
    version: 3,
    keyEpoch: 4,
    stateHash: "state-hash",
    keyFingerprint: "key-fingerprint",
    ignored: "head-extension",
  } satisfies ReferencedPrincipalHead & { readonly ignored: string };
  const state = {
    version: 1,
    containerId: "container-id",
    organizationId: "organization-id",
    epoch: 2,
    previousManifestHash: "previous-hash",
    eventHash: "event-hash",
    parentContainerId: "parent-id",
    parentManifestHash: "parent-hash",
    metadataDocumentId: "metadata-document-id",
    containerKeyEpochId: "container-key-epoch-id",
    directGrants: [directGrant],
    referencedPrincipalHeads: [principalHead],
    ignored: "state-extension",
  } satisfies ContainerAccessManifestState & { readonly ignored: string };

  expect(containerAccessManifestStateRecord(state)).toEqual({
    version: 1,
    containerId: "container-id",
    organizationId: "organization-id",
    epoch: 2,
    previousManifestHash: "previous-hash",
    eventHash: "event-hash",
    parentContainerId: "parent-id",
    parentManifestHash: "parent-hash",
    metadataDocumentId: "metadata-document-id",
    containerKeyEpochId: "container-key-epoch-id",
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: "subject-id",
        subjectType: "user",
      },
    ],
    referencedPrincipalHeads: [
      {
        principalType: "group",
        principalId: "principal-id",
        version: 3,
        keyEpoch: 4,
        stateHash: "state-hash",
        keyFingerprint: "key-fingerprint",
      },
    ],
  });
});

test("projects canonical document state and checkpoint field sets", () => {
  const state = {
    version: 1,
    documentId: "document-id",
    organizationId: "organization-id",
    epoch: 5,
    previousManifestHash: null,
    eventHash: "event-hash",
    linkedContainerIds: ["container-a", "container-b"],
    ignored: "state-extension",
  } satisfies DocumentLinkSetManifestState & { readonly ignored: string };
  const manifest = {
    version: 1,
    objectKind: "document",
    objectId: "document-id",
    organizationId: "organization-id",
    epoch: 5,
    previousManifestHash: null,
    eventHash: "event-hash",
    structuralHash: "structural-hash",
    grantRoot: "grant-root",
    referencedPrincipalHeads: [],
    keyTargetHash: "key-target-hash",
  } satisfies AccessManifest;

  expect(documentLinkSetStateRecord(state)).toEqual({
    version: 1,
    documentId: "document-id",
    organizationId: "organization-id",
    epoch: 5,
    previousManifestHash: null,
    eventHash: "event-hash",
    linkedContainerIds: ["container-a", "container-b"],
  });
  expect(
    accessManifestCheckpoint({ manifest, manifestHash: "manifest-hash" }),
  ).toEqual({
    objectKind: "document",
    objectId: "document-id",
    organizationId: "organization-id",
    epoch: 5,
    manifestHash: "manifest-hash",
  });
});
