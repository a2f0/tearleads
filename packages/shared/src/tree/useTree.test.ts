import { describe, expect, it } from 'vitest';
import {
  buildTree,
  flattenTree,
  getAncestorIds,
  getDescendantIds
} from './useTree.js';

interface TestItem {
  id: string;
  name: string;
  parentId: string | null;
}

describe('buildTree', () => {
  it('builds a simple flat tree with no parents', () => {
    const items: TestItem[] = [
      { id: '1', name: 'Item 1', parentId: null },
      { id: '2', name: 'Item 2', parentId: null }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    expect(tree).toHaveLength(2);
    expect(tree[0]?.id).toBe('1');
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children).toHaveLength(0);
    expect(tree[1]?.id).toBe('2');
    expect(tree[1]?.depth).toBe(0);
  });

  it('builds a tree with parent-child relationships', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child1', name: 'Child 1', parentId: 'root' },
      { id: 'child2', name: 'Child 2', parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child1' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe('root');
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children).toHaveLength(2);

    const child1 = tree[0]?.children.find((c) => c.id === 'child1');
    expect(child1).toBeDefined();
    expect(child1?.depth).toBe(1);
    expect(child1?.children).toHaveLength(1);
    expect(child1?.children[0]?.id).toBe('grandchild');
    expect(child1?.children[0]?.depth).toBe(2);
  });

  it('handles orphaned items as roots', () => {
    const items: TestItem[] = [
      { id: '1', name: 'Item 1', parentId: 'nonexistent' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe('1');
    expect(tree[0]?.depth).toBe(0);
  });

  it('handles empty array', () => {
    const tree = buildTree<TestItem>(
      [],
      (item) => item.id,
      (item) => item.parentId
    );

    expect(tree).toHaveLength(0);
  });
});

describe('flattenTree', () => {
  it('flattens a tree with all nodes collapsed', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child', name: 'Child', parentId: 'root' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );
    const flat = flattenTree(tree, new Set());

    expect(flat).toHaveLength(1);
    expect(flat[0]?.node.id).toBe('root');
    expect(flat[0]?.hasChildren).toBe(true);
    expect(flat[0]?.isExpanded).toBe(false);
  });

  it('flattens a tree with expanded nodes', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child1', name: 'Child 1', parentId: 'root' },
      { id: 'child2', name: 'Child 2', parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child1' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    // Expand root and child1
    const flat = flattenTree(tree, new Set(['root', 'child1']));

    expect(flat).toHaveLength(4);
    expect(flat.map((f) => f.node.id)).toEqual([
      'root',
      'child1',
      'grandchild',
      'child2'
    ]);
    expect(flat[0]?.isExpanded).toBe(true);
    expect(flat[1]?.isExpanded).toBe(true);
    expect(flat[2]?.hasChildren).toBe(false);
    expect(flat[3]?.hasChildren).toBe(false);
  });

  it('handles empty tree', () => {
    const flat = flattenTree<TestItem>([], new Set());
    expect(flat).toHaveLength(0);
  });
});

describe('getAncestorIds', () => {
  it('returns ancestors in order from root to parent', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child', name: 'Child', parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child' }
    ];

    const ancestors = getAncestorIds(
      items,
      'grandchild',
      (item) => item.id,
      (item) => item.parentId
    );

    expect(ancestors).toEqual(['root', 'child']);
  });

  it('returns empty array for root node', () => {
    const items: TestItem[] = [{ id: 'root', name: 'Root', parentId: null }];

    const ancestors = getAncestorIds(
      items,
      'root',
      (item) => item.id,
      (item) => item.parentId
    );

    expect(ancestors).toEqual([]);
  });

  it('returns empty array for unknown node', () => {
    const items: TestItem[] = [{ id: 'root', name: 'Root', parentId: null }];

    const ancestors = getAncestorIds(
      items,
      'nonexistent',
      (item) => item.id,
      (item) => item.parentId
    );

    expect(ancestors).toEqual([]);
  });
});

describe('getDescendantIds', () => {
  it('returns all descendant IDs', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child1', name: 'Child 1', parentId: 'root' },
      { id: 'child2', name: 'Child 2', parentId: 'root' },
      { id: 'grandchild1', name: 'Grandchild 1', parentId: 'child1' },
      { id: 'grandchild2', name: 'Grandchild 2', parentId: 'child1' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    const descendants = getDescendantIds(tree, 'root');

    expect(descendants).toHaveLength(4);
    expect(descendants).toContain('child1');
    expect(descendants).toContain('child2');
    expect(descendants).toContain('grandchild1');
    expect(descendants).toContain('grandchild2');
  });

  it('returns descendants of a child node', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child', name: 'Child', parentId: 'root' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    const descendants = getDescendantIds(tree, 'child');

    expect(descendants).toEqual(['grandchild']);
  });

  it('returns empty array for leaf node', () => {
    const items: TestItem[] = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child', name: 'Child', parentId: 'root' }
    ];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    const descendants = getDescendantIds(tree, 'child');

    expect(descendants).toEqual([]);
  });

  it('returns empty array for unknown node', () => {
    const items: TestItem[] = [{ id: 'root', name: 'Root', parentId: null }];

    const tree = buildTree(
      items,
      (item) => item.id,
      (item) => item.parentId
    );

    const descendants = getDescendantIds(tree, 'nonexistent');

    expect(descendants).toEqual([]);
  });
});
