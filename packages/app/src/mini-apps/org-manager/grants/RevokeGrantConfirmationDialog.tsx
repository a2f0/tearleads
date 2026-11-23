import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalBusyOverlay,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/mini-app/MiniAppTable";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { ORG_MANAGER_BUSY_LABELS } from "./busyLabels";
import "./RevokeGrantConfirmationDialog.css";

export function RevokeGrantConfirmationDialog({
  busy,
  grant,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  grant: OrganizationContainerGrant | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  if (!grant) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    onConfirm();
  };

  return (
    <MiniAppModalBackdrop
      className="org-manager-revoke-grant-dialog-backdrop"
      role="presentation"
    >
      <MiniAppModalPanel
        role="dialog"
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>
            {ORG_MANAGER_LABELS.revokeGrantConfirmationTitle}
          </h2>
          <p className="org-manager-revoke-grant-warning" id={messageId}>
            {ORG_MANAGER_LABELS.revokeGrantConfirmationMessage}
          </p>
          <MiniAppInfoTable>
            <tbody>
              <MiniAppInfoRow
                label={ORG_MANAGER_LABELS.principal}
                title={grant.subjectId}
              >
                {getGrantPrincipalLabel(grant)}
              </MiniAppInfoRow>
              <MiniAppInfoRow
                label={ORG_MANAGER_LABELS.container}
                title={getContainerDisplayTitle(grant)}
              >
                {getContainerDisplayLabel(grant)}
              </MiniAppInfoRow>
              <MiniAppInfoRow label={ORG_MANAGER_LABELS.access}>
                {getAccessLabel(grant.accessLevel)}
              </MiniAppInfoRow>
            </tbody>
          </MiniAppInfoTable>
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={busy} type="submit">
              {ORG_MANAGER_LABELS.revoke}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
        {busy && (
          <MiniAppModalBusyOverlay
            description={ORG_MANAGER_BUSY_LABELS.revokingGrantDescription}
            label={ORG_MANAGER_BUSY_LABELS.revokingGrant}
          />
        )}
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
