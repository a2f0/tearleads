import type {
  DocumentStoreRelinkInput,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
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
import { useOrgManagerActions } from "../../stores/org-manager/OrgManagerProvider";
import {
  getRosterProfileDocumentLocalId,
  getRosterProfileDocumentPatch,
} from "../../stores/org-manager/profileDocuments";
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

export function getMissingProfileIdentityPatch(
  user: OrganizationDirectoryUser,
  structuredFields: Readonly<Record<string, string>>,
): Record<string, string | undefined> | null {
  const expectedPatch = getRosterProfileDocumentPatch(user);
  const missingPatch = Object.fromEntries(
    Object.entries(expectedPatch).filter(
      ([key]) => structuredFields[key] === undefined,
    ),
  );

  return Object.keys(missingPatch).length > 0 ? missingPatch : null;
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

function useRosterProfileDocumentLinkState(input: {
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
    if (
      !input.ready ||
      !input.documentId ||
      input.documentId !== input.userProfileDocumentId
    ) {
      return;
    }

    let cancelled = false;
    void input
      .relink(
        getRosterProfileDocumentRelinkInput({
          localId: input.localId,
          profileContainerId: input.profileContainerId,
          profileDocumentId: input.documentId,
        }),
      )
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setProfileLinkReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input]);

  return profileLinkReady;
}

function useRosterProfileIdentitySeed(input: {
  canEdit: boolean;
  profileLinkReady: boolean;
  ready: boolean;
  setStructuredFields: ReturnType<typeof useDocument>["setStructuredFields"];
  structuredFields: Readonly<Record<string, string>>;
  user: OrganizationDirectoryUser;
}): void {
  useEffect(() => {
    if (!input.canEdit || !input.ready || !input.profileLinkReady) {
      return;
    }

    const identityPatch = getMissingProfileIdentityPatch(
      input.user,
      input.structuredFields,
    );
    if (!identityPatch) {
      return;
    }

    void input.setStructuredFields("contact", identityPatch);
  }, [input]);
}

function RosterProfileDocumentFields({
  canEdit,
  localId,
  profileContainerId,
  user,
}: {
  canEdit: boolean;
  localId: string;
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
  const profileLinkReady = useRosterProfileDocumentLinkState(
    useMemo(
      () => ({
        documentId,
        localId,
        profileContainerId,
        ready,
        relink,
        userProfileDocumentId: user.profileDocumentId,
      }),
      [
        documentId,
        localId,
        profileContainerId,
        ready,
        relink,
        user.profileDocumentId,
      ],
    ),
  );
  const disabled = !canEdit || !ready || !profileLinkReady;

  useRosterProfileIdentitySeed(
    useMemo(
      () => ({
        canEdit,
        profileLinkReady,
        ready,
        setStructuredFields,
        structuredFields,
        user,
      }),
      [
        canEdit,
        profileLinkReady,
        ready,
        setStructuredFields,
        structuredFields,
        user,
      ],
    ),
  );

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
      {(!ready || !profileLinkReady) && (
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
  const { ensureRosterProfileContainer } = useOrgManagerActions();
  const [profileContainerId, setProfileContainerId] = useState<string | null>(
    null,
  );
  const localId = getRosterProfileDocumentLocalId({
    organizationId,
    userId: user.userId,
  });

  useEffect(() => {
    if (!user.profileDocumentId) {
      setProfileContainerId(null);
      return;
    }

    let cancelled = false;
    setProfileContainerId(null);
    void ensureRosterProfileContainer().then((container) => {
      if (!cancelled) {
        setProfileContainerId(container?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
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
      <MiniAppStatus>{ORG_MANAGER_LABELS.loadingProfileDocument}</MiniAppStatus>
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
        localId={localId}
        profileContainerId={profileContainerId}
        user={user}
      />
    </DocumentsProvider>
  );
}
