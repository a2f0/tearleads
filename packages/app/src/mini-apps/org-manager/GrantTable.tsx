import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
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
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
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
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  const virtualGrants = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: grants,
  });

  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualGrants.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable aria-label={label} columns={GRANT_TABLE_COLUMNS}>
        <MiniAppVirtualTableSpacerRow
          colSpan={GRANT_TABLE_COLUMNS.length}
          height={virtualGrants.topPadding}
        />
        {virtualGrants.rows.map((grant) => {
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
                {grant.isBuiltin ? (
                  <MiniAppTableText>
                    {ORG_MANAGER_LABELS.builtIn}
                  </MiniAppTableText>
                ) : (
                  <MiniAppButton
                    block
                    disabled={!canRevokeGrant || mutating}
                    onClick={(event) => {
                      event.stopPropagation();
                      revokeGrant(grant);
                    }}
                    type="button"
                  >
                    {ORG_MANAGER_LABELS.revoke}
                  </MiniAppButton>
                )}
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={GRANT_TABLE_COLUMNS.length}
          height={virtualGrants.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
