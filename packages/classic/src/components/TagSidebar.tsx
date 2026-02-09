import { useState } from 'react';
import {
  CREATE_CLASSIC_TAG_ARIA_LABEL,
  DEFAULT_CLASSIC_TAG_NAME
} from '../lib/constants';
import type { ClassicTag } from '../lib/types';
import {
  ClassicContextMenu,
  type ClassicContextMenuComponents
} from './ClassicContextMenu';

interface TagSidebarProps {
  tags: ClassicTag[];
  activeTagId: string | null;
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
  onReorderTag: (tagId: string, targetTagId: string) => void;
  onCreateTag?: (() => void | Promise<void>) | undefined;
  searchValue: string;
  onSearchChange: (value: string) => void;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}

interface TagContextMenuState {
  x: number;
  y: number;
  actions: Array<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
    ariaLabel: string;
  }>;
  ariaLabel: string;
}

export function TagSidebar({
  tags,
  activeTagId,
  onSelectTag,
  onMoveTag,
  onReorderTag,
  onCreateTag,
  searchValue,
  onSearchChange,
  contextMenuComponents
}: TagSidebarProps) {
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(
    null
  );
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [lastHoverTagId, setLastHoverTagId] = useState<string | null>(null);
  const [dragArmedTagId, setDragArmedTagId] = useState<string | null>(null);

  const closeContextMenu = () => setContextMenu(null);
  const openEmptySpaceContextMenu = (x: number, y: number) => {
    setContextMenu({
      x,
      y,
      ariaLabel: 'Tag list actions',
      actions: [
        {
          label: DEFAULT_CLASSIC_TAG_NAME,
          onClick: () => {
            void onCreateTag?.();
          },
          ariaLabel: CREATE_CLASSIC_TAG_ARIA_LABEL,
          disabled: onCreateTag === undefined
        }
      ]
    });
  };

  return (
    <aside className="flex w-64 flex-col border-r" aria-label="Tags Sidebar">
      {/* biome-ignore lint/a11y/useSemanticElements: div with role=button required for flexible layout container */}
      <div
        role="button"
        aria-label="Tag list, press Shift+F10 for context menu"
        tabIndex={0}
        className="flex-1 overflow-auto p-3"
        onContextMenu={(event) => {
          event.preventDefault();
          openEmptySpaceContextMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          const isContextMenuKey =
            event.key === 'ContextMenu' ||
            (event.key === 'F10' && event.shiftKey);
          if (!isContextMenuKey) {
            return;
          }
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openEmptySpaceContextMenu(rect.left + 8, rect.top + 8);
        }}
      >
        {tags.length === 0 ? (
          <p className="text-sm text-zinc-500">No tags found.</p>
        ) : (
          <ul className="space-y-1" aria-label="Tag List">
            {tags.map((tag, index) => {
              const isActive = tag.id === activeTagId;
              const canMoveUp = index > 0;
              const canMoveDown = index < tags.length - 1;
              return (
                <li
                  key={tag.id}
                  className="rounded border px-2 py-1.5"
                  draggable
                  onDragStart={(event) => {
                    const target = event.target;
                    if (
                      dragArmedTagId !== tag.id &&
                      (!(target instanceof HTMLElement) ||
                        !target.closest('[data-drag-handle="true"]'))
                    ) {
                      event.preventDefault();
                      return;
                    }
                    setDraggedTagId(tag.id);
                    setLastHoverTagId(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tag.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTagId(null);
                    setLastHoverTagId(null);
                    setDragArmedTagId(null);
                  }}
                  onDragOver={(event) => {
                    if (!draggedTagId || draggedTagId === tag.id) {
                      return;
                    }
                    event.preventDefault();
                    if (lastHoverTagId === tag.id) {
                      return;
                    }
                    onReorderTag(draggedTagId, tag.id);
                    setLastHoverTagId(tag.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragArmedTagId(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      ariaLabel: `Tag actions for ${tag.name}`,
                      actions: [
                        {
                          label: 'Move Up',
                          onClick: () => onMoveTag(tag.id, 'up'),
                          disabled: !canMoveUp,
                          ariaLabel: `Move tag ${tag.name} up`
                        },
                        {
                          label: 'Move Down',
                          onClick: () => onMoveTag(tag.id, 'down'),
                          disabled: !canMoveDown,
                          ariaLabel: `Move tag ${tag.name} down`
                        }
                      ]
                    });
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      data-drag-handle="true"
                      onMouseDown={() => setDragArmedTagId(tag.id)}
                      onMouseUp={() => setDragArmedTagId(null)}
                      className={
                        draggedTagId === tag.id
                          ? 'w-4 shrink-0 cursor-grabbing select-none text-center text-xs text-zinc-500'
                          : 'w-4 shrink-0 cursor-grab select-none text-center text-xs text-zinc-400'
                      }
                      title="Drag tag"
                    >
                      ⋮⋮
                    </span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-sm"
                      onClick={() => onSelectTag(tag.id)}
                      aria-pressed={isActive}
                      aria-label={`Select tag ${tag.name}`}
                    >
                      <span
                        className={
                          isActive
                            ? 'font-semibold text-zinc-950'
                            : 'text-zinc-700'
                        }
                      >
                        {tag.name}
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="p-3">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
          aria-label="Search tags"
        />
      </div>
      {contextMenu && (
        <ClassicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={contextMenu.ariaLabel}
          onClose={closeContextMenu}
          actions={contextMenu.actions}
          {...(contextMenuComponents
            ? { components: contextMenuComponents }
            : {})}
        />
      )}
    </aside>
  );
}
