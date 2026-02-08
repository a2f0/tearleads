import type { ClassicTag } from '../lib/types';

interface TagSidebarProps {
  tags: ClassicTag[];
  activeTagId: string | null;
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}

export function TagSidebar({
  tags,
  activeTagId,
  onSelectTag,
  onMoveTag,
  searchValue,
  onSearchChange
}: TagSidebarProps) {
  return (
    <aside className="flex w-72 flex-col border-r" aria-label="Tags Sidebar">
      <div className="flex-1 overflow-auto p-3">
        <h2 className="mb-3 font-semibold text-lg">Tags</h2>
        {tags.length === 0 ? (
          <p className="text-sm text-zinc-500">No tags found.</p>
        ) : (
          <ul className="space-y-2" aria-label="Tag List">
            {tags.map((tag, index) => {
              const isActive = tag.id === activeTagId;
              return (
                <li key={tag.id} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className={
                        isActive
                          ? 'rounded px-2 py-1 text-left font-semibold text-sm text-zinc-950'
                          : 'rounded px-2 py-1 text-left text-sm text-zinc-700'
                      }
                      onClick={() => onSelectTag(tag.id)}
                      aria-pressed={isActive}
                      aria-label={`Select tag ${tag.name}`}
                    >
                      {tag.name}
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => onMoveTag(tag.id, 'up')}
                        disabled={index === 0}
                        aria-label={`Move tag ${tag.name} up`}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => onMoveTag(tag.id, 'down')}
                        disabled={index === tags.length - 1}
                        aria-label={`Move tag ${tag.name} down`}
                      >
                        Down
                      </button>
                    </div>
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
    </aside>
  );
}
