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
import { ORG_MANAGER_LABELS } from "../labels";
import { useProfileDocumentBinding } from "../profile/profileDocumentBinding";
import {
  blurOnEnter,
  ProfileReadOnlyField,
  useProfileDocumentLink,
} from "../profile/profileDocumentEditor";

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
    canWrite,
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
          disabled={!canWrite}
          value={localName}
          onBlur={() => {
            const nextName = localName.trim();
            if (canWrite && nextName !== (name ?? "")) {
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
  const binding = useProfileDocumentBinding({
    documentId: profileDocumentId,
    // Metadata is readable by Members; the roster-profile container is not.
    ensureContainer: ensureOrganizationMetadataContainer,
    ensureDocument:
      !profileDocumentId && canEdit
        ? ensureOrganizationProfileDocument
        : undefined,
    organizationId,
    preferredLocalId: getOrganizationProfileDocumentLocalId({ organizationId }),
  });

  // `pending` only affects unresolved messaging. A managed refresh must not
  // unmount a ready document provider and discard an uncommitted name draft.
  if (binding.status !== "ready") {
    return (
      <MiniAppStatus>
        {binding.status === "unavailable" && !pending
          ? ORG_MANAGER_LABELS.organizationProfileUnavailable
          : ORG_MANAGER_LABELS.loadingOrganizationProfile}
      </MiniAppStatus>
    );
  }

  return (
    <DocumentsProvider
      containerId={binding.value.containerId}
      documentId={binding.value.documentId}
      initialDocumentKind={ORGANIZATION_PROFILE_DOCUMENT_KIND}
      localId={binding.value.localId}
      readOnly={!canEdit}
    >
      <OrganizationProfileDocumentFields
        canEdit={canEdit}
        localId={binding.value.localId}
        onNameChange={onNameChange}
        profileContainerId={binding.value.containerId}
        profileDocumentId={binding.value.documentId}
      />
    </DocumentsProvider>
  );
}
