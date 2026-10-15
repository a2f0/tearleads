import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { useWindowTitleBarAction } from "@tearleads/windowing";
import { type ReactNode, useMemo } from "react";
import {
  MiniAppField,
  MiniAppFormPanel,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { CONTACTS_LABELS } from "../labels";

export function ContactsImportContactPanel(params: {
  error?: string | null | undefined;
  signInAction?: ReactNode;
  canImport: boolean;
  draftUserId: string;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  setDraftUserId: (userId: string) => void;
}) {
  const {
    canImport,
    draftUserId,
    importDraftContact,
    isAuthenticated,
    setDraftUserId,
  } = params;
  const importAction = useMemo(
    () => ({
      disabled: !canImport,
      icon: <AddressBookIcon aria-hidden size={18} />,
      id: "contacts-import-contact-submit",
      label: CONTACTS_LABELS.importContactSubmitAction,
      onClick: importDraftContact,
      priority: 100,
    }),
    [canImport, importDraftContact],
  );

  useWindowTitleBarAction(importAction);

  return (
    <MiniAppFormPanel
      onSubmit={(event) => {
        event.preventDefault();
        void importDraftContact();
      }}
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{CONTACTS_LABELS.importContactAction}</strong>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <MiniAppStatus>
        Ask the person for their identity link through a trusted channel.
      </MiniAppStatus>
      {params.error && (
        <MiniAppStatus role="alert" tone="error">
          {params.error}
        </MiniAppStatus>
      )}
      <MiniAppField>
        <span>{CONTACTS_LABELS.contactUserIdField}</span>
        <MiniAppInput
          aria-label={CONTACTS_LABELS.contactUserIdField}
          value={draftUserId}
          onChange={(event) => setDraftUserId(event.target.value)}
          placeholder={CONTACTS_LABELS.userIdPlaceholder}
        />
      </MiniAppField>
      {!isAuthenticated && (
        <>
          <MiniAppStatus>
            {CONTACTS_LABELS.unauthenticatedImportState}
          </MiniAppStatus>
          {params.signInAction}
        </>
      )}
    </MiniAppFormPanel>
  );
}
