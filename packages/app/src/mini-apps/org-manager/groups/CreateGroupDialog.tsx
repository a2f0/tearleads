import { type FormEvent, useId } from "react";
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
import { ORG_MANAGER_BUSY_LABELS } from "../grants/busyLabels";
import { ORG_MANAGER_LABELS } from "../labels";

export function CreateGroupDialog({
  canCreateGroup,
  closeCreateGroupDialog,
  createGroup,
  error,
  groupNameDraft,
  isOpen,
  mutating,
  setGroupNameDraft,
}: {
  canCreateGroup: boolean;
  closeCreateGroupDialog: () => void;
  createGroup: () => void;
  error: string | null;
  groupNameDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setGroupNameDraft: (groupName: string) => void;
}) {
  const inputId = useId();
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateGroup || mutating || groupNameDraft.trim().length === 0) {
      return;
    }

    createGroup();
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>{ORG_MANAGER_LABELS.newGroupAction}</h2>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>{ORG_MANAGER_LABELS.groupName}</label>
            <MiniAppInput
              id={inputId}
              aria-label={ORG_MANAGER_LABELS.groupName}
              autoFocus
              disabled={!canCreateGroup || mutating}
              onChange={(event) => setGroupNameDraft(event.target.value)}
              value={groupNameDraft}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton disabled={mutating} onClick={closeCreateGroupDialog}>
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton
              disabled={
                !canCreateGroup ||
                mutating ||
                groupNameDraft.trim().length === 0
              }
              type="submit"
            >
              {ORG_MANAGER_LABELS.create}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
        {mutating && (
          <MiniAppModalBusyOverlay
            description={ORG_MANAGER_BUSY_LABELS.creatingGroupDescription}
            label={ORG_MANAGER_BUSY_LABELS.creatingGroup}
          />
        )}
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
