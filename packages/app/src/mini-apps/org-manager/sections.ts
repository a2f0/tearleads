import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

interface OrgManagerSection {
  // Only the roster and groups rows carry a right-click / long-press menu; the
  // rest navigate on click alone.
  contextMenuTarget?: OrgManagerSidebarContextMenuTarget;
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
    label: ORG_MANAGER_LABELS.directory,
    view: "directory",
  },
  {
    contextMenuTarget: "groups",
    label: ORG_MANAGER_LABELS.groups,
    view: "groups",
  },
  { label: ORG_MANAGER_LABELS.grants, view: "grants" },
  { label: ORG_MANAGER_LABELS.organization, view: "organization" },
  { label: ORG_MANAGER_LABELS.usage, view: "usage" },
  { label: ORG_MANAGER_LABELS.billing, view: "billing" },
];
