import type { KeyboardEvent } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import type { OrgManagerContainerGrant } from "../../stores/org-manager/OrgManagerProvider";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
  isKeyboardActivationKey,
} from "./display";
import { ORG_MANAGER_LABELS } from "./labels";

const GRANT_TABLE_COLUMNS = [
  {
    id: "principal",
    header: ORG_MANAGER_LABELS.principal,
    width: "34%",
  },
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "34%",
  },
  {
    id: "access",
    header: ORG_MANAGER_LABELS.access,
    width: "7rem",
  },
  {
    className: "org-manager-container-updated-column",
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
  {
    id: "action",
    header: ORG_MANAGER_LABELS.action,
    width: "6rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

export function GrantTable({
  canRevokeGrants,
  emptyLabel,
  grants,
  label,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  emptyLabel: string;
  grants: ReadonlyArray<OrgManagerContainerGrant>;
  label: string;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
}) {
  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label={label} columns={GRANT_TABLE_COLUMNS}>
        {grants.map((grant) => {
          const isGroupGrant = grant.subjectType === "group";
          const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
          const openGrantGroupRoute = () => {
            openGroupRoute(grant.subjectId);
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGrantGroupRoute();
            }
          };

          return (
            <MiniAppTableRow
              interactive={isGroupGrant}
              key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
              onClick={isGroupGrant ? openGrantGroupRoute : undefined}
              onKeyDown={isGroupGrant ? handleGrantRowKeyDown : undefined}
              tabIndex={isGroupGrant ? 0 : undefined}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={grant.subjectId}>
                  {getGrantPrincipalLabel(grant)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText title={getContainerDisplayTitle(grant)}>
                  {getContainerDisplayLabel(grant)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {getAccessLabel(grant.accessLevel)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-container-updated-column">
                <MiniAppTableText title={grant.updatedAt}>
                  {formatMiniAppDate(grant.updatedAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppButton
                  block
                  className="org-manager-grant-revoke-button"
                  disabled={!canRevokeGrant || mutating}
                  onClick={(event) => {
                    event.stopPropagation();
                    revokeGrant(grant);
                  }}
                  type="button"
                >
                  {grant.isBuiltin
                    ? ORG_MANAGER_LABELS.builtIn
                    : ORG_MANAGER_LABELS.revoke}
                </MiniAppButton>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
