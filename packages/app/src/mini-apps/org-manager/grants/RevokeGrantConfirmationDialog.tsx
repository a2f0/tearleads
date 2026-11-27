import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { type FormEvent, useCallback, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalBusyOverlay,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
  useModalEscapeAndFocusRestore,
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

function RevokeGrantConfirmationDialogOpen({
  busy,
  grant,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  grant: OrganizationContainerGrant;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const handleEscape = useCallback(() => {
    if (!busy) {
      onCancel();
    }
  }, [busy, onCancel]);
  useModalEscapeAndFocusRestore(handleEscape);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    onConfirm();
  };

  return (
    <MiniAppModalBackdrop layer="raised" role="presentation">
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
          <MiniAppStatus id={messageId} tone="error">
            {ORG_MANAGER_LABELS.revokeGrantConfirmationMessage}
          </MiniAppStatus>
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
            <MiniAppButton disabled={busy} type="submit" variant="danger">
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
  if (!grant) {
    return null;
  }

  return (
    <RevokeGrantConfirmationDialogOpen
      busy={busy}
      grant={grant}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
