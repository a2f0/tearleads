import { ClassicApp } from '@rapid/classic';
import { BackLink } from '@/components/ui/back-link';
import { CLASSIC_INITIAL_STATE } from '@/lib/classicState';

export function Classic() {
  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <h1 className="font-bold text-2xl tracking-tight">Classic</h1>
        <p className="text-muted-foreground text-sm">
          Tag-sorted notes workspace with per-tag ordering.
        </p>
      </div>

      <div className="min-h-0 flex-1 rounded-lg border">
        <ClassicApp initialState={CLASSIC_INITIAL_STATE} />
      </div>
    </div>
  );
}
