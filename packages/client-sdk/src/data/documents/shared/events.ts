import {
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../keyingCanonicalJson";
import {
  authorizingContainerPathRefsForLinkSet,
  containerPathRefs,
  deriveDocumentCreateTargets,
  mergeTargetEnvelopes,
} from "./projection";
import { sortDocumentTargets, uniqueSortedStrings } from "./readers";
import type {
  BuildDocumentCreatePlanInput,
  DocumentCreateAuthor,
  DocumentCreatePlan,
  DocumentLinkSetEventPlan,
  DocumentLinkSetMutationBody,
  DocumentLinkSetMutationOperation,
  DocumentLinkSetTargetState,
} from "./types";

export async function buildDocumentCreatePlan({
  author,
  containerProjection,
  contentKeyEpoch = 1,
  documentId = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  signedAt = new Date().toISOString(),
  targetEnvelopes,
}: BuildDocumentCreatePlanInput): Promise<DocumentCreatePlan> {
  // The document belongs to its container's organization, not the author's. A
  // member authoring a document under another org's shared container creates a
  // document owned by that org; the author supplies only the signer identity.
  const organizationId = containerProjection.organizationId;

  const targets = deriveDocumentCreateTargets(containerProjection);
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targets,
    targetEnvelopes,
  );
  const targetContainerManifestHash = targets[0]?.containerManifestHash;
  const targetContainerId = targets[0]?.containerId;
  if (!targetContainerManifestHash || !targetContainerId) {
    throw new Error("Document create target is unavailable");
  }

  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: targetContainerId,
    containerManifestHash: targetContainerManifestHash,
  };
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(body, "Document create body"),
  );
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId,
    eventType: "document.link",
    objectKind: "document",
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [targetContainerManifestHash],
    bodyHash,
    signerUserId: author.signerUserId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signedAt,
  };
  const event = await signAccessEvent(unsignedEvent, author.signerPrivateKey);
  const eventHash = await computeAccessEventHash(event);
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [targetContainerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    body,
    documentId,
    event,
    eventHash,
    manifest,
    manifestHash,
    request: {
      event: readCanonicalRecord(event, "Document create event"),
      body: readCanonicalRecord(body, "Document create body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Document create manifest"),
      previousManifest: null,
      targetContainerPathRefs: containerPathRefs(containerProjection.path),
      contentKeyBundle: {
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: targetEnvelopesForRequest,
      },
    },
    state,
    targetHash,
    targets: sortDocumentTargets(targets),
  };
}

export async function buildDocumentLinkSetEventPlan(input: {
  author: DocumentCreateAuthor;
  eventId: string;
  operation: DocumentLinkSetMutationOperation;
  // The document's existing organization (from its manifest). Link/unlink does
  // not change ownership, so the event keeps the document's org, which is the
  // container's org — never the acting member's personal org.
  organizationId: string;
  signedAt: string;
  targetState: DocumentLinkSetTargetState;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentLinkSetEventPlan> {
  const eventType =
    input.operation === "link" ? "document.link" : "document.unlink";
  const body: DocumentLinkSetMutationBody = {
    eventType,
    containerId: input.targetState.target.containerId,
    containerManifestHash: input.targetState.target.containerManifestHash,
  };
  const bodyHash = await computeAccessEventBodyHash(
    readCanonicalJson(body, "Document link-set body"),
  );
  const authorizingContainerPathRefs = authorizingContainerPathRefsForLinkSet({
    operation: input.operation,
    targetContainerId: input.targetState.target.containerId,
    writerProjection: input.writerProjection,
  });
  const dependencyManifestHashes = uniqueSortedStrings([
    input.targetState.target.containerManifestHash,
    ...authorizingContainerPathRefs
      .map((path) => path.at(-1)?.manifestHash)
      .filter((hash): hash is string => typeof hash === "string"),
  ]);
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType,
    objectKind: "document",
    objectId: input.writerProjection.documentId,
    organizationId: input.organizationId,
    previousManifestHash: input.writerProjection.documentManifest.manifestHash,
    dependencyManifestHashes,
    bodyHash,
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt,
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );
  const eventHash = await computeAccessEventHash(event);

  return {
    authorizingContainerPathRefs,
    body,
    event,
    eventHash,
  };
}
