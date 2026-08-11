import {
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  readOrganizationProfileName,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  DocumentsProvider,
  useDocument,
} from "../../../stores/documents/DocumentsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  blurOnEnter,
  ProfileReadOnlyField,
  useProfileDocumentLink,
} from "../hooks/profileDocumentEditor";
import { ORG_MANAGER_LABELS } from "../labels";

function OrganizationProfileDocumentFields({
  canEdit,
  localId,
  onNameChange,
  profileContainerId,
  profileDocumentId,
}: {
  canEdit: boolean;
  localId: string;
  onNameChange: (name: string | null) => void;
  profileContainerId: string;
  profileDocumentId: string;
}) {
  const {
    documentId,
    ready,
    relink,
    setStructuredFields,
    structuredFields,
    syncing,
  } = useDocument();
  const name = useMemo(
    () => readOrganizationProfileName(structuredFields),
    [structuredFields],
  );
  const [localName, setLocalName] = useState(
    name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  );

  useEffect(() => {
    setLocalName(name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME);
    onNameChange(name);
  }, [name, onNameChange]);

  const relinkInput = useMemo(
    () => ({
      accessEpoch: 1,
      containerId: profileContainerId,
      documentId: profileDocumentId,
      localId,
    }),
    [localId, profileContainerId, profileDocumentId],
  );
  const { linkFailed: relinkFailed, linkReady: profileLinkReady } =
    useProfileDocumentLink({
      documentId,
      profileDocumentId,
      ready,
      relink,
      relinkInput,
    });

  if (relinkFailed) {
    return (
      <MiniAppStatus>
        {ORG_MANAGER_LABELS.organizationProfileUnavailable}
      </MiniAppStatus>
    );
  }

  if (!ready || !profileLinkReady) {
    return (
      <MiniAppStatus>
        {ORG_MANAGER_LABELS.loadingOrganizationProfile}
      </MiniAppStatus>
    );
  }

  if (!canEdit) {
    return (
      <ProfileReadOnlyField
        label={ORG_MANAGER_LABELS.organizationName}
        value={name}
      />
    );
  }

  return (
    <div className="org-manager-roster-profile-fields">
      <MiniAppField className="org-manager-roster-profile-field">
        <span>{ORG_MANAGER_LABELS.organizationName}</span>
        <MiniAppInput
          value={localName}
          onBlur={() => {
            const nextName = localName.trim();
            if (nextName !== (name ?? "")) {
              void setStructuredFields(ORGANIZATION_PROFILE_DOCUMENT_KIND, {
                name: nextName,
              });
            }
          }}
          onChange={(event) => setLocalName(event.target.value)}
          onKeyDown={blurOnEnter}
        />
      </MiniAppField>
      {syncing && (
        <MiniAppStatus>
          {ORG_MANAGER_LABELS.syncingOrganizationProfile}
        </MiniAppStatus>
      )}
    </div>
  );
}

export function OrganizationProfileEditor({
  canEdit,
  onNameChange,
  organizationId,
  pending,
  profileDocumentId,
}: {
  canEdit: boolean;
  onNameChange: (name: string | null) => void;
  organizationId: string;
  // The organization data this editor derives its inputs from has not settled
  // yet. While that holds, an unresolved profile reads as loading: `canEdit` is
  // false merely because the directory has not landed, so the ensure below
  // legitimately resolves nothing.
  pending: boolean;
  profileDocumentId: string | null;
}) {
  const {
    ensureOrganizationMetadataContainer,
    ensureOrganizationProfileDocument,
  } = useOrgManagerActions();
  const [activeProfileDocumentId, setActiveProfileDocumentId] = useState<
    string | null
  >(profileDocumentId);
  const [profileContainerId, setProfileContainerId] = useState<string | null>(
    null,
  );
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const localId = getOrganizationProfileDocumentLocalId({ organizationId });

  useEffect(() => {
    let cancelled = false;
    setActiveProfileDocumentId(profileDocumentId);
    setProfileContainerId(null);
    setProfileUnavailable(false);

    const ensureDocument = profileDocumentId
      ? Promise.resolve(profileDocumentId)
      : canEdit
        ? ensureOrganizationProfileDocument(null)
        : Promise.resolve(null);

    void ensureDocument
      .then((documentId) => {
        if (cancelled) {
          return;
        }
        setActiveProfileDocumentId(documentId);
        if (!documentId) {
          setProfileUnavailable(true);
          return null;
        }

        // The organization profile document lives in the org-wide metadata
        // container (where provisioning creates it and where the Members group
        // has read), so bind the editor's store to that container rather than
        // the Admins-only roster-profile container.
        return ensureOrganizationMetadataContainer();
      })
      .then((container) => {
        if (cancelled || !container) {
          return;
        }
        setProfileContainerId(container.id);
      })
      .catch(() => {
        if (!cancelled) {
          setProfileUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `pending`: a managed refresh flips it while the
    // editor is mounted, and re-running here would clear the resolved container
    // and unmount the document store mid-edit. `pending` only decides which
    // message a still-unresolved editor shows.
  }, [
    canEdit,
    ensureOrganizationMetadataContainer,
    ensureOrganizationProfileDocument,
    profileDocumentId,
  ]);

  if (!activeProfileDocumentId || !profileContainerId) {
    return (
      <MiniAppStatus>
        {profileUnavailable && !pending
          ? ORG_MANAGER_LABELS.organizationProfileUnavailable
          : ORG_MANAGER_LABELS.loadingOrganizationProfile}
      </MiniAppStatus>
    );
  }

  return (
    <DocumentsProvider
      containerId={profileContainerId}
      documentId={activeProfileDocumentId}
      initialDocumentKind={ORGANIZATION_PROFILE_DOCUMENT_KIND}
      localId={localId}
    >
      <OrganizationProfileDocumentFields
        canEdit={canEdit}
        localId={localId}
        onNameChange={onNameChange}
        profileContainerId={profileContainerId}
        profileDocumentId={activeProfileDocumentId}
      />
    </DocumentsProvider>
  );
}
