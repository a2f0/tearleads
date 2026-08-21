import type { OrganizationContainerGrant } from "@symcrypt/client-sdk";
import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/mini-app/MiniAppTable";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
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
              <tr>
                <th>{ORG_MANAGER_LABELS.principal}</th>
                <td title={grant.subjectId}>{getGrantPrincipalLabel(grant)}</td>
              </tr>
              <tr>
                <th>{ORG_MANAGER_LABELS.container}</th>
                <td title={getContainerDisplayTitle(grant)}>
                  {getContainerDisplayLabel(grant)}
                </td>
              </tr>
              <tr>
                <th>{ORG_MANAGER_LABELS.access}</th>
                <td>{getAccessLabel(grant.accessLevel)}</td>
              </tr>
            </tbody>
          </MiniAppInfoTable>
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={busy} type="submit">
              {busy
                ? ORG_MANAGER_LABELS.revokingGrant
                : ORG_MANAGER_LABELS.revoke}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
