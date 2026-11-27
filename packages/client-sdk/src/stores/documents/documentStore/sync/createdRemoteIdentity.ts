import type {
  DocumentState,
  DocumentStoreState,
  PersistedDocumentRecord,
} from "../state";

interface CreatedRemoteIdentity {
  readonly accessEpoch: number;
  readonly containerId: string | null;
  readonly doc: DocumentState;
  readonly documentId: string;
}

const createdRemoteIdentities = new WeakMap<
  DocumentStoreState,
  CreatedRemoteIdentity
>();

/**
 * Whether `documentId` is the remote identity this store's own
 * `persistCreatedRemoteDocument` just assigned to `expectedDoc` (a `null -> id`
 * birth, never a relink). A local mutation that captured `documentId: null`
 * while that create persisted may adopt it instead of discarding the edit.
 */
function canAdoptCreatedRemoteDocumentId(
  state: DocumentStoreState,
  expectedDoc: DocumentState,
  documentId: string,
): boolean {
  const recorded = createdRemoteIdentities.get(state);
  return (
    recorded !== undefined &&
    recorded.doc === expectedDoc &&
    state.doc === expectedDoc &&
    recorded.documentId === documentId
  );
}

/**
 * Hooks `persistDocumentState` runs inside its serialized SQL mutation so a
 * store's own `null -> documentId` create commit is visible to any queued local
 * edit before the lock is released, while relinks and resets clear it.
 */
export function createdRemoteIdentityPersistenceHooks(input: {
  readonly assignsCreatedRemoteDocumentId: boolean;
  readonly currentDoc: DocumentState;
  readonly isCurrent: () => boolean;
  readonly previousDocumentId: string | null;
  readonly state: DocumentStoreState;
}) {
  const { currentDoc, isCurrent, state } = input;
  return {
    canAdoptCreatedDocumentId: (documentId: string) =>
      isCurrent() &&
      canAdoptCreatedRemoteDocumentId(state, currentDoc, documentId),
    onSettledInMutation: (
      result: Pick<
        PersistedDocumentRecord,
        | "pullContinuationSuperseded"
        | "record"
        | "syncIdentitySuperseded"
        | "updatedAt"
      >,
    ) => {
      if (!isCurrent()) {
        return;
      }
      if (
        input.assignsCreatedRemoteDocumentId &&
        input.previousDocumentId === null &&
        result.record.documentId !== null &&
        result.updatedAt !== undefined &&
        !result.pullContinuationSuperseded &&
        !result.syncIdentitySuperseded
      ) {
        createdRemoteIdentities.set(state, {
          accessEpoch: result.record.accessEpoch,
          containerId: result.record.containerId,
          doc: currentDoc,
          documentId: result.record.documentId,
        });
        return;
      }
      const recorded = createdRemoteIdentities.get(state);
      if (
        recorded !== undefined &&
        (recorded.doc !== state.doc ||
          result.record.documentId !== recorded.documentId ||
          result.record.containerId !== recorded.containerId ||
          result.record.accessEpoch !== recorded.accessEpoch ||
          result.syncIdentitySuperseded === true)
      ) {
        createdRemoteIdentities.delete(state);
      }
    },
  };
}
