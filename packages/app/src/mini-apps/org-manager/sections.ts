import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { CreditCardIcon } from "@phosphor-icons/react/dist/csr/CreditCard";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { MiniAppSection } from "../../components/mini-app/MiniAppSectionNavigation";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

/**
 * The org-manager sections, in nav order. Shared by the sidebar (wide layouts)
 * and the compact menu home (mobile) so the two never drift.
 */
export const ORG_MANAGER_SECTIONS: ReadonlyArray<
  MiniAppSection<
    Exclude<OrgManagerView, "menu">,
    OrgManagerSidebarContextMenuTarget
  >
> = [
  {
    contextMenuTarget: "directory",
    icon: UsersIcon,
    label: ORG_MANAGER_LABELS.directory,
    view: "directory",
  },
  {
    contextMenuTarget: "groups",
    icon: UsersThreeIcon,
    label: ORG_MANAGER_LABELS.groups,
    view: "groups",
  },
  { icon: KeyIcon, label: ORG_MANAGER_LABELS.grants, view: "grants" },
  {
    icon: BuildingsIcon,
    label: ORG_MANAGER_LABELS.organization,
    view: "organization",
  },
  { icon: ChartBarIcon, label: ORG_MANAGER_LABELS.usage, view: "usage" },
  { icon: CreditCardIcon, label: ORG_MANAGER_LABELS.billing, view: "billing" },
];
