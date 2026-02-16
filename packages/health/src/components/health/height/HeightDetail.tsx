import { Construction, Ruler } from 'lucide-react';

export function HeightDetail() {
  return (
    <div
      className="flex h-full min-h-40 flex-col items-center justify-center gap-4 rounded-lg border p-8 text-center"
      data-testid="height-detail-placeholder"
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <Ruler className="h-8 w-8" />
        <Construction className="h-6 w-6" />
      </div>
      <div className="space-y-2">
        <h2 className="font-medium text-lg">Height Tracking</h2>
        <p className="text-muted-foreground text-sm">
          Coming soon — Track height measurements over time for each child.
        </p>
        <p className="text-muted-foreground text-xs">
          Schema:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            health_height_readings
          </code>
        </p>
      </div>
    </div>
  );
}
