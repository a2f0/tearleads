import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { type FormEvent, useCallback, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalHighlight,
  MiniAppModalPanel,
  useModalEscapeAndFocusRestore,
} from "../../../components/mini-app/MiniAppLayout";
import { groupDisplayName, ORG_MANAGER_LABELS } from "../labels";
import { GROUP_LABELS } from "./groupLabels";

function DeleteGroupConfirmationDialogOpen({
  disabled,
  group,
  onCancel,
  onConfirm,
}: {
  disabled: boolean;
  group: OrganizationGroupSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const handleEscape = useCallback(() => {
    if (!disabled) {
      onCancel();
    }
  }, [disabled, onCancel]);
  useModalEscapeAndFocusRestore(handleEscape);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled) {
      onConfirm();
    }
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>{ORG_MANAGER_LABELS.deleteGroupAction}</h2>
          <p id={messageId}>
            {GROUP_LABELS.deleteConfirmationMessageLead}{" "}
            <MiniAppModalHighlight>
              {groupDisplayName(group)}
            </MiniAppModalHighlight>
            {GROUP_LABELS.deleteConfirmationMessageTail}
          </p>
          <MiniAppActions>
            <MiniAppButton autoFocus onClick={onCancel} type="button">
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={disabled} type="submit" variant="danger">
              {ORG_MANAGER_LABELS.deleteGroupAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

export function DeleteGroupConfirmationDialog({
  disabled,
  group,
  onCancel,
  onConfirm,
}: {
  disabled: boolean;
  group: OrganizationGroupSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!group) {
    return null;
  }

  return (
    <DeleteGroupConfirmationDialogOpen
      disabled={disabled}
      group={group}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
