import {
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  readOrganizationProfileName,
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
import {
  DocumentsProvider,
  useDocument,
} from "../../../stores/documents/DocumentsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
}

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
  const [profileLinkReady, setProfileLinkReady] = useState(false);
  const [relinkFailed, setRelinkFailed] = useState(false);
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

  useEffect(() => {
    setProfileLinkReady(false);
    setRelinkFailed(false);
    if (!ready || !documentId || documentId !== profileDocumentId) {
      return;
    }

    let cancelled = false;
    void relink({
      accessEpoch: 1,
      containerId: profileContainerId,
      documentId: profileDocumentId,
      localId,
    })
      .then((result) => {
        if (!cancelled && result !== null) {
          setProfileLinkReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRelinkFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    documentId,
    localId,
    profileContainerId,
    profileDocumentId,
    ready,
    relink,
  ]);

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
      <MiniAppRow className="org-manager-roster-row" density="roomy">
        <MiniAppRowStack>
          <strong>{ORG_MANAGER_LABELS.organizationName}</strong>
          <MiniAppRowText muted title={name ?? undefined}>
            {name ?? ORG_MANAGER_LABELS.none}
          </MiniAppRowText>
        </MiniAppRowStack>
      </MiniAppRow>
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
  profileDocumentId,
}: {
  canEdit: boolean;
  onNameChange: (name: string | null) => void;
  organizationId: string;
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
  }, [
    canEdit,
    ensureOrganizationMetadataContainer,
    ensureOrganizationProfileDocument,
    profileDocumentId,
  ]);

  if (!activeProfileDocumentId || !profileContainerId) {
    return (
      <MiniAppStatus>
        {profileUnavailable
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
