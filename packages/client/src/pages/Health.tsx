import { Activity, Dumbbell, HeartPulse, Scale } from 'lucide-react';
import { BackLink } from '@/components/ui/back-link';

interface HealthProps {
  showBackLink?: boolean;
}

export function Health({ showBackLink = true }: HealthProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        {showBackLink ? (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        ) : null}
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">Health</h1>
        <p className="text-muted-foreground text-sm">
          Health is now available as a desktop launcher and Start menu item.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Scale className="h-4 w-4" />
            Weight Tracking
          </div>
          <p className="mt-2 text-sm">Record and review weight history.</p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <HeartPulse className="h-4 w-4" />
            Blood Pressure
          </div>
          <p className="mt-2 text-sm">
            Capture systolic/diastolic readings over time.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Dumbbell className="h-4 w-4" />
            Exercises
          </div>
          <p className="mt-2 text-sm">
            Maintain a reusable exercise catalog for workouts.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Activity className="h-4 w-4" />
            Workouts
          </div>
          <p className="mt-2 text-sm">
            Log reps, weight, and workout notes for each session.
          </p>
        </div>
      </div>
    </div>
  );
}
