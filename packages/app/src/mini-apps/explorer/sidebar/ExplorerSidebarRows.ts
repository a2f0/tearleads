import type {
  ContainerDocumentSidebarRow,
  ContainerNode,
} from "@tearleads/client-sdk";
import { MINI_APP_VIRTUAL_DEFAULT_MIN_WINDOW_ROWS } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { EXPLORER_LABELS } from "../labels";

export const EXPLORER_SIDEBAR_MIN_WINDOW_ROWS =
  MINI_APP_VIRTUAL_DEFAULT_MIN_WINDOW_ROWS;

export interface ExplorerSidebarTreeEntry {
  children: ExplorerSidebarTreeEntry[];
  node: ContainerNode;
}

export interface ExplorerSidebarDocumentWindowState {
  error: string | null;
  isLoading: boolean;
  offset: number;
  rows: ReadonlyArray<ContainerDocumentSidebarRow>;
  totalCount: number | null;
}

type ExplorerSidebarSection =
  | {
      kind: "section-label";
      label: string;
      // Stable heading identity: the foreign org's id for a per-org heading, or
      // null for the shared fallback. Keeps virtual-row keys unique when two
      // orgs happen to share a display name.
      organizationId: string | null;
      rowCount: 1;
    }
  | {
      depth: number;
      entry: ExplorerSidebarTreeEntry;
      kind: "container";
      rowCount: 1;
    }
  | {
      containerId: string;
      depth: number;
      kind: "documents";
      rowCount: number;
      state: ExplorerSidebarDocumentWindowState;
    }
  | {
      containerId: string;
      depth: number;
      error: string | null;
      isLoading: boolean;
      kind: "document-status";
      rowCount: 1;
    };

export type ExplorerSidebarVirtualRow =
  | {
      key: string;
      kind: "section-label";
      label: string;
    }
  | {
      depth: number;
      entry: ExplorerSidebarTreeEntry;
      isCollapsed: boolean;
      key: string;
      kind: "container";
    }
  | {
      containerId: string;
      depth: number;
      documentIndex: number;
      key: string;
      kind: "document";
      state: ExplorerSidebarDocumentWindowState;
    }
  | {
      containerId: string;
      depth: number;
      error: string | null;
      isLoading: boolean;
      key: string;
      kind: "document-status";
    };

interface ExplorerSidebarRootGroup {
  entries: ReadonlyArray<ExplorerSidebarTreeEntry>;
  label: string | null;
  organizationId: string | null;
}

