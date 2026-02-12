import { Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ColumnInfo } from '@/components/sqlite/exportTableCsv';
import { Button } from '@/components/ui/button';

interface ColumnSettingsDropdownProps {
  columns: ColumnInfo[];
  hiddenColumns: Set<string>;
  onToggleColumn: (columnName: string) => void;
}

export function ColumnSettingsDropdown({
  columns,
  hiddenColumns,
  onToggleColumn
}: ColumnSettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant={isOpen ? 'default' : 'outline'}
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        title="Column settings"
        data-testid="column-settings-button"
      >
        <Settings className="h-4 w-4" />
      </Button>
      {isOpen && columns.length > 0 && (
        <div className="absolute top-full right-0 z-10 mt-2 w-56 rounded-lg border bg-popover p-2 shadow-lg">
          <div className="mb-2 px-2 font-medium text-sm">Visible Columns</div>
          <div className="max-h-64 overflow-y-auto">
            {columns.map((col) => (
              <label
                key={col.name}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(col.name)}
                  onChange={() => onToggleColumn(col.name)}
                  className="h-5 w-5 rounded border-input"
                  data-testid={`column-toggle-${col.name}`}
                />
                <span className="font-mono text-base">{col.name}</span>
                {col.pk > 0 && (
                  <span className="ml-auto text-primary text-xs">PK</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
