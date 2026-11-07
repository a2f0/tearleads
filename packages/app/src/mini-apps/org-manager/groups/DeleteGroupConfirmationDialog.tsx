import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";
import { GROUP_LABELS } from "./groupLabels";

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
  const titleId = useId();
  const messageId = useId();

  if (!group) {
    return null;
  }

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
            {GROUP_LABELS.deleteConfirmationMessage(group.name)}
          </p>
          <MiniAppActions>
            <MiniAppButton autoFocus onClick={onCancel} type="button">
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={disabled} type="submit">
              {ORG_MANAGER_LABELS.deleteGroupAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
