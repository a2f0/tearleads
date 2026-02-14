import { Activity, Dumbbell, HeartPulse, Scale } from 'lucide-react';
import { getTableColumns } from 'drizzle-orm';
import { BackLink } from '@/components/ui/back-link';
import {
  healthBloodPressureReadings,
  healthExercises,
  healthWeightReadings,
  healthWorkoutEntries
} from '@/db/schema';

interface HealthProps {
  showBackLink?: boolean;
}

const HEALTH_SCHEMA_CARDS = [
  {
    title: 'Weight Tracking',
    description: 'Record and review weight history.',
    icon: Scale,
    tableName: 'health_weight_readings',
    columns: Object.keys(getTableColumns(healthWeightReadings))
  },
  {
    title: 'Blood Pressure',
    description: 'Capture systolic/diastolic readings over time.',
    icon: HeartPulse,
    tableName: 'health_blood_pressure_readings',
    columns: Object.keys(getTableColumns(healthBloodPressureReadings))
  },
  {
    title: 'Exercises',
    description: 'Maintain a reusable exercise catalog for workouts.',
    icon: Dumbbell,
    tableName: 'health_exercises',
    columns: Object.keys(getTableColumns(healthExercises))
  },
  {
    title: 'Workouts',
    description: 'Log reps, weight, and workout notes for each session.',
    icon: Activity,
    tableName: 'health_workout_entries',
    columns: Object.keys(getTableColumns(healthWorkoutEntries)),
    relation: 'exerciseId -> health_exercises.id'
  }
] as const;

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
        {HEALTH_SCHEMA_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.tableName} className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Icon className="h-4 w-4" />
                {card.title}
              </div>
              <p className="mt-2 text-sm">{card.description}</p>
              <p className="mt-2 font-mono text-muted-foreground text-xs">
                table: {card.tableName}
              </p>
              <p className="mt-1 font-mono text-muted-foreground text-xs">
                columns: {card.columns.join(', ')}
              </p>
              {card.relation ? (
                <p className="mt-1 font-mono text-muted-foreground text-xs">
                  relation: {card.relation}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
