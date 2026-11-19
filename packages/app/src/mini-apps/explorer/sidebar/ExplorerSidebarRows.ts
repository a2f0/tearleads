import { EXPLORER_LABELS } from "../labels";
import type { ExplorerTreeEntry } from "./explorerTreeModel";

export type ExplorerSidebarVirtualRow =
  | {
      key: string;
      kind: "section-label";
      label: string;
    }
  | {
      depth: number;
      entry: ExplorerTreeEntry;
      isCollapsed: boolean;
      key: string;
      kind: "container";
    };

interface ExplorerSidebarRootGroup {
  entries: ReadonlyArray<ExplorerTreeEntry>;
  label: string | null;
  organizationId: string | null;
}

// Groups the root entries for section headings: the user's own roots stay
// unlabelled; each *foreign* org whose display name has decrypted gets its own
// heading; foreign orgs whose name has not resolved yet collapse into the
// single legacy "Shared with me" bucket.
function getExplorerSidebarRootGroups(params: {
  entries: ReadonlyArray<ExplorerTreeEntry>;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
}): ReadonlyArray<ExplorerSidebarRootGroup> {
  const { entries, organizationNamesById, primaryOrganizationId } = params;
  if (!primaryOrganizationId) {
    return [{ entries, label: null, organizationId: null }];
  }

  const ownedEntries: ExplorerTreeEntry[] = [];
  const namedForeignGroups = new Map<
    string,
    { entries: ExplorerTreeEntry[]; label: string }
  >();
  const unnamedForeignEntries: ExplorerTreeEntry[] = [];
  for (const entry of entries) {
    const { organizationId } = entry.node;
    if (!organizationId || organizationId === primaryOrganizationId) {
      ownedEntries.push(entry);
      continue;
    }
    const name = organizationNamesById.get(organizationId);
    if (name === undefined) {
      unnamedForeignEntries.push(entry);
      continue;
    }
    const existing = namedForeignGroups.get(organizationId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      namedForeignGroups.set(organizationId, { entries: [entry], label: name });
    }
  }

  const sortedNamedGroups = Array.from(namedForeignGroups.entries())
    .map(([organizationId, group]) => ({
      entries: group.entries,
      label: group.label,
      organizationId,
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.organizationId.localeCompare(right.organizationId),
    );

  return [
    ...(ownedEntries.length > 0
      ? [{ entries: ownedEntries, label: null, organizationId: null }]
      : []),
    ...sortedNamedGroups,
    ...(unnamedForeignEntries.length > 0
      ? [
          {
            entries: unnamedForeignEntries,
            label: EXPLORER_LABELS.sharedWithMeSection,
            organizationId: null,
          },
        ]
      : []),
  ];
}

export function buildExplorerSidebarRows(params: {
  collapsedIds: ReadonlySet<string>;
  entries: ReadonlyArray<ExplorerTreeEntry>;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
}): ExplorerSidebarVirtualRow[] {
  const rows: ExplorerSidebarVirtualRow[] = [];

  function visit(entry: ExplorerTreeEntry, depth: number) {
    const isCollapsed = params.collapsedIds.has(entry.node.id);
    rows.push({
      depth,
      entry,
      isCollapsed,
      key: `container:${entry.node.id}`,
      kind: "container",
    });
    if (!isCollapsed) {
      for (const child of entry.children) {
        visit(child, depth + 1);
      }
    }
  }

  for (const group of getExplorerSidebarRootGroups(params)) {
    if (group.label) {
      rows.push({
        key: `section-label:${group.organizationId ?? group.label}`,
        kind: "section-label",
        label: group.label,
      });
    }
    for (const entry of group.entries) {
      visit(entry, 0);
    }
  }
  return rows;
}
