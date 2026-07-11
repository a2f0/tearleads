import type { Icon } from "@phosphor-icons/react";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { CreditCardIcon } from "@phosphor-icons/react/dist/csr/CreditCard";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

interface OrgManagerSection {
  // Only the roster and groups rows carry a right-click / long-press menu; the
  // rest navigate on click alone.
  contextMenuTarget?: OrgManagerSidebarContextMenuTarget;
  // Leading icon for the compact menu home (mobile); the wide sidebar ignores it.
  icon: Icon;
  label: string;
  view: Exclude<OrgManagerView, "menu">;
}

/**
 * The org-manager sections, in nav order. Shared by the sidebar (wide layouts)
 * and the compact menu home (mobile) so the two never drift.
 */
export const ORG_MANAGER_SECTIONS: ReadonlyArray<OrgManagerSection> = [
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
