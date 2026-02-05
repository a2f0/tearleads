import type { FlatTreeItem } from '@rapid/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeView } from './TreeView.js';

interface TestItem {
  id: string;
  name: string;
}

function createTestItems(): FlatTreeItem<TestItem>[] {
  return [
    {
      node: {
        id: 'root',
        data: { id: 'root', name: 'Root' },
        children: [],
        depth: 0
      },
      hasChildren: true,
      isExpanded: true
    },
    {
      node: {
        id: 'child1',
        data: { id: 'child1', name: 'Child 1' },
        children: [],
        depth: 1
      },
      hasChildren: false,
      isExpanded: false
    },
    {
      node: {
        id: 'child2',
        data: { id: 'child2', name: 'Child 2' },
        children: [],
        depth: 1
      },
      hasChildren: true,
      isExpanded: false
    }
  ];
}

describe('TreeView', () => {
  it('renders all items', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Child 1')).toBeInTheDocument();
    expect(screen.getByText('Child 2')).toBeInTheDocument();
  });

  it('marks selected item', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId="child1"
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    const selectedItem = screen.getByTestId('tree-view-node-child1');
    expect(selectedItem).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect when item is clicked', () => {
    const items = createTestItems();
    const onSelect = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={onSelect}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    fireEvent.click(screen.getByTestId('tree-view-node-child1'));
    expect(onSelect).toHaveBeenCalledWith('child1');
  });

  it('calls onToggle when expand button is clicked', () => {
    const items = createTestItems();
    const onToggle = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={onToggle}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    fireEvent.click(screen.getByTestId('tree-view-toggle-root'));
    expect(onToggle).toHaveBeenCalledWith('root');
  });

  it('shows expand icon for collapsed items with children', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    // child2 has children but is collapsed
    expect(screen.getByTestId('tree-view-toggle-child2')).toBeInTheDocument();
    expect(screen.getByTestId('tree-view-node-child2')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('shows collapse icon for expanded items with children', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    // root is expanded
    expect(screen.getByTestId('tree-view-toggle-root')).toBeInTheDocument();
    expect(screen.getByTestId('tree-view-node-root')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('does not show toggle for leaf nodes', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    // child1 has no children
    expect(
      screen.queryByTestId('tree-view-toggle-child1')
    ).not.toBeInTheDocument();
  });

  it('handles keyboard navigation - Enter to select', () => {
    const items = createTestItems();
    const onSelect = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={onSelect}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    const node = screen.getByTestId('tree-view-node-child1');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('child1');
  });

  it('handles keyboard navigation - Space to select', () => {
    const items = createTestItems();
    const onSelect = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={onSelect}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    const node = screen.getByTestId('tree-view-node-child1');
    fireEvent.keyDown(node, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('child1');
  });

  it('handles keyboard navigation - ArrowRight to expand', () => {
    const items = createTestItems();
    const onToggle = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={onToggle}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    // child2 has children but is collapsed
    const node = screen.getByTestId('tree-view-node-child2');
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(onToggle).toHaveBeenCalledWith('child2');
  });

  it('handles keyboard navigation - ArrowLeft to collapse', () => {
    const items = createTestItems();
    const onToggle = vi.fn();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={onToggle}
        renderNode={(item) => <span>{item.node.data.name}</span>}
      />
    );

    // root is expanded
    const node = screen.getByTestId('tree-view-node-root');
    fireEvent.keyDown(node, { key: 'ArrowLeft' });
    expect(onToggle).toHaveBeenCalledWith('root');
  });

  it('uses custom testId', () => {
    const items = createTestItems();
    render(
      <TreeView
        items={items}
        selectedId={null}
        onSelect={() => {}}
        onToggle={() => {}}
        renderNode={(item) => <span>{item.node.data.name}</span>}
        data-testid="custom-tree"
      />
    );

    expect(screen.getByTestId('custom-tree')).toBeInTheDocument();
    expect(screen.getByTestId('custom-tree-node-root')).toBeInTheDocument();
  });
});
