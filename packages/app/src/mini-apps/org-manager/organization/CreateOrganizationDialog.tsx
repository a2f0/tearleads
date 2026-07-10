import { type FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";
import "./CreateOrganizationDialog.css";

export function CreateOrganizationDialog({
  closeCreateOrganizationDialog,
  createOrganization,
  creating,
  error,
  isOpen,
}: {
  closeCreateOrganizationDialog: () => void;
  createOrganization: (organizationName: string) => void;
  creating: boolean;
  error: string | null;
  isOpen: boolean;
}) {
  const [organizationNameDraft, setOrganizationNameDraft] = useState("");
  const [mounted, setMounted] = useState(false);
  const inputId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setOrganizationNameDraft("");
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const canCreate = !creating && organizationNameDraft.trim().length > 0;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    createOrganization(organizationNameDraft);
  };

  const dialog = (
    <MiniAppModalBackdrop
      className="org-manager-create-organization-dialog-backdrop"
      role="presentation"
    >
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="org-manager-new-organization-title"
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id="org-manager-new-organization-title">
            {ORG_MANAGER_LABELS.newOrganizationAction}
          </h2>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>
              {ORG_MANAGER_LABELS.organizationName}
            </label>
            <MiniAppInput
              id={inputId}
              aria-label={ORG_MANAGER_LABELS.organizationName}
              autoFocus
              disabled={creating}
              onChange={(event) => setOrganizationNameDraft(event.target.value)}
              value={organizationNameDraft}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton
              disabled={creating}
              onClick={closeCreateOrganizationDialog}
              type="button"
            >
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={!canCreate} type="submit">
              {creating
                ? ORG_MANAGER_LABELS.creatingOrganization
                : ORG_MANAGER_LABELS.create}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );

  if (!mounted) {
    return null;
  }

  return createPortal(dialog, document.body);
}
