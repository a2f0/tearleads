import type {
  DocumentStore,
  DocumentStoreRelinkInput,
  Documents,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import {
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  getOrganizationProfileDocumentLocalId,
  getOrganizationProfileDocumentPatch,
  getRosterProfileDocumentLocalId,
  getRosterProfileDocumentPatch,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "@tearleads/client-sdk";
import { readContactFields } from "../../document-types/contact/contactDocumentModel";

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

export function readRosterProfileDisplayName(
  structuredFields: Readonly<Record<string, unknown>>,
): string | null {
  return getRosterProfileDisplayName(readContactFields(structuredFields));
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
  organizationId: string;
  user: OrganizationDirectoryUser;
}): Promise<string | null> {
  const store = input.documents.openStore({
    containerId: input.containerId,
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

export async function createOrganizationProfileDocument(input: {
  containerId: string;
  documents: Documents;
  name?: string | undefined;
  organizationId: string;
}): Promise<string | null> {
  const store = input.documents.openStore({
    containerId: input.containerId,
    initialDocumentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    localId: getOrganizationProfileDocumentLocalId({
      organizationId: input.organizationId,
    }),
  });

  if (!(await store.ensureInitialized())) {
    return null;
  }

  await store.setStructuredFields(
    ORGANIZATION_PROFILE_DOCUMENT_KIND,
    getOrganizationProfileDocumentPatch({
      name: input.name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
    }),
  );
  store.requestSync();

  return waitForRemoteDocumentId(store);
}
