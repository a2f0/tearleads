import type {
  DocumentStore,
  Documents,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";

const PROFILE_DOCUMENT_SYNC_TIMEOUT_MS = 15_000;

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

export function getRosterProfileDocumentLocalId(input: {
  organizationId: string;
  userId: string;
}): string {
  return `org-profile:${input.organizationId}:${input.userId}`;
}

export function getRosterProfileDocumentPatch(
  user: OrganizationDirectoryUser,
): Record<string, string | undefined> {
  return {
    encapsulationPublicKey: user.encapsulationPublicKey,
    isSelf: user.isSelf ? "1" : "0",
    userId: user.userId,
  };
}

export async function createRosterProfileDocument(input: {
  documents: Documents;
  organizationId: string;
  user: OrganizationDirectoryUser;
}): Promise<string | null> {
  const store = input.documents.store({
    initialDocumentKind: "contact",
    localId: getRosterProfileDocumentLocalId({
      organizationId: input.organizationId,
      userId: input.user.userId,
    }),
  });

  if (!(await store.ensureInitialized())) {
    return null;
  }

  await store.setStructuredFields(
    "contact",
    getRosterProfileDocumentPatch(input.user),
  );
  store.requestSync();

  return waitForRemoteDocumentId(store);
}
