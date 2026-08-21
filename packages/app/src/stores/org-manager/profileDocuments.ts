import type {
  DocumentStore,
  DocumentStoreRelinkInput,
  Documents,
  ResolvedUserIdentity,
} from "@symcrypt/client-sdk";
import {
  buildOrganizationProfileDocumentPatch,
  buildRosterProfileDocumentPatch,
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  getOrganizationProfileDocumentLocalId,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "@symcrypt/client-sdk";

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

export async function createRosterProfileDocument(input: {
  containerId: string;
  documents: Documents;
  identity: Pick<ResolvedUserIdentity, "encapsulationPublicKey" | "userId">;
  isSelf: boolean;
  nickname?: string | undefined;
  organizationId: string;
}): Promise<string | null> {
  const store = input.documents.open({
    containerId: input.containerId,
    initialDocumentKind: "contact",
    localId: getRosterProfileDocumentLocalId({
      organizationId: input.organizationId,
      userId: input.identity.userId,
    }),
  });

  await store.setStructuredFields("contact", {
    ...buildRosterProfileDocumentPatch({
      encapsulationPublicKey: input.identity.encapsulationPublicKey,
      isSelf: input.isSelf,
      userId: input.identity.userId,
    }),
    ...(input.nickname ? { nickname: input.nickname } : {}),
  });
  if (!store.getSnapshot().ready) {
    return null;
  }
  store.requestSync();

  return waitForRemoteDocumentId(store);
}

export async function createOrganizationProfileDocument(input: {
  containerId: string;
  documents: Documents;
  name?: string | undefined;
  organizationId: string;
}): Promise<string | null> {
  const store = input.documents.open({
    containerId: input.containerId,
    initialDocumentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    localId: getOrganizationProfileDocumentLocalId({
      organizationId: input.organizationId,
    }),
  });

  await store.setStructuredFields(
    ORGANIZATION_PROFILE_DOCUMENT_KIND,
    buildOrganizationProfileDocumentPatch({
      name: input.name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
    }),
  );
  if (!store.getSnapshot().ready) {
    return null;
  }
  store.requestSync();

  return waitForRemoteDocumentId(store);
}
