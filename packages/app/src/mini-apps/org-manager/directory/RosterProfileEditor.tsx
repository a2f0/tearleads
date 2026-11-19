import {
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  MiniAppField,
  MiniAppInput,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { readContactFields } from "../../../document-types/contact/contactDocumentModel";
import {
  DocumentsProvider,
  useDocument,
} from "../../../stores/documents/DocumentsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  getRosterProfileDisplayName,
  getRosterProfileDocumentRelinkInput,
} from "../../../stores/org-manager/profileDocuments";
import { ORG_MANAGER_LABELS } from "../labels";
import { useProfileDocumentBinding } from "../profile/profileDocumentBinding";
import {
  blurOnEnter,
  ProfileReadOnlyField,
  useProfileDocumentLink,
} from "../profile/profileDocumentEditor";

const ROSTER_NAME_FIELDS = ["nickname", "firstName", "lastName"] as const;

// Adopts a changed stored value during render. An effect would also run after
// mount, once the field is already painted and editable, and replace a first
// keystroke typed before it with the value the draft started from.
function useSyncedFieldValue(value: string | null | undefined) {
  const normalizedValue = value ?? "";
  const [syncedValue, setSyncedValue] = useState(normalizedValue);
  const [localValue, setLocalValue] = useState(normalizedValue);

  if (syncedValue !== normalizedValue) {
    setSyncedValue(normalizedValue);
    setLocalValue(normalizedValue);
  }

  return [localValue, setLocalValue] as const;
}

function RosterProfileTextField({
  disabled,
  label,
  onCommit,
  value,
}: {
  disabled: boolean;
  label: string;
  onCommit: (value: string) => void;
  value: string | null | undefined;
}) {
  const committedValue = value ?? "";
  const [localValue, setLocalValue] = useSyncedFieldValue(value);

  return (
    <MiniAppField className="org-manager-roster-profile-field">
      <span>{label}</span>
      <MiniAppInput
        disabled={disabled}
        value={localValue}
        onBlur={() => {
          if (!disabled && localValue !== committedValue) {
            onCommit(localValue);
          }
        }}
        onChange={(event) => setLocalValue(event.target.value)}
        onKeyDown={blurOnEnter}
      />
    </MiniAppField>
  );
}

function RosterProfileDocumentFields({
  canEdit,
  isEditing,
  localId,
  onDisplayNameChange,
  profileContainerId,
  user,
}: {
  canEdit: boolean;
  isEditing: boolean;
  localId: string;
  onDisplayNameChange?: ((displayName: string | null) => void) | undefined;
  profileContainerId: string;
  user: OrganizationDirectoryUser;
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
  const fields = useMemo(
    () => readContactFields(structuredFields),
    [structuredFields],
  );
  const relinkInput = useMemo(
    () =>
      user.profileDocumentId
        ? getRosterProfileDocumentRelinkInput({
            localId,
            profileContainerId,
            profileDocumentId: user.profileDocumentId,
          })
        : null,
    [localId, profileContainerId, user.profileDocumentId],
  );
  const { linkFailed, linkReady: profileLinkReady } = useProfileDocumentLink({
    documentId,
    profileDocumentId: user.profileDocumentId,
    ready,
    relink,
    relinkInput,
  });
  const canEditFields = canEdit && isEditing;
  const disabled = !canEditFields || !canWrite || !ready || !profileLinkReady;

  useEffect(() => {
    if (!ready || !profileLinkReady) {
      return;
    }

    onDisplayNameChange?.(getRosterProfileDisplayName(fields));
  }, [fields, onDisplayNameChange, profileLinkReady, ready]);

  return (
    <div className="org-manager-roster-profile">
      {linkFailed ? (
        <MiniAppStatus>
          {ORG_MANAGER_LABELS.profileDocumentUnavailable}
        </MiniAppStatus>
      ) : !ready || !profileLinkReady ? (
        <MiniAppStatePanel
          busy
          title={ORG_MANAGER_LABELS.loadingProfileDocument}
        />
      ) : canEditFields ? (
        <div className="org-manager-roster-profile-fields">
          {ROSTER_NAME_FIELDS.map((field) => (
            <RosterProfileTextField
              key={field}
              disabled={disabled}
              label={ORG_MANAGER_LABELS[field]}
              value={fields[field]}
              onCommit={(value) => {
                void setStructuredFields("contact", { [field]: value });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="org-manager-roster-profile-read-fields">
          {ROSTER_NAME_FIELDS.map((field) => (
            <ProfileReadOnlyField
              key={field}
              label={ORG_MANAGER_LABELS[field]}
              value={fields[field]}
            />
          ))}
        </div>
      )}
      {profileLinkReady && syncing && (
        <MiniAppStatePanel
          busy
          className="org-manager-profile-cover"
          title={ORG_MANAGER_LABELS.syncingProfileDocument}
        />
      )}
    </div>
  );
}

export function RosterProfileEditor({
  canEdit,
  isEditing = false,
  onDisplayNameChange,
  organizationId,
  user,
}: {
  canEdit: boolean;
  isEditing?: boolean | undefined;
  onDisplayNameChange?: ((displayName: string | null) => void) | undefined;
  organizationId: string;
  user: OrganizationDirectoryUser;
}) {
  const { ensureRosterProfileContainer } = useOrgManagerActions();
  const preferredLocalId = getRosterProfileDocumentLocalId({
    organizationId,
    userId: user.userId,
  });
  const binding = useProfileDocumentBinding({
    documentId: user.profileDocumentId,
    ensureContainer: ensureRosterProfileContainer,
    organizationId,
    preferredLocalId,
    retryContainer: true,
  });

  if (!user.profileDocumentId) {
    return canEdit ? (
      <MiniAppStatePanel
        busy
        title={ORG_MANAGER_LABELS.loadingProfileDocument}
      />
    ) : (
      <MiniAppStatus>
        {ORG_MANAGER_LABELS.profileDocumentUnavailable}
      </MiniAppStatus>
    );
  }

  if (binding.status !== "ready") {
    return binding.status === "unavailable" ? (
      <MiniAppStatus>
        {ORG_MANAGER_LABELS.profileDocumentUnavailable}
      </MiniAppStatus>
    ) : (
      <MiniAppStatePanel
        busy
        title={ORG_MANAGER_LABELS.loadingProfileDocument}
      />
    );
  }

  return (
    <DocumentsProvider
      containerId={binding.value.containerId}
      documentId={binding.value.documentId}
      initialDocumentKind="contact"
      localId={binding.value.localId}
      readOnly={!canEdit || !isEditing}
    >
      <RosterProfileDocumentFields
        canEdit={canEdit}
        isEditing={isEditing}
        localId={binding.value.localId}
        onDisplayNameChange={onDisplayNameChange}
        profileContainerId={binding.value.containerId}
        user={user}
      />
    </DocumentsProvider>
  );
}
