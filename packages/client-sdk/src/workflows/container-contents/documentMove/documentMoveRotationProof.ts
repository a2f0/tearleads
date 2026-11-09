import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import type { DocumentMoveIntentRecord } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import type {
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationFailure,
  DocumentRotationProofMode,
} from "../../documents";
import type { DocumentStructuralMutationLocalStore } from "../documentQueries/documentStructureTypes";

interface RotationProofHost {
  openDocumentStore: (input: {
    containerId: string;
    documentId: string | null;
    localId: string;
  }) => Pick<
    DocumentStructuralMutationLocalStore<unknown>,
    "assertCanRotateContentKey" | "ensureInitialized"
  >;
}

/** The server refused an unlink whose baseline misses a committed update. */
function isStaleUnlinkRotationBaselineFailure(
  failure: DocumentLinkSetMutationFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.code === DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale
  );
}

async function proveMoveIntentRotation(input: {
  existingContainerId: string | null | undefined;
  host: RotationProofHost;
  isCurrent: () => boolean;
  intent: DocumentMoveIntentRecord;
  proof: DocumentRotationProofMode;
}): Promise<Uint8Array | null> {
  if (!input.isCurrent()) return null;
  const preflightStore = input.host.openDocumentStore({
    // The optimistic move already changed local placement. Use that scope so
    // opening the destination view cannot invalidate this shared store's proof.
    // Remote link-set authorization still uses the intent's source.
    containerId: input.existingContainerId ?? input.intent.targetContainerId,
    documentId: input.intent.documentId,
    localId: input.intent.localId,
  });
  if (!(await preflightStore.ensureInitialized())) {
    throw new Error("Document rotation preflight could not load the document");
  }
  if (!input.isCurrent()) return null;
  const rotationSnapshot = await preflightStore.assertCanRotateContentKey(
    input.proof,
  );
  return input.isCurrent() ? rotationSnapshot : null;
}

/**
 * Run a queued move's remote legs with a full-history rotation snapshot. The
 * replay reuses the proof the store took when the unlink was accepted; the
 * server checks every baseline against its committed frontier under the
 * manifest-head lock, so a stale reuse costs one refused unlink, after which
 * the replay proves again and retries once. A reload has no recorded proof and
 * proves before the first attempt.
 */
export async function moveWithRotationProof<TMoved>(input: {
  attempt: (
    rotationSnapshot: Uint8Array,
    onFailure: DocumentLinkSetFailureHandler,
  ) => Promise<TMoved>;
  existingContainerId: string | null | undefined;
  host: RotationProofHost;
  isCurrent: () => boolean;
  intent: DocumentMoveIntentRecord;
  log: (message: string) => void;
  onFailure: DocumentLinkSetFailureHandler;
}): Promise<TMoved | "abandoned"> {
  const reused = await proveMoveIntentRotation({ ...input, proof: "reuse" });
  if (!reused || !input.isCurrent()) return "abandoned";
  const failures: DocumentLinkSetMutationFailure[] = [];
  const first = await input.attempt(reused, (failure) => {
    failures.push(failure);
  });
  if (!failures.some(isStaleUnlinkRotationBaselineFailure)) {
    for (const failure of failures) input.onFailure(failure);
    return first;
  }
  if (!input.isCurrent()) return "abandoned";
  input.log(
    `Container contents: unlink baseline for ${input.intent.documentId} was stale; proving its history again`,
  );
  const proven = await proveMoveIntentRotation({ ...input, proof: "prove" });
  if (!proven || !input.isCurrent()) return "abandoned";
  return input.attempt(proven, input.onFailure);
}
