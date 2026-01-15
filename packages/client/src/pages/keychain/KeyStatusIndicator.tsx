import { Check, X } from 'lucide-react';

interface KeyStatusIndicatorProps {
  exists: boolean;
  label: string;
}

export function KeyStatusIndicator({ exists, label }: KeyStatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {exists ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}
