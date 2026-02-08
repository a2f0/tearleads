import { useState } from 'react';
import type { ClassicTag } from '../lib/types';
import { ClassicContextMenu } from './ClassicContextMenu';

interface TagSidebarProps {
  tags: ClassicTag[];
  activeTagId: string | null;
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
  onReorderTag: (tagId: string, targetTagId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

interface TagContextMenuState {
  x: number;
  y: number;
  tagId: string;
  tagName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function TagSidebar({
  tags,
  activeTagId,
  onSelectTag,
  onMoveTag,
  onReorderTag,
  searchValue,
  onSearchChange
}: TagSidebarProps) {
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(
    null
  );
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [lastHoverTagId, setLastHoverTagId] = useState<string | null>(null);
  const [dragArmedTagId, setDragArmedTagId] = useState<string | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  return (
    <aside className="flex w-64 flex-col border-r" aria-label="Tags Sidebar">
      <div className="flex-1 overflow-auto p-3">
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
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      tagId: tag.id,
                      tagName: tag.name,
                      canMoveUp,
                      canMoveDown
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
                          ? 'w-4 shrink-0 cursor-grabbing select-none text-center text-zinc-500 text-xs'
                          : 'w-4 shrink-0 cursor-grab select-none text-center text-zinc-400 text-xs'
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
          placeholder="Search tags..."
          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none"
          aria-label="Search tags"
        />
      </div>
      {contextMenu && (
        <ClassicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={`Tag actions for ${contextMenu.tagName}`}
          onClose={closeContextMenu}
          actions={[
            {
              label: 'Move Up',
              onClick: () => onMoveTag(contextMenu.tagId, 'up'),
              disabled: !contextMenu.canMoveUp,
              ariaLabel: `Move tag ${contextMenu.tagName} up`
            },
            {
              label: 'Move Down',
              onClick: () => onMoveTag(contextMenu.tagId, 'down'),
              disabled: !contextMenu.canMoveDown,
              ariaLabel: `Move tag ${contextMenu.tagName} down`
            }
          ]}
        />
      )}
    </aside>
  );
}
