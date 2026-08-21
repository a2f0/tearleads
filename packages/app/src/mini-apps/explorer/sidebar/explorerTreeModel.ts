import type { ContainerNode } from "@symcrypt/client-sdk";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
import type { ExplorerSidebarTreeEntry } from "./ExplorerSidebarRows";

export const EXPLORER_SIDEBAR_ROW_HEIGHT = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT;

export type ExplorerTreeEntry = ExplorerSidebarTreeEntry;

export function buildExplorerTree(
  nodes: ReadonlyArray<ContainerNode>,
): ExplorerTreeEntry[] {
  const entriesById = new Map<string, ExplorerTreeEntry>();
  for (const node of nodes) {
    entriesById.set(node.id, { children: [], node });
  }

  const roots: ExplorerTreeEntry[] = [];
  for (const entry of entriesById.values()) {
    if (entry.node.parentId && entriesById.has(entry.node.parentId)) {
      entriesById.get(entry.node.parentId)?.children.push(entry);
      continue;
    }

    roots.push(entry);
  }

  function sortEntries(entries: ExplorerTreeEntry[]) {
    entries.sort((left, right) =>
      left.node.name.localeCompare(right.node.name, undefined, {
        sensitivity: "base",
      }),
    );

    for (const entry of entries) {
      sortEntries(entry.children);
    }
  }

  sortEntries(roots);
  return roots;
}

export function listExpandedExplorerTreeContainerIds(
  entries: ReadonlyArray<ExplorerTreeEntry>,
  collapsedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const expandedContainerIds: string[] = [];

  function visit(entry: ExplorerTreeEntry) {
    if (collapsedIds.has(entry.node.id)) {
      return;
    }

    expandedContainerIds.push(entry.node.id);
    for (const child of entry.children) {
      visit(child);
    }
  }

  for (const entry of entries) {
    visit(entry);
  }

  return expandedContainerIds;
}

export function getExplorerTreeIdSetKey(ids: ReadonlySet<string>): string {
  return Array.from(ids).sort().join("\u0000");
}

export function getExplorerSidebarWindowRange(params: {
  scrollTop: number;
  viewportHeight: number;
}): { limit: number; offset: number } {
  return getMiniAppVirtualWindowRange({
    ...params,
    rowHeight: EXPLORER_SIDEBAR_ROW_HEIGHT,
  });
}
