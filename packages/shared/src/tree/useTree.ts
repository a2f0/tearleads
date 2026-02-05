import type { FlatTreeItem, TreeNode } from './types.js';

/**
 * Builds a tree structure from a flat array of items.
 *
 * @param items - Flat array of items to build into a tree
 * @param getId - Function to get unique ID from an item
 * @param getParentId - Function to get parent ID from an item (null for root)
 * @returns Array of root-level tree nodes
 */
export function buildTree<T>(
  items: T[],
  getId: (item: T) => string,
  getParentId: (item: T) => string | null
): TreeNode<T>[] {
  // Create a map for O(1) lookups
  const nodeMap = new Map<string, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];

  // First pass: create all nodes
  for (const item of items) {
    const id = getId(item);
    nodeMap.set(id, {
      id,
      data: item,
      children: [],
      depth: 0
    });
  }

  // Second pass: build relationships
  for (const item of items) {
    const id = getId(item);
    const parentId = getParentId(item);
    const node = nodeMap.get(id);

    if (!node) continue;

    if (parentId === null) {
      // Root node
      roots.push(node);
    } else {
      // Child node
      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found, treat as root
        roots.push(node);
      }
    }
  }

  // Third pass: calculate depths
  function setDepths(nodes: TreeNode<T>[], depth: number): void {
    for (const node of nodes) {
      node.depth = depth;
      setDepths(node.children, depth + 1);
    }
  }
  setDepths(roots, 0);

  return roots;
}

/**
 * Flattens a tree for rendering in a virtualized list.
 * Only includes visible nodes based on expansion state.
 *
 * @param roots - Root-level tree nodes
 * @param expandedIds - Set of expanded node IDs
 * @returns Flat array of visible tree items
 */
export function flattenTree<T>(
  roots: TreeNode<T>[],
  expandedIds: Set<string>
): FlatTreeItem<T>[] {
  const result: FlatTreeItem<T>[] = [];

  function traverse(nodes: TreeNode<T>[]): void {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedIds.has(node.id);

      result.push({
        node,
        hasChildren,
        isExpanded
      });

      // Only traverse children if expanded
      if (hasChildren && isExpanded) {
        traverse(node.children);
      }
    }
  }

  traverse(roots);
  return result;
}

/**
 * Gets all ancestor IDs for a given node ID.
 *
 * @param items - Flat array of items
 * @param targetId - ID of the node to find ancestors for
 * @param getId - Function to get unique ID from an item
 * @param getParentId - Function to get parent ID from an item
 * @returns Array of ancestor IDs (from root to parent)
 */
export function getAncestorIds<T>(
  items: T[],
  targetId: string,
  getId: (item: T) => string,
  getParentId: (item: T) => string | null
): string[] {
  const ancestors: string[] = [];
  const itemMap = new Map<string, T>();

  // Build map for lookups
  for (const item of items) {
    itemMap.set(getId(item), item);
  }

  // Walk up the tree
  let currentId: string | null = targetId;
  while (currentId !== null) {
    const item = itemMap.get(currentId);
    if (!item) break;

    const parentId = getParentId(item);
    if (parentId !== null) {
      ancestors.unshift(parentId);
    }
    currentId = parentId;
  }

  return ancestors;
}

/**
 * Gets all descendant IDs for a given node ID.
 *
 * @param roots - Root-level tree nodes
 * @param targetId - ID of the node to find descendants for
 * @returns Array of all descendant IDs
 */
export function getDescendantIds<T>(
  roots: TreeNode<T>[],
  targetId: string
): string[] {
  const descendants: string[] = [];

  function findNode(nodes: TreeNode<T>[]): TreeNode<T> | undefined {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      const found = findNode(node.children);
      if (found) return found;
    }
    return undefined;
  }

  function collectDescendants(nodes: TreeNode<T>[]): void {
    for (const node of nodes) {
      descendants.push(node.id);
      collectDescendants(node.children);
    }
  }

  const targetNode = findNode(roots);
  if (targetNode) {
    collectDescendants(targetNode.children);
  }

  return descendants;
}
