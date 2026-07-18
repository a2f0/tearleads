import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";

export function ImportRosterUserDialog({
  canImportRosterUser,
  closeImportUserDialog,
  error,
  importRosterUser,
  importUserIdDraft,
  isOpen,
  mutating,
  setImportUserIdDraft,
}: {
  canImportRosterUser: boolean;
  closeImportUserDialog: () => void;
  error: string | null;
  importRosterUser: () => void;
  importUserIdDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setImportUserIdDraft: (userId: string) => void;
}) {
  const inputId = useId();

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !canImportRosterUser ||
      mutating ||
      importUserIdDraft.trim().length === 0
    ) {
      return;
    }

    importRosterUser();
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="org-manager-import-user-title"
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id="org-manager-import-user-title">
            {ORG_MANAGER_LABELS.importUserAction}
          </h2>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>{ORG_MANAGER_LABELS.userId}</label>
            <MiniAppInput
              id={inputId}
              autoFocus
              disabled={!canImportRosterUser || mutating}
              onChange={(event) => setImportUserIdDraft(event.target.value)}
              placeholder={ORG_MANAGER_LABELS.userId}
              value={importUserIdDraft}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton
              disabled={mutating}
              onClick={closeImportUserDialog}
              type="button"
            >
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton
              disabled={
                !canImportRosterUser ||
                mutating ||
                importUserIdDraft.trim().length === 0
              }
              type="submit"
            >
              {ORG_MANAGER_LABELS.importUserSubmitAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
