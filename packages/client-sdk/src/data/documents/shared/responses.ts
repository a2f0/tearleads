import type {
  AccessManifestBundleWireResponse,
  DocumentContentKeyBundleResponse,
  DocumentCreateResponse,
  DocumentKekTargetsResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { serializedPersistedDocumentState } from "./readers";
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
} from "./sync/syncResponses";

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
  // Link and unlink bodies differ; the acknowledged bundle carries either.
  body: unknown;
};

/**
 * The committed material a matched document create or link-set
 * acknowledgement establishes. The response carries only hashes, so this is
 * built from the plan the client signed: the manifest bundle, the content-key
 * bundle it submitted, and the KEK targets it derived.
 */
export interface AcknowledgedDocumentMutation {
  readonly accessManifest: AccessManifestBundleWireResponse;
  readonly contentKeyBundle: DocumentContentKeyBundleResponse;
  readonly documentKekTargets: DocumentKekTargetsResponse;
  readonly id: string;
}

/**
 * A document acknowledgement commits by hash: the manifest hash covers the
 * signed event (by hash) and the derived link-set state, and the target hash
 * covers every KEK target the content key is wrapped to. Equal hashes
 * acknowledge exactly the plan this client signed; any mismatch refuses.
 */
function assertDocumentMutationAcknowledgement(input: {
  expectedContentKeyEpoch: number;
  label: string;
  plan: DocumentMutationPlan;
  response: DocumentLinkSetMutationResponse;
}): void {
  const { label, plan, response } = input;
  if (response.id !== plan.documentId) {
    throw new Error(`${label} id mismatch`);
  }
  if (
    response.manifestHash !== plan.manifestHash ||
    response.eventHash !== plan.eventHash
  ) {
    throw new Error(`${label} manifest hash mismatch`);
  }
  if (response.contentKeyEpoch !== input.expectedContentKeyEpoch) {
    throw new Error(`${label} content-key epoch mismatch`);
  }
  if (response.targetHash !== plan.targetHash) {
    throw new Error(`${label} target hash mismatch`);
  }
}

function acknowledgedDocumentMutationFromPlan(input: {
  contentKeyEpoch: number;
  contentKeyTargets: DocumentContentKeyBundleResponse["targets"];
  plan: DocumentMutationPlan;
}): AcknowledgedDocumentMutation {
  const { plan } = input;
  return {
    accessManifest: {
      event: {
        event: { ...plan.event },
        body: plan.body,
        eventHash: plan.eventHash,
      },
      manifest: { ...plan.manifest },
      manifestHash: plan.manifestHash,
      state: { ...plan.state },
    },
    contentKeyBundle: {
      documentId: plan.documentId,
      contentKeyEpoch: input.contentKeyEpoch,
      linkSetManifestHash: plan.manifestHash,
      targetHash: plan.targetHash,
      targets: input.contentKeyTargets.map((target) => ({ ...target })),
    },
    documentKekTargets: {
      documentId: plan.documentId,
      linkSetManifestHash: plan.manifestHash,
      linkedContainerManifestHashes: plan.targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: plan.targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets: plan.targets.map((target) => ({ ...target })),
      documentKeyTargetHash: plan.targetHash,
    },
    id: plan.documentId,
  };
}

export function assertDocumentCreateResponseMatchesPlan(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): void {
  assertDocumentMutationAcknowledgement({
    expectedContentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
    label: "Document create response",
    plan,
    response,
  });
}

/** Checks a create acknowledgement and returns what it committed. */
export function acknowledgedDocumentCreate(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): AcknowledgedDocumentMutation {
  assertDocumentCreateResponseMatchesPlan(plan, response);
  return acknowledgedDocumentMutationFromPlan({
    contentKeyEpoch: plan.request.contentKeyBundle.contentKeyEpoch,
    contentKeyTargets: plan.request.contentKeyBundle.targets,
    plan,
  });
}

/** Checks a link-set acknowledgement and returns what it committed. */
export function acknowledgedDocumentLinkSetMutation(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): AcknowledgedDocumentMutation {
  assertDocumentMutationAcknowledgement({
    expectedContentKeyEpoch: plan.contentKeyEpoch,
    label: "Document link-set response",
    plan,
    response,
  });
  return acknowledgedDocumentMutationFromPlan({
    contentKeyEpoch: plan.contentKeyEpoch,
    contentKeyTargets: plan.request.contentKeyBundle.targets,
    plan,
  });
}

export function persistedDocumentStateFromAcknowledgement(
  acknowledged: AcknowledgedDocumentMutation,
): PersistedDocumentCreateState {
  return serializedPersistedDocumentState({
    contentKeyBundle: acknowledged.contentKeyBundle,
    documentId: acknowledged.id,
    documentKekTargets: acknowledged.documentKekTargets,
    documentManifestBundle: acknowledged.accessManifest,
  });
}

export function persistedDocumentCreateStateFromResponse(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): PersistedDocumentCreateState {
  return persistedDocumentStateFromAcknowledgement(
    acknowledgedDocumentCreate(plan, response),
  );
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
  return persistedDocumentStateFromAcknowledgement(
    acknowledgedDocumentLinkSetMutation(plan, response),
  );
}
