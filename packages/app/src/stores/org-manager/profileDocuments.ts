import type {
  DocumentStore,
  DocumentStoreRelinkInput,
  Documents,
  ResolvedUserIdentity,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  buildOrganizationProfileDocumentPatch,
  buildRosterProfileDocumentPatch,
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  defaultDocumentsPersistence,
  getOrganizationProfileDocumentLocalId,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "@tearleads/client-sdk";
import { versionVectorsEqual } from "@tearleads/loro";
import { resolveProfileDocumentIdentity } from "./profileDocumentIdentity";

const PROFILE_DOCUMENT_SYNC_TIMEOUT_MS = 15_000;

export function getRosterProfileDisplayName(fields: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  nickname?: string | null | undefined;
}): string | null {
  const nickname = fields.nickname?.trim() ?? "";
  if (nickname.length > 0) {
    return nickname;
  }

  const firstName = fields.firstName?.trim() ?? "";
  const lastName = fields.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName.length > 0 ? fullName : null;
}

export function getRosterProfileDocumentRelinkInput(input: {
  localId: string;
  profileContainerId: string;
  profileDocumentId: string;
}): DocumentStoreRelinkInput {
  return {
    accessEpoch: 1,
    containerId: input.profileContainerId,
    documentId: input.profileDocumentId,
    localId: input.localId,
  };
}

function waitForRemoteDocumentId(
  store: DocumentStore,
  timeoutMs = PROFILE_DOCUMENT_SYNC_TIMEOUT_MS,
): Promise<string | null> {
  const currentDocumentId = store.getSnapshot().documentId;
  if (currentDocumentId) {
    return Promise.resolve(currentDocumentId);
  }

  return new Promise((resolve) => {
    let completed = false;
    let unsubscribe: (() => void) | null = null;
    let shouldUnsubscribeAfterSubscribe = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (documentId: string | null) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timeout);
      if (unsubscribe) {
        unsubscribe();
      } else {
        shouldUnsubscribeAfterSubscribe = true;
      }
      resolve(documentId);
    };

    timeout = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    unsubscribe = store.subscribe(() => {
      const documentId = store.getSnapshot().documentId;
      if (documentId) {
        finish(documentId);
      }
    });

    if (shouldUnsubscribeAfterSubscribe) {
      unsubscribe();
    }
    if (!completed) {
      store.requestSync();
    }
  });
}

/** Names an operator may seed into a roster profile when creating it. */
export interface RosterProfileNames {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly nickname?: string | undefined;
}

function presentRosterProfileNames(
  names: RosterProfileNames | undefined,
): Record<string, string> {
  const present: Record<string, string> = {};
  for (const [field, value] of Object.entries(names ?? {})) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed.length > 0) {
      present[field] = trimmed;
    }
  }
  return present;
}

export async function createRosterProfileDocument(input: {
  containerId: string;
  documents: Documents;
  identity: Pick<ResolvedUserIdentity, "encapsulationPublicKey" | "userId">;
  isSelf: boolean;
  names?: RosterProfileNames | undefined;
  organizationId: string;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<string | null> {
  const fields = {
    ...buildRosterProfileDocumentPatch({
      encapsulationPublicKey: input.identity.encapsulationPublicKey,
      isSelf: input.isSelf,
      userId: input.identity.userId,
    }),
    ...presentRosterProfileNames(input.names),
  };
  return ensureProfileDocument({
    containerId: input.containerId,
    documents: input.documents,
    documentKind: "contact",
    fields,
    preferredLocalId: getRosterProfileDocumentLocalId({
      organizationId: input.organizationId,
      userId: input.identity.userId,
    }),
    stillCurrent: input.stillCurrent ?? (() => true),
  });
}

export async function createOrganizationProfileDocument(input: {
  containerId: string;
  documents: Documents;
  name?: string | undefined;
  organizationId: string;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<string | null> {
  const fields = buildOrganizationProfileDocumentPatch({
    name: input.name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  });
  return ensureProfileDocument({
    containerId: input.containerId,
    documents: input.documents,
    documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    fields,
    preferredLocalId: getOrganizationProfileDocumentLocalId({
      organizationId: input.organizationId,
    }),
    stillCurrent: input.stillCurrent ?? (() => true),
  });
}

type EnsureProfileDocumentInput = {
  containerId: string;
  documents: Documents;
  documentKind: StoredDocumentKind;
  fields: Record<string, string | undefined>;
  preferredLocalId: string;
  stillCurrent: () => boolean;
};

type SelectedProfileIdentity = Exclude<
  Awaited<ReturnType<typeof resolveProfileDocumentIdentity>>,
  { status: "unavailable" }
>;

async function finishProfileDocument(
  input: EnsureProfileDocumentInput,
  selected: SelectedProfileIdentity,
  store: DocumentStore,
): Promise<string | null> {
  // Birth-only fields must not overwrite an existing profile's user edits,
  // including when another initializer wins the same local key.
  const record = await defaultDocumentsPersistence.loadDocument(
    selected.runtime.infra.execSql,
    selected.localId,
  );
  if (!input.stillCurrent() || !record) return null;
  if (
    selected.documentId &&
    (record.documentId ?? record.recoveryDocumentId) !== selected.documentId
  )
    return null;
  if (record.documentId && store.getSnapshot().documentId !== record.documentId)
    return null;
  if (store.getSnapshot().documentKind !== input.documentKind) return null;
  store.requestSync();
  if (
    (record.documentId ?? record.recoveryDocumentId) &&
    versionVectorsEqual(record.snapshotEndVersion, "")
  )
    return null;
  const documentId = await waitForRemoteDocumentId(store);
  return input.stillCurrent() ? documentId : null;
}

async function ensureProfileDocument(
  input: EnsureProfileDocumentInput,
): Promise<string | null> {
  // Discovery may win after selection but before the atomic birth. The SDK
  // refuses that birth; resolve its existing owner once, never weaken the guard.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const selected = await resolveProfileDocumentIdentity(input);
    if (selected.status === "unavailable" || !input.stillCurrent()) return null;
    const store = input.documents.open(
      {
        containerId: input.containerId,
        documentId: selected.documentId,
        initialDocumentKind: input.documentKind,
        initialStructuredFields:
          selected.status === "create" ? input.fields : undefined,
        localId: selected.localId,
      },
      { workflowRuntime: selected.runtime },
    );
    const initialized = await store.ensureInitialized();
    if (!input.stillCurrent()) return null;
    if (!initialized) continue;
    return finishProfileDocument(input, selected, store);
  }
  return null;
}
