import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { OrganizationContainerGrant } from "@symcrypt/client-sdk";
import type { MouseEvent, ReactNode } from "react";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import { useContextMenuState } from "../../../components/shared/useContextMenuState";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";

interface GrantContextMenuActions {
  canRevokeGrants: boolean;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}

function GrantContextMenu({
  canRevokeGrants,
  closeContextMenu,
  grant,
  mutating,
  openGrantRoute,
  position,
  revokeGrant,
}: GrantContextMenuActions & {
  closeContextMenu: () => void;
  grant: OrganizationContainerGrant | null;
  position: MenuPosition | null;
}) {
  if (!position || !grant) {
    return null;
  }

  const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
  const handleOpen = () => {
    closeContextMenu();
    openGrantRoute({
      containerId: grant.containerId,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    });
  };
  const handleRevoke = () => {
    closeContextMenu();
    revokeGrant(grant);
  };

  return (
    <Menu direction="down" onClose={closeContextMenu} position={position}>
      <MenuItem
        icon={EyeIcon}
        label={ORG_MANAGER_LABELS.open}
        onClick={handleOpen}
      />
      <MenuItem
        disabled={!canRevokeGrant || mutating}
        icon={TrashIcon}
        label={ORG_MANAGER_LABELS.revoke}
        onClick={handleRevoke}
      />
    </Menu>
  );
}

/**
 * Shared grant row overflow menu (Open / Revoke) wiring. The grant tables reuse
 * this so a touch kebab and a right-click / long-press open the same actions.
 * Returns the handler to hand each `GrantTable` plus the rendered menu node to
 * drop once into the surrounding view.
 */
export function useGrantContextMenu(actions: GrantContextMenuActions): {
  grantContextMenu: ReactNode;
  openGrantContextMenu: (
    event: MouseEvent<HTMLElement>,
    grant: OrganizationContainerGrant,
  ) => void;
} {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<OrganizationContainerGrant>();

  return {
    grantContextMenu: (
      <GrantContextMenu
        canRevokeGrants={actions.canRevokeGrants}
        closeContextMenu={closeContextMenu}
        grant={contextMenu?.id ?? null}
        mutating={actions.mutating}
        openGrantRoute={actions.openGrantRoute}
        position={contextMenu?.position ?? null}
        revokeGrant={actions.revokeGrant}
      />
    ),
    openGrantContextMenu: openContextMenu,
  };
}
