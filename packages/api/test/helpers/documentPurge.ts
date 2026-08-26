import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  DocumentAccessEventBody,
  DocumentPurgeAccessEventBody,
} from "@symcrypt/crypto";
import type { DocumentPurgeRequest } from "@symcrypt/validators/request";
import { routeApp } from "../../src/routeApp";
import {
  asVerifiedContainerManifest,
  createSignedAccessEvent,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";

export async function buildDocumentPurgeRequest(input: {
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentPurgeRequest> {
  const containerId = input.root.kekState.containerId;
  const containerManifestHash = input.root.bundle.manifestHash;
  const body: DocumentPurgeAccessEventBody = {
    containerId,
    containerManifestHash,
    documentManifestHash: input.documentManifestHash,
    eventType: "document.purge",
  };
  const event = await createSignedAccessEvent({
    body: body as unknown as DocumentAccessEventBody,
    dependencyManifestHashes: [containerManifestHash],
    objectId: input.documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.documentManifestHash,
    signer: input.owner,
  });

  return {
    authorizingContainerPathRefs: [
      {
        containerId,
        manifestHash: containerManifestHash,
      },
    ],
    body: body as unknown as Record<string, unknown>,
    event: event.event as unknown as Record<string, unknown>,
  };
}

export async function postDocumentPurge(input: {
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<Response> {
  const request = await buildDocumentPurgeRequest(input);
  return routeApp.request(`/documents/${input.documentId}/purge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}
