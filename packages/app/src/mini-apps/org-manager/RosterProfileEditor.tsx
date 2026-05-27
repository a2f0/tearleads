import type { OrganizationDirectoryUser } from "@tearleads/client-sdk";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import { readContactFields } from "../../document-types/contact/contactDocumentModel";
import {
  DocumentsProvider,
  useDocument,
} from "../../stores/documents/DocumentsProvider";
import { getRosterProfileDocumentLocalId } from "../../stores/org-manager/profileDocuments";
import { ORG_MANAGER_LABELS } from "./labels";

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

function RosterProfileDocumentFields({ canEdit }: { canEdit: boolean }) {
  const { ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const fields = useMemo(
    () => readContactFields(structuredFields),
    [structuredFields],
  );
  const disabled = !canEdit || !ready;

  return (
    <div className="org-manager-roster-profile">
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
      {!ready && (
        <MiniAppStatus>
          {ORG_MANAGER_LABELS.loadingProfileDocument}
        </MiniAppStatus>
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
  organizationId,
  user,
}: {
  canEdit: boolean;
  organizationId: string;
  user: OrganizationDirectoryUser;
}) {
  if (!user.profileDocumentId) {
    return (
      <MiniAppStatus>
        {canEdit
          ? ORG_MANAGER_LABELS.loadingProfileDocument
          : ORG_MANAGER_LABELS.profileDocumentUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <DocumentsProvider
      documentId={user.profileDocumentId}
      initialDocumentKind="contact"
      localId={getRosterProfileDocumentLocalId({
        organizationId,
        userId: user.userId,
      })}
    >
      <RosterProfileDocumentFields canEdit={canEdit} />
    </DocumentsProvider>
  );
}
