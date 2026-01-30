import { GripVertical } from 'lucide-react';

interface ColumnChipProps {
  header: string;
}

export function ColumnChip({ header }: ColumnChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="truncate">{header}</span>
    </div>
  );
}
