/**
 * Generic tree node structure for hierarchical data.
 */
export interface TreeNode<T> {
  /** Unique identifier for this node */
  id: string;
  /** The underlying data for this node */
  data: T;
  /** Child nodes */
  children: TreeNode<T>[];
  /** Depth level in the tree (0 = root) */
  depth: number;
}

/**
 * A flattened tree item for rendering in a list.
 * Includes visibility info based on parent expansion state.
 */
export interface FlatTreeItem<T> {
  /** The tree node */
  node: TreeNode<T>;
  /** Whether this node has children */
  hasChildren: boolean;
  /** Whether this node is expanded (only relevant if hasChildren) */
  isExpanded: boolean;
}