// Groups the root entries for section headings: the user's own roots stay
// unlabelled; each *foreign* org whose display name has decrypted gets its own
// heading; foreign orgs whose name has not resolved yet collapse into the
// single legacy "Shared with me" bucket.
function getExplorerSidebarRootGroups(params: {
  entries: ReadonlyArray<ExplorerSidebarTreeEntry>;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
}): ReadonlyArray<ExplorerSidebarRootGroup> {
  const { entries, organizationNamesById, primaryOrganizationId } = params;
  if (!primaryOrganizationId) {
    return [{ entries, label: null, organizationId: null }];
  }

  const ownedEntries: ExplorerSidebarTreeEntry[] = [];
  const namedForeignGroups = new Map<
    string,
    { entries: ExplorerSidebarTreeEntry[]; label: string }
  >();
  const unnamedForeignEntries: ExplorerSidebarTreeEntry[] = [];
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

export function buildExplorerSidebarSections(params: {
  collapsedIds: ReadonlySet<string>;
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  entries: ReadonlyArray<ExplorerSidebarTreeEntry>;
  organizationNamesById: ReadonlyMap<string, string>;
  primaryOrganizationId: string | null;
}): ReadonlyArray<ExplorerSidebarSection> {
  const {
    collapsedIds,
    documentWindowsByContainerId,
    entries,
    organizationNamesById,
    primaryOrganizationId,
  } = params;
  const sections: ExplorerSidebarSection[] = [];

  function visit(entry: ExplorerSidebarTreeEntry, depth: number) {
    sections.push({
      depth,
      entry,
      kind: "container",
      rowCount: 1,
    });

    if (collapsedIds.has(entry.node.id)) {
      return;
    }

    for (const child of entry.children) {
      visit(child, depth + 1);
    }

    const state = documentWindowsByContainerId.get(entry.node.id);
    if (state?.totalCount !== null && state?.totalCount !== undefined) {
      if (state.totalCount > 0) {
        sections.push({
          containerId: entry.node.id,
          depth: depth + 1,
          kind: "documents",
          rowCount: state.totalCount,
          state,
        });
      }
      return;
    }

    sections.push({
      containerId: entry.node.id,
      depth: depth + 1,
      error: state?.error ?? null,
      isLoading: state?.isLoading ?? true,
      kind: "document-status",
      rowCount: 1,
    });
  }

  for (const group of getExplorerSidebarRootGroups({
    entries,
    organizationNamesById,
    primaryOrganizationId,
  })) {
    if (group.label) {
      sections.push({
        kind: "section-label",
        label: group.label,
        organizationId: group.organizationId,
        rowCount: 1,
      });
    }

    for (const entry of group.entries) {
      visit(entry, 0);
    }
  }

  return sections;
}

export function countExplorerSidebarRows(
  sections: ReadonlyArray<ExplorerSidebarSection>,
): number {
  return sections.reduce((count, section) => count + section.rowCount, 0);
}

export function getExplorerSidebarRowsInRange(params: {
  collapsedIds: ReadonlySet<string>;
  limit: number;
  offset: number;
  sections: ReadonlyArray<ExplorerSidebarSection>;
}): ReadonlyArray<ExplorerSidebarVirtualRow> {
  const { collapsedIds, limit, offset, sections } = params;
  const rows: ExplorerSidebarVirtualRow[] = [];
  const endOffset = offset + limit;
  let cursor = 0;

  for (const section of sections) {
    const sectionStart = cursor;
    const sectionEnd = sectionStart + section.rowCount;
    cursor = sectionEnd;

    if (sectionEnd <= offset) {
      continue;
    }

    if (sectionStart >= endOffset) {
      break;
    }

    const startInSection = Math.max(0, offset - sectionStart);
    const endInSection = Math.min(section.rowCount, endOffset - sectionStart);

    if (section.kind === "section-label") {
      rows.push({
        key: `section-label:${section.organizationId ?? section.label}`,
        kind: "section-label",
        label: section.label,
      });
      continue;
    }

    if (section.kind === "container") {
      rows.push({
        depth: section.depth,
        entry: section.entry,
        isCollapsed: collapsedIds.has(section.entry.node.id),
        key: `container:${section.entry.node.id}`,
        kind: "container",
      });
      continue;
    }

    if (section.kind === "document-status") {
      rows.push({
        containerId: section.containerId,
        depth: section.depth,
        error: section.error,
        isLoading: section.isLoading,
        key: `document-status:${section.containerId}`,
        kind: "document-status",
      });
      continue;
    }

    for (
      let documentIndex = startInSection;
      documentIndex < endInSection;
      documentIndex += 1
    ) {
      rows.push({
        containerId: section.containerId,
        depth: section.depth,
        documentIndex,
        key: `document:${section.containerId}:${documentIndex}`,
        kind: "document",
        state: section.state,
      });
    }
  }

  return rows;
}

export function getLoadedExplorerSidebarDocumentRow(
  row: Extract<ExplorerSidebarVirtualRow, { kind: "document" }>,
): ContainerDocumentSidebarRow | null {
  const rowOffset = row.documentIndex - row.state.offset;
  return rowOffset >= 0 && rowOffset < row.state.rows.length
    ? (row.state.rows[rowOffset] ?? null)
    : null;
}

export function getExplorerSidebarDocumentWindowRequests(params: {
  documentWindowsByContainerId: ReadonlyMap<
    string,
    ExplorerSidebarDocumentWindowState
  >;
  rows: ReadonlyArray<ExplorerSidebarVirtualRow>;
}): ReadonlyArray<{ containerId: string; limit: number; offset: number }> {
  const requestsByContainerId = new Map<
    string,
    {
      hasMissingRows: boolean;
      maxIndex: number;
      minIndex: number;
      shouldRequest: boolean;
    }
  >();

  for (const row of params.rows) {
    if (row.kind === "document-status") {
      if (!row.error) {
        requestsByContainerId.set(row.containerId, {
          hasMissingRows: true,
          maxIndex: EXPLORER_SIDEBAR_MIN_WINDOW_ROWS - 1,
          minIndex: 0,
          shouldRequest: true,
        });
      }
      continue;
    }

    if (row.kind !== "document") {
      continue;
    }

    if (row.state.error) {
      continue;
    }

    const range = requestsByContainerId.get(row.containerId);
    const hasLoadedRow = Boolean(getLoadedExplorerSidebarDocumentRow(row));
    if (!range) {
      requestsByContainerId.set(row.containerId, {
        hasMissingRows: !hasLoadedRow,
        maxIndex: row.documentIndex,
        minIndex: row.documentIndex,
        shouldRequest: false,
      });
      continue;
    }

    range.hasMissingRows ||= !hasLoadedRow;
    range.minIndex = Math.min(range.minIndex, row.documentIndex);
    range.maxIndex = Math.max(range.maxIndex, row.documentIndex);
  }

  return Array.from(requestsByContainerId.entries())
    .filter(([, range]) => range.shouldRequest || range.hasMissingRows)
    .map(([containerId, range]) => {
      const state = params.documentWindowsByContainerId.get(containerId);
      const offset = Math.max(0, range.minIndex);
      const requestedLimit = Math.max(
        EXPLORER_SIDEBAR_MIN_WINDOW_ROWS,
        range.maxIndex - offset + 1,
      );
      const limit =
        state?.totalCount === null || state?.totalCount === undefined
          ? requestedLimit
          : Math.min(requestedLimit, Math.max(0, state.totalCount - offset));

      return {
        containerId,
        limit,
        offset,
      };
    });
}
