import {
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
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

// Matches the org switcher's index catch-up: ~20s of retries before the editor
// concludes the container is genuinely unavailable.
const ROSTER_PROFILE_CONTAINER_RETRY_DELAY_MS = 500;
const ROSTER_PROFILE_CONTAINER_RETRY_LIMIT = 40;

export {
  getRosterProfileDisplayName,
  getRosterProfileDocumentRelinkInput,
} from "../../../stores/org-manager/profileDocuments";

function useSyncedFieldValue(value: string | null | undefined) {
  const normalizedValue = value ?? "";
  const [localValue, setLocalValue] = useState(normalizedValue);

  useEffect(() => {
    setLocalValue(normalizedValue);
  }, [normalizedValue]);

  return [localValue, setLocalValue] as const;
}

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
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

function getRosterProfileReadValue(value: string | null | undefined): string {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 ? normalizedValue : ORG_MANAGER_LABELS.none;
}

function RosterProfileReadField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <MiniAppRow className="org-manager-roster-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted title={value ?? undefined}>
          {getRosterProfileReadValue(value)}
        </MiniAppRowText>
      </MiniAppRowStack>
    </MiniAppRow>
  );
}

function useRosterProfileDocumentLinkState({
  documentId,
  localId,
  profileContainerId,
  ready,
  relink,
  userProfileDocumentId,
}: {
  documentId: string | null;
  localId: string;
  profileContainerId: string;
  ready: boolean;
  relink: ReturnType<typeof useDocument>["relink"];
  userProfileDocumentId: string | null;
}): boolean {
  const [profileLinkReady, setProfileLinkReady] = useState(false);

  useEffect(() => {
    setProfileLinkReady(false);
    if (!ready || !documentId || documentId !== userProfileDocumentId) {
      return;
    }

    let cancelled = false;
    void relink(
      getRosterProfileDocumentRelinkInput({
        localId,
        profileContainerId,
        profileDocumentId: documentId,
      }),
    )
      .then((result) => {
        if (!cancelled && result !== null) {
          setProfileLinkReady(true);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [
    documentId,
    localId,
    profileContainerId,
    ready,
    relink,
    userProfileDocumentId,
  ]);

  return profileLinkReady;
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
  const profileLinkReady = useRosterProfileDocumentLinkState({
    documentId,
    localId,
    profileContainerId,
    ready,
    relink,
    userProfileDocumentId: user.profileDocumentId,
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
          <RosterProfileReadField
            label={ORG_MANAGER_LABELS.nickname}
            value={fields.nickname}
          />
          <RosterProfileReadField
            label={ORG_MANAGER_LABELS.firstName}
            value={fields.firstName}
          />
          <RosterProfileReadField
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
    if (!user.profileDocumentId) {
      setProfileContainerId(null);
      setProfileContainerUnavailable(false);
      return;
    }

    let attempts = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setProfileContainerId(null);
    setProfileContainerUnavailable(false);

    // A null container is ambiguous: usually the org-manager operation scope is
    // not active yet (session, database, or organization still settling), but it
    // can also be a container-contents snapshot that never arrives or a create
    // that failed. Reporting the first null as unavailable showed an error for
    // what is normally a startup race; never reporting it would strand the
    // editor on "Loading" forever, since nothing else re-runs this effect. Retry
    // on a bounded schedule, then say it is unavailable.
    const attempt = () => {
      void ensureRosterProfileContainer()
        .then((container) => {
          if (cancelled) {
            return;
          }
          if (container?.id) {
            setProfileContainerId(container.id);
            return;
          }
          if (attempts >= ROSTER_PROFILE_CONTAINER_RETRY_LIMIT) {
            setProfileContainerUnavailable(true);
            return;
          }

          attempts += 1;
          timer = setTimeout(attempt, ROSTER_PROFILE_CONTAINER_RETRY_DELAY_MS);
        })
        .catch(() => {
          if (!cancelled) {
            setProfileContainerUnavailable(true);
          }
        });
    };
    attempt();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
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
