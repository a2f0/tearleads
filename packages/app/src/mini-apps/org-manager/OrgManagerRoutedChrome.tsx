import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useMemo } from "react";
import {
  useWindowTitleBarAction,
  useWindowToolbarReservation,
} from "../../components/window/WindowMenuContext";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

/**
 * Registers org-manager's window toolbar chrome. The actions are contextual —
 * "New Group" appears only on the groups route and "Import User" only on the
 * directory route (the roster surface where importing happens). Every other
 * route (grants, organization, usage, billing) carries no action, so the
 * reserved row renders blank rather than collapsing, matching explorer.
 *
 * These mirror the same-named File-menu items registered in {@link OrgManager};
 * the menu items stay global, the toolbar buttons are route-scoped.
 */
export function useOrgManagerRoutedChromeActions({
  canCreateGroup,
  canImportRosterUser,
  canLoadAuthenticatedOrgData,
  loading,
  mutating,
  openCreateGroupDialog,
  openImportUserDialog,
  view,
}: {
  canCreateGroup: boolean;
  canImportRosterUser: boolean;
  canLoadAuthenticatedOrgData: boolean;
  loading: boolean;
  mutating: boolean;
  openCreateGroupDialog: () => void;
  openImportUserDialog: () => void;
  view: OrgManagerView;
}) {
  // Reserve the toolbar row on every authenticated route, blank where the route
  // has no action. Gated on canLoadAuthenticatedOrgData so the pre-auth
  // "authenticate" hint (which OrgManager renders before its early return, with
  // no menu items either) does not carry a lone empty bar.
  useWindowToolbarReservation(canLoadAuthenticatedOrgData);

  const showNewGroup = canLoadAuthenticatedOrgData && view === "groups";
  const newGroupAction = useMemo(
    () =>
      showNewGroup
        ? {
            disabled: !canCreateGroup || loading || mutating,
            icon: <UsersThreeIcon aria-hidden size={18} />,
            id: "org-manager-new-group-toolbar",
            label: ORG_MANAGER_LABELS.newGroupAction,
            onClick: openCreateGroupDialog,
            priority: 100,
          }
        : null,
    [canCreateGroup, loading, mutating, openCreateGroupDialog, showNewGroup],
  );

  const showImportUser = canLoadAuthenticatedOrgData && view === "directory";
  const importUserAction = useMemo(
    () =>
      showImportUser
        ? {
            disabled: !canImportRosterUser || loading || mutating,
            icon: <UserPlusIcon aria-hidden size={18} />,
            id: "org-manager-import-user-toolbar",
            label: ORG_MANAGER_LABELS.importUserAction,
            onClick: openImportUserDialog,
            priority: 100,
          }
        : null,
    [
      canImportRosterUser,
      loading,
      mutating,
      openImportUserDialog,
      showImportUser,
    ],
  );

  useWindowTitleBarAction(newGroupAction);
  useWindowTitleBarAction(importUserAction);
}
