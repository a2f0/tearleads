import { type FormEvent, useId, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalBusyOverlay,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import type { RosterProfileNames } from "../../../stores/org-manager/profileDocuments";
import { ORG_MANAGER_LABELS } from "../labels";

interface ImportRosterUserDialogProps {
  canImportRosterUser: boolean;
  closeImportUserDialog: () => void;
  error: string | null;
  importRosterUser: (names: RosterProfileNames) => void;
  importUserIdDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setImportUserIdDraft: (userId: string) => void;
}

export function ImportRosterUserDialog(props: ImportRosterUserDialogProps) {
  // Mounting the form per opening gives every opening empty name fields.
  return props.isOpen ? <ImportRosterUserForm {...props} /> : null;
}

function RosterNameField({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  return (
    <MiniAppField>
      <label htmlFor={inputId}>{label}</label>
      <MiniAppInput
        id={inputId}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      />
    </MiniAppField>
  );
}

function ImportRosterUserForm({
  canImportRosterUser,
  closeImportUserDialog,
  error,
  importRosterUser,
  importUserIdDraft,
  mutating,
  setImportUserIdDraft,
}: ImportRosterUserDialogProps) {
  const inputId = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const inputsDisabled = !canImportRosterUser || mutating;
  const canSubmit =
    !inputsDisabled &&
    importUserIdDraft.trim().length > 0 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    importRosterUser({ firstName, lastName });
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-busy={mutating}
        aria-labelledby="org-manager-import-user-title"
        aria-modal="true"
        className="org-manager-import-user-dialog"
        role="dialog"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id="org-manager-import-user-title">
            {ORG_MANAGER_LABELS.importUserAction}
          </h2>
          <MiniAppStatus>
            Ask the person for their identity link through a trusted channel.
            Their keys will be verified before they join the roster.
          </MiniAppStatus>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>Identity link</label>
            <MiniAppInput
              id={inputId}
              autoFocus
              disabled={inputsDisabled}
              onChange={(event) => setImportUserIdDraft(event.target.value)}
              placeholder="Paste the person's identity link"
              value={importUserIdDraft}
            />
          </MiniAppField>
          <div className="org-manager-import-user-names">
            <RosterNameField
              disabled={inputsDisabled}
              label={ORG_MANAGER_LABELS.firstName}
              onChange={setFirstName}
              value={firstName}
            />
            <RosterNameField
              disabled={inputsDisabled}
              label={ORG_MANAGER_LABELS.lastName}
              onChange={setLastName}
              value={lastName}
            />
          </div>
          <MiniAppStatus>
            {ORG_MANAGER_LABELS.importUserNamesNote}
          </MiniAppStatus>
          <MiniAppActions>
            <MiniAppButton
              disabled={mutating}
              onClick={closeImportUserDialog}
              type="button"
            >
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={!canSubmit} type="submit">
              {ORG_MANAGER_LABELS.importUserSubmitAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
        {mutating && (
          <MiniAppModalBusyOverlay label={ORG_MANAGER_LABELS.importUserBusy} />
        )}
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
