import type { ClassicTag } from '../lib/types';

interface TagSidebarProps {
  tags: ClassicTag[];
  activeTagId: string | null;
  onSelectTag: (tagId: string) => void;
  onMoveTag: (tagId: string, direction: 'up' | 'down') => void;
}

export function TagSidebar({
  tags,
  activeTagId,
  onSelectTag,
  onMoveTag
}: TagSidebarProps) {
  return (
    <aside className="w-72 border-r p-3" aria-label="Tags Sidebar">
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
                        ? 'rounded px-2 py-1 text-left text-sm font-semibold text-zinc-950'
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
    </aside>
  );
}
