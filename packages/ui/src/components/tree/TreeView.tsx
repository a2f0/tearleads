import type { FlatTreeItem } from '@tearleads/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback } from 'react';
import { cn } from '../../lib/utils.js';

const INDENT_PX = 16;

export interface TreeViewProps<T> {
  /** Flattened tree items to render */
  items: FlatTreeItem<T>[];
  /** Currently selected node ID */
  selectedId: string | null;
  /** Callback when a node is selected */
  onSelect: (id: string) => void;
  /** Callback when a node is expanded/collapsed */
  onToggle: (id: string) => void;
  /** Render function for node content */
  renderNode: (item: FlatTreeItem<T>) => React.ReactNode;
  /** Optional className for the container */
  className?: string;
  /** Optional test ID */
  'data-testid'?: string;
}

export function TreeView<T>({
  items,
  selectedId,
  onSelect,
  onToggle,
  renderNode,
  className,
  'data-testid': testId = 'tree-view'
}: TreeViewProps<T>) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, item: FlatTreeItem<T>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(item.node.id);
      } else if (
        e.key === 'ArrowRight' &&
        item.hasChildren &&
        !item.isExpanded
      ) {
        e.preventDefault();
        onToggle(item.node.id);
      } else if (e.key === 'ArrowLeft' && item.hasChildren && item.isExpanded) {
        e.preventDefault();
        onToggle(item.node.id);
      }
    },
    [onSelect, onToggle]
  );

  return (
    <div
      className={cn('flex flex-col', className)}
      role="tree"
      data-testid={testId}
    >
      {items.map((item) => (
        <TreeNode
          key={item.node.id}
          item={item}
          isSelected={selectedId === item.node.id}
          onSelect={onSelect}
          onToggle={onToggle}
          onKeyDown={handleKeyDown}
          renderNode={renderNode}
          testId={testId}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps<T> {
  item: FlatTreeItem<T>;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, item: FlatTreeItem<T>) => void;
  renderNode: (item: FlatTreeItem<T>) => React.ReactNode;
  testId: string;
}

function TreeNode<T>({
  item,
  isSelected,
  onSelect,
  onToggle,
  onKeyDown,
  renderNode,
  testId
}: TreeNodeProps<T>) {
  const handleClick = useCallback(() => {
    onSelect(item.node.id);
  }, [item.node.id, onSelect]);

  const handleToggleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle(item.node.id);
    },
    [item.node.id, onToggle]
  );

  const handleKeyDownWrapper = useCallback(
    (e: React.KeyboardEvent) => {
      onKeyDown(e, item);
    },
    [item, onKeyDown]
  );

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={item.hasChildren ? item.isExpanded : undefined}
      tabIndex={0}
      className={cn(
        'flex cursor-pointer select-none items-center gap-1 rounded px-2 py-1.5',
        'hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'bg-muted'
      )}
      style={{ paddingLeft: `${item.node.depth * INDENT_PX + 8}px` }}
      onClick={handleClick}
      onKeyDown={handleKeyDownWrapper}
      data-testid={`${testId}-node-${item.node.id}`}
    >
      {item.hasChildren ? (
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted"
          onClick={handleToggleClick}
          tabIndex={-1}
          aria-label={item.isExpanded ? 'Collapse' : 'Expand'}
          data-testid={`${testId}-toggle-${item.node.id}`}
        >
          {item.isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">{renderNode(item)}</div>
    </div>
  );
}
