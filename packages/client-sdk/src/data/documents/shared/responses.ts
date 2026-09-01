import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  readRecordString,
  serializeCanonical,
  serializedPersistedDocumentState,
} from "./readers";
import type {
  DocumentCreatePlan,
  DocumentLinkSetMutationPlan,
  PersistedDocumentCreateState,
} from "./types";

export {
  DocumentSyncResponseUpdateContentKeyError,
  isRetryableDocumentSyncConflict,
  isUpstreamDeletedDocumentSyncFailure,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "./syncResponses";

type DocumentMutationPlan = Pick<
  DocumentCreatePlan,
  | "documentId"
  | "event"
  | "eventHash"
  | "manifest"
  | "manifestHash"
  | "state"
  | "targetHash"
  | "targets"
> & {
  // Link and unlink bodies are both serialized canonically, so the shared
  // matcher does not care which event body shape the plan carries.
  body: unknown;
};

function assertDocumentMutationManifestMatchesPlan(input: {
  label: string;
  plan: DocumentMutationPlan;
  probeStateDocumentId: boolean;
  response: DocumentCreateResponse | DocumentLinkSetMutationResponse;
}): void {
  const { label, plan, response } = input;
  if (response.id !== plan.documentId) {
    throw new Error(`${label} id mismatch`);
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error(`${label} manifest hash mismatch`);
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error(`${label} manifest mismatch`);
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error(`${label} event bundle is invalid`);
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error(`${label} event hash mismatch`);
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error(`${label} event mismatch`);
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "body"), "event body") !==
    serializeCanonical(plan.body, "event body")
  ) {
    throw new Error(`${label} event body mismatch`);
  }

  const responseState = response.accessManifest.state;
  if (input.probeStateDocumentId) {
    if (!isPlainRecord(responseState)) {
      throw new Error(`${label} state is invalid`);
    }
    if (
      readRecordString(responseState, "documentId", "document state") !==
      plan.documentId
    ) {
      throw new Error(`${label} document id mismatch`);
    }
  }
  if (
    serializeCanonical(responseState, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error(`${label} state mismatch`);
  }
}

function assertDocumentMutationKeyBundlesMatchPlan(input: {
  expectedContentKeyEpoch: number;
  expectedContentKeyTargets: unknown;
  label: string;
  plan: DocumentMutationPlan;
  response: DocumentCreateResponse | DocumentLinkSetMutationResponse;
}): void {
  const { label, plan, response } = input;
  if (response.contentKeyBundle.documentId !== plan.documentId) {
    throw new Error(`${label} content-key document mismatch`);
  }
  if (
    response.contentKeyBundle.contentKeyEpoch !== input.expectedContentKeyEpoch
  ) {
    throw new Error(`${label} content-key epoch mismatch`);
  }
  if (response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash) {
    throw new Error(`${label} link manifest mismatch`);
  }
  if (response.contentKeyBundle.targetHash !== plan.targetHash) {
    throw new Error(`${label} target hash mismatch`);
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(input.expectedContentKeyTargets, "content-key targets")
  ) {
    throw new Error(`${label} content-key targets mismatch`);
  }
  if (response.documentKekTargets.documentId !== plan.documentId) {
    throw new Error(`${label} target document mismatch`);
  }
  if (response.documentKekTargets.linkSetManifestHash !== plan.manifestHash) {
    throw new Error(`${label} target manifest mismatch`);
  }
  if (response.documentKekTargets.documentKeyTargetHash !== plan.targetHash) {
    throw new Error(`${label} document target hash mismatch`);
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error(`${label} KEK targets mismatch`);
  }
}

function assertDocumentMutationResponseMatchesPlan(input: {
  expectedContentKeyEpoch: number;
  expectedContentKeyTargets: unknown;
  label: string;
  plan: DocumentMutationPlan;
  probeStateDocumentId: boolean;
  response: DocumentCreateResponse | DocumentLinkSetMutationResponse;
}): void {
  assertDocumentMutationManifestMatchesPlan(input);
  assertDocumentMutationKeyBundlesMatchPlan(input);
}

export function assertDocumentCreateResponseMatchesPlan(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): void {
  assertDocumentMutationResponseMatchesPlan({
    expectedContentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
    expectedContentKeyTargets: plan.request.contentKeyBundle.targets,
    label: "Document create response",
    plan,
    probeStateDocumentId: true,
    response,
  });
}

export function persistedDocumentCreateStateFromResponse(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): PersistedDocumentCreateState {
  assertDocumentCreateResponseMatchesPlan(plan, response);

  return serializedPersistedDocumentState({
    contentKeyBundle: response.contentKeyBundle,
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifestBundle: response.accessManifest,
  });
}

/**
 * Builds the persisted create-state from a fetched writer projection, for the
 * idempotent-create adopt path where the original create response (which
 * `persistedDocumentCreateStateFromResponse` consumes) was lost. The projection
 * carries the same committed manifest, content-key bundle and KEK targets — the
 * caller must verify it with `assertDocumentWriterProjectionConsistent` first.
 */
export function persistedDocumentCreateStateFromWriterProjection(
  writerProjection: DocumentWriterProjectionResponse,
): PersistedDocumentCreateState {
  return serializedPersistedDocumentState({
    contentKeyBundle: writerProjection.contentKeyBundle,
    documentId: writerProjection.documentId,
    documentKekTargets: writerProjection.documentKekTargets,
    documentManifestBundle: writerProjection.documentManifest,
  });
}

export function persistedDocumentLinkSetMutationStateFromResponse(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): PersistedDocumentCreateState {
  assertDocumentMutationResponseMatchesPlan({
    expectedContentKeyEpoch: plan.contentKeyEpoch,
    expectedContentKeyTargets: plan.request.contentKeyBundle.targets,
    label: "Document link-set response",
    plan,
    probeStateDocumentId: false,
    response,
  });

  return serializedPersistedDocumentState({
    contentKeyBundle: response.contentKeyBundle,
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifestBundle: response.accessManifest,
  });
}
