import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import { versionVectorsEqual } from "@tearleads/loro";
import type { ContactsStoreState } from "./contactStoreTypes";
import type { ResolvedSelfContactIdentity } from "./selfContact";

type SelfContactSelection =
  | { readonly status: "existing"; readonly contactId: string }
  | { readonly status: "create"; readonly contactId: string }
  | { readonly status: "refused" };

type SelfContactRecord = NonNullable<
  Awaited<ReturnType<typeof defaultDocumentsPersistence.loadDocument>>
>;

interface SelfContactSelectionContext {
  readonly state: ContactsStoreState;
  readonly identity: ResolvedSelfContactIdentity;
  readonly containerId: string;
  readonly remoteAlias: string | null;
  readonly knownIds: ReadonlySet<string>;
  readonly unsettledIds: ReadonlySet<string>;
}

function collectSelfContactCandidateIds(
  context: SelfContactSelectionContext,
): Set<string> {
  const { identity, remoteAlias, knownIds, unsettledIds } = context;
  return new Set([
    identity.localId,
    identity.documentId,
    ...(remoteAlias ? [remoteAlias] : []),
    ...knownIds,
    ...unsettledIds,
  ]);
}

type SelfContactRecordInspection =
  | { readonly status: "loaded"; readonly record: SelfContactRecord }
  | { readonly status: "missing" }
  | { readonly status: "refused" };

function inspectSelfContactRecord(
  context: SelfContactSelectionContext,
  id: string,
  record: SelfContactRecord | null,
  isCurrent: boolean,
): SelfContactRecordInspection {
  if (!isCurrent) return { status: "refused" };
  if (!record) {
    const { state, identity, remoteAlias, knownIds } = context;
    if (
      id === remoteAlias ||
      state.entriesById.get(id)?.documentId === identity.documentId ||
      (knownIds.has(id) &&
        (id === identity.localId || id === identity.documentId))
    ) {
      return { status: "refused" };
    }
    return { status: "missing" };
  }
  return { status: "loaded", record };
}

type SelfContactSelectionStep =
  | { readonly status: "continue"; readonly selection: SelfContactSelection }
  | { readonly status: "refused" };

function advanceSelfContactSelection(
  context: SelfContactSelectionContext,
  selection: SelfContactSelection,
  id: string,
  record: SelfContactRecord,
  documentId: string,
  isCurrent: boolean,
): SelfContactSelectionStep {
  if (!isCurrent) return { status: "refused" };
  const { state, identity, containerId, unsettledIds } = context;
  if (documentId !== identity.documentId) {
    // An occupied canonical local id cannot be repurposed. Another proven
    // alias of D may still be selected; never overwrite this other history.
    return {
      status: "continue",
      selection: id === identity.localId ? { status: "refused" } : selection,
    };
  }
  if (
    unsettledIds.has(id) ||
    record.containerId !== containerId ||
    record.effectiveAccessLevel === "read" ||
    state.entriesById.get(id)?.canWrite === false ||
    record.snapshotEndVersion.length === 0 ||
    // A deferred local birth may still be empty; a bound stream must hydrate.
    ((record.documentId ?? record.recoveryDocumentId) != null &&
      versionVectorsEqual(record.snapshotEndVersion, ""))
  ) {
    return { status: "refused" };
  }
  return {
    status: "continue",
    selection:
      selection.status !== "existing"
        ? { status: "existing", contactId: id }
        : selection,
  };
}

/**
 * Only the canonical remote stream proves personal Me. Persisted remote and
 * recovery identities outrank a local alias's planned creation identity.
 * Profile fields and the absence of a placement intent prove no role.
 */
export async function loadSelfContactSelection(
  state: ContactsStoreState,
  identity: ResolvedSelfContactIdentity,
  current: () => boolean,
): Promise<SelfContactSelection> {
  if (!current()) return { status: "refused" };
  const { execSql } = state.runtime.documents.infra;
  const containerId = state.runtime.documents.state.containerId;
  if (!containerId) return { status: "refused" };
  const placements = (await state.runtime.listPendingWrites()).filter(
    (item) =>
      item.objectKind === "document" &&
      item.operations.some((operation) => operation.kind === "move"),
  );
  if (!current()) return { status: "refused" };
  const unsettledIds = new Set(placements.map((item) => item.localId));
  if (
    unsettledIds.has(identity.localId) ||
    placements.some((item) => item.remoteId === identity.documentId)
  ) {
    return { status: "refused" };
  }

  // Include unhydrated discovery shells and reset aliases, not only Contacts'
  // scalar projection. None may be bypassed by creating another history.
  const persistedIds =
    await defaultDocumentsPersistence.findDocumentLocalIdsByContainerId(
      execSql,
      containerId,
    );
  if (!current()) return { status: "refused" };
  const remoteAlias = await defaultDocumentsPersistence.findLocalIdByDocumentId(
    execSql,
    identity.documentId,
  );
  if (!current()) return { status: "refused" };
  const knownIds = new Set([...persistedIds, ...state.entriesById.keys()]);
  const context: SelfContactSelectionContext = {
    state,
    identity,
    containerId,
    remoteAlias,
    knownIds,
    unsettledIds,
  };
  const candidateIds = collectSelfContactCandidateIds(context);
  let selection: SelfContactSelection = {
    status: "create",
    contactId: identity.localId,
  };
  for (const id of candidateIds) {
    const record = await defaultDocumentsPersistence.loadDocument(execSql, id);
    const inspected = inspectSelfContactRecord(context, id, record, current());
    if (inspected.status === "refused") return inspected;
    if (inspected.status === "missing") continue;
    const documentId =
      inspected.record.documentId ??
      inspected.record.recoveryDocumentId ??
      (await deriveStableDocumentId(id));
    const next = advanceSelfContactSelection(
      context,
      selection,
      id,
      inspected.record,
      documentId,
      current(),
    );
    if (next.status === "refused") return next;
    selection = next.selection;
  }
  return selection;
}
