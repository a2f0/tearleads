import {
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@symcrypt/client-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  MiniAppField,
  MiniAppInput,
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
import { createBoundedRetrySchedule } from "../hooks/boundedRetry";
import {
  blurOnEnter,
  ProfileReadOnlyField,
  useProfileDocumentLink,
} from "../hooks/profileDocumentEditor";
import { ORG_MANAGER_LABELS } from "../labels";

function useSyncedFieldValue(value: string | null | undefined) {
  const normalizedValue = value ?? "";
  const [localValue, setLocalValue] = useState(normalizedValue);

  useEffect(() => {
    setLocalValue(normalizedValue);
  }, [normalizedValue]);

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
          if (localValue !== committedValue) {
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
  const { linkReady: profileLinkReady } = useProfileDocumentLink({
    documentId,
    profileDocumentId: user.profileDocumentId,
    ready,
    relink,
    relinkInput,
  });
  const canEditFields = canEdit && isEditing;
  const disabled = !canEditFields || !ready || !profileLinkReady;

  useEffect(() => {
    if (!ready || !profileLinkReady) {
      return;
    }

    onDisplayNameChange?.(getRosterProfileDisplayName(fields));
  }, [fields, onDisplayNameChange, profileLinkReady, ready]);

  return (
    <div className="org-manager-roster-profile">
      {!ready || !profileLinkReady ? (
        <MiniAppStatus>
          {ORG_MANAGER_LABELS.loadingProfileDocument}
        </MiniAppStatus>
      ) : canEditFields ? (
        <div className="org-manager-roster-profile-fields">
          <RosterProfileTextField
            disabled={disabled}
            label={ORG_MANAGER_LABELS.nickname}
            value={fields.nickname}
            onCommit={(nickname) => {
              void setStructuredFields("contact", { nickname });
            }}
          />
          <RosterProfileTextField
            disabled={disabled}
            label={ORG_MANAGER_LABELS.firstName}
            value={fields.firstName}
            onCommit={(firstName) => {
              void setStructuredFields("contact", { firstName });
            }}
          />
          <RosterProfileTextField
            disabled={disabled}
            label={ORG_MANAGER_LABELS.lastName}
            value={fields.lastName}
            onCommit={(lastName) => {
              void setStructuredFields("contact", { lastName });
            }}
          />
        </div>
      ) : (
        <div className="org-manager-roster-profile-read-fields">
          <ProfileReadOnlyField
            label={ORG_MANAGER_LABELS.nickname}
            value={fields.nickname}
          />
          <ProfileReadOnlyField
            label={ORG_MANAGER_LABELS.firstName}
            value={fields.firstName}
          />
          <ProfileReadOnlyField
            label={ORG_MANAGER_LABELS.lastName}
            value={fields.lastName}
          />
        </div>
      )}
      {ready && syncing && (
        <MiniAppStatus>
          {ORG_MANAGER_LABELS.syncingProfileDocument}
        </MiniAppStatus>
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
  const [profileContainerId, setProfileContainerId] = useState<string | null>(
    null,
  );
  const [profileContainerUnavailable, setProfileContainerUnavailable] =
    useState(false);
  const localId = getRosterProfileDocumentLocalId({
    organizationId,
    userId: user.userId,
  });

  useEffect(() => {
    setProfileContainerId(null);
    setProfileContainerUnavailable(false);
    if (!user.profileDocumentId) {
      return;
    }

    // A null container is ambiguous: usually the org-manager operation scope is
    // not active yet (session, database, or organization still settling), but it
    // can also be a container-contents snapshot that never arrives or a create
    // that failed. Reporting the first null as unavailable showed an error for
    // what is normally a startup race; never reporting it would strand the
    // editor on "Loading" forever, since nothing else re-runs this effect. Retry
    // on the shared bounded schedule, then say it is unavailable.
    const retry = createBoundedRetrySchedule(attempt);
    function attempt() {
      void ensureRosterProfileContainer()
        .then((container) => {
          if (retry.cancelled) {
            return;
          }
          if (container?.id) {
            setProfileContainerId(container.id);
            return;
          }
          if (retry.exhausted) {
            setProfileContainerUnavailable(true);
            return;
          }

          retry.scheduleNext();
        })
        .catch(() => {
          if (!retry.cancelled) {
            setProfileContainerUnavailable(true);
          }
        });
    }
    attempt();

    return () => retry.cancel();
  }, [ensureRosterProfileContainer, user.profileDocumentId]);

  if (!user.profileDocumentId) {
    return (
      <MiniAppStatus>
        {canEdit
          ? ORG_MANAGER_LABELS.loadingProfileDocument
          : ORG_MANAGER_LABELS.profileDocumentUnavailable}
      </MiniAppStatus>
    );
  }

  if (!profileContainerId) {
    return (
      <MiniAppStatus>
        {profileContainerUnavailable
          ? ORG_MANAGER_LABELS.profileDocumentUnavailable
          : ORG_MANAGER_LABELS.loadingProfileDocument}
      </MiniAppStatus>
    );
  }

  return (
    <DocumentsProvider
      containerId={profileContainerId}
      documentId={user.profileDocumentId}
      initialDocumentKind="contact"
      localId={localId}
    >
      <RosterProfileDocumentFields
        canEdit={canEdit}
        isEditing={isEditing}
        localId={localId}
        onDisplayNameChange={onDisplayNameChange}
        profileContainerId={profileContainerId}
        user={user}
      />
    </DocumentsProvider>
  );
}
