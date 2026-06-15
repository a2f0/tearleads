import type {
  DocumentStore,
  Documents,
  DocumentsRuntime,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { getRosterProfileDocumentLocalId } from "@tearleads/client-sdk";
import {
  getRosterProfileDocumentRelinkInput,
  readRosterProfileDisplayName,
} from "../../../stores/org-manager/profileDocuments";

type RosterProfileDocumentUser = OrganizationDirectoryUser & {
  profileDocumentId: string;
};

type ProfileDisplayNameSetter = (
  userId: string,
  displayName: string | null,
) => void;

export function hasRosterProfileDocument(
  user: OrganizationDirectoryUser,
): user is RosterProfileDocumentUser {
  return user.profileDocumentId !== null;
}

function applyRosterProfileDisplayName(input: {
  setProfileDisplayName: ProfileDisplayNameSetter;
  store: DocumentStore;
  userId: string;
}) {
  const snapshot = input.store.getSnapshot();
  if (!snapshot.ready) {
    return;
  }

  const displayName = readRosterProfileDisplayName(snapshot.structuredFields);
  input.setProfileDisplayName(input.userId, displayName ?? null);
}

export async function loadRosterProfileDisplayName(input: {
  documents: Documents;
  isCancelled: () => boolean;
  organizationId: string;
  profileContainerId: string;
  runtime: DocumentsRuntime;
  setProfileDisplayName: ProfileDisplayNameSetter;
  unsubscribes: Array<() => void>;
  user: RosterProfileDocumentUser;
}): Promise<void> {
  if (input.isCancelled()) {
    return;
  }

  const localId = getRosterProfileDocumentLocalId({
    organizationId: input.organizationId,
    userId: input.user.userId,
  });
  const store = input.documents.open(
    {
      containerId: input.profileContainerId,
      documentId: input.user.profileDocumentId,
      initialDocumentKind: "contact",
      localId,
    },
    { workflowRuntime: input.runtime },
  );
  const applyDisplayName = () => {
    applyRosterProfileDisplayName({
      setProfileDisplayName: input.setProfileDisplayName,
      store,
      userId: input.user.userId,
    });
  };

  input.unsubscribes.push(store.subscribe(applyDisplayName));
  if (input.isCancelled()) {
    return;
  }

  const relinked = await store.relink(
    getRosterProfileDocumentRelinkInput({
      localId,
      profileContainerId: input.profileContainerId,
      profileDocumentId: input.user.profileDocumentId,
    }),
  );
  if (!relinked || input.isCancelled()) {
    return;
  }

  applyDisplayName();
  store.requestSync();
}
