import classicPackageJson from '@tearleads/classic/package.json';
import {
  ENTRY_SORT_OPTIONS,
  TAG_SORT_OPTIONS,
  type EntrySortOrder,
  type TagSortOrder
} from '@tearleads/classic';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface ClassicWindowMenuBarProps {
  onClose: () => void;
  tagSortOrder: TagSortOrder;
  entrySortOrder: EntrySortOrder;
  onTagSortOrderChange: (nextSortOrder: TagSortOrder) => void;
  onEntrySortOrderChange: (nextSortOrder: EntrySortOrder) => void;
}

const NOOP = () => {};

export function ClassicWindowMenuBar({
  onClose,
  tagSortOrder,
  entrySortOrder,
  onTagSortOrderChange,
  onEntrySortOrderChange
}: ClassicWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={NOOP}>New Entry</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Edit">
        <DropdownMenuItem onClick={NOOP} disabled>
          Undo
        </DropdownMenuItem>
        <DropdownMenuItem onClick={NOOP} disabled>
          Redo
        </DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Tags">
        <DropdownMenuItem onClick={NOOP}>New Tag</DropdownMenuItem>
        <DropdownMenuSeparator />
        {TAG_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            checked={tagSortOrder === option.value}
            onClick={() => onTagSortOrderChange(option.value)}
          >
            Sort by {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu trigger="Entries">
        <DropdownMenuItem onClick={NOOP}>New Entry</DropdownMenuItem>
        <DropdownMenuSeparator />
        {ENTRY_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            checked={entrySortOrder === option.value}
            onClick={() => onEntrySortOrderChange(option.value)}
          >
            Sort by {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem
          appName="Classic"
          version={classicPackageJson.version}
          closeLabel="Close"
        />
      </DropdownMenu>
    </div>
  );
}
