import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import {
  readRecordString,
  serializeCanonical,
  serializeState,
} from "./readers";
import type {
  DocumentCreatePlan,
  DocumentLinkSetMutationPlan,
  PersistedDocumentCreateState,
} from "./types";

export {
  isRetryableDocumentSyncConflict,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "./syncResponses";

// 1. assertCreateResponseMatchesPlan (internal) + persistedDocumentCreateStateFromResponse (EXPORT)
function assertCreateResponseMatchesPlan(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document create response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document create response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document create response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document create response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document create response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document create response event mismatch");
  }

  const responseState = response.accessManifest.state;
  if (!isPlainRecord(responseState)) {
    throw new Error("Document create response state is invalid");
  }
  if (
    readRecordString(responseState, "documentId", "document state") !==
    plan.documentId
  ) {
    throw new Error("Document create response document id mismatch");
  }
  if (
    serializeCanonical(responseState, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document create response state mismatch");
  }

  if (response.contentKeyBundle.documentId !== plan.documentId) {
    throw new Error("Document create response content-key document mismatch");
  }
  if (
    response.contentKeyBundle.contentKeyEpoch !==
    plan.request.contentKeyBundle.contentKeyEpoch
  ) {
    throw new Error("Document create response content-key epoch mismatch");
  }
  if (response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response link manifest mismatch");
  }
  if (response.contentKeyBundle.targetHash !== plan.targetHash) {
    throw new Error("Document create response target hash mismatch");
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(
      plan.request.contentKeyBundle.targets,
      "content-key targets",
    )
  ) {
    throw new Error("Document create response content-key targets mismatch");
  }
  if (response.documentKekTargets.documentId !== plan.documentId) {
    throw new Error("Document create response target document mismatch");
  }
  if (response.documentKekTargets.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response target manifest mismatch");
  }
  if (response.documentKekTargets.documentKeyTargetHash !== plan.targetHash) {
    throw new Error("Document create response document target hash mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document create response KEK targets mismatch");
  }
}

export function persistedDocumentCreateStateFromResponse(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): PersistedDocumentCreateState {
  assertCreateResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}

// 2. assertLinkSetMutationResponseMatchesPlan (internal) + persistedDocumentLinkSetMutationStateFromResponse (EXPORT)
function assertLinkSetMutationResponseMatchesPlan(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document link-set response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document link-set response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document link-set response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document link-set response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document link-set response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document link-set response event mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.state, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document link-set response state mismatch");
  }
  if (
    response.contentKeyBundle.documentId !== plan.documentId ||
    response.contentKeyBundle.contentKeyEpoch !== plan.contentKeyEpoch ||
    response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash ||
    response.contentKeyBundle.targetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response content-key mismatch");
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(
      plan.request.contentKeyBundle.targets,
      "content-key targets",
    )
  ) {
    throw new Error("Document link-set response content-key targets mismatch");
  }
  if (
    response.documentKekTargets.documentId !== plan.documentId ||
    response.documentKekTargets.linkSetManifestHash !== plan.manifestHash ||
    response.documentKekTargets.documentKeyTargetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response KEK target mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document link-set response KEK targets mismatch");
  }
}

export function persistedDocumentLinkSetMutationStateFromResponse(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): PersistedDocumentCreateState {
  assertLinkSetMutationResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}
