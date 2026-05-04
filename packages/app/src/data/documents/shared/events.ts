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
  readCanonicalRecords,
} from "../../keyingCanonicalJson";
import {
  authorizingContainerPathRecordsForLinkSet,
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
  if (author.organizationId !== containerProjection.organizationId) {
    throw new Error("Document author organization does not match container");
  }

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
    organizationId: author.organizationId,
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
    organizationId: author.organizationId,
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
      targetContainerPath: readCanonicalRecords(
        containerProjection.path,
        "Document create target container path",
      ),
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
  const authorizingContainerPaths = authorizingContainerPathRecordsForLinkSet({
    operation: input.operation,
    targetContainerId: input.targetState.target.containerId,
    writerProjection: input.writerProjection,
  });
  const dependencyManifestHashes = uniqueSortedStrings([
    input.targetState.target.containerManifestHash,
    ...authorizingContainerPaths
      .map((path) => Reflect.get(path.at(-1) ?? {}, "manifestHash"))
      .filter((hash): hash is string => typeof hash === "string"),
  ]);
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId,
    eventType,
    objectKind: "document",
    objectId: input.writerProjection.documentId,
    organizationId: input.author.organizationId,
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
    authorizingContainerPaths,
    body,
    event,
    eventHash,
  };
}
