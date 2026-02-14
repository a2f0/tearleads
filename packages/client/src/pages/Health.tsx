import { getTableColumns } from 'drizzle-orm';
import {
  Activity,
  Dumbbell,
  HeartPulse,
  type LucideIcon,
  Ruler,
  Scale
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
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

interface HealthSchemaCard {
  title: string;
  description: string;
  icon: LucideIcon;
  tableName: string;
  columns: string[];
  route?: HealthDrilldownRoute;
  relation?: string;
}

type HealthDrilldownRoute = 'height' | 'weight' | 'workouts';

const HEALTH_OVERVIEW_ROUTE = '/health';
const HEALTH_ROUTE_PREFIX = '/health/';

const HEALTH_SCHEMA_CARDS: HealthSchemaCard[] = [
  {
    title: 'Height Tracking',
    description: 'Track height over time for each child.',
    icon: Ruler,
    tableName: 'health_height_readings (planned)',
    route: 'height',
    columns: [
      'id',
      'recordedAt',
      'valueCenti',
      'unit',
      'childName',
      'note',
      'createdAt'
    ]
  },
  {
    title: 'Weight Tracking',
    description: 'Record and review weight history.',
    icon: Scale,
    tableName: 'health_weight_readings',
    route: 'weight',
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
    route: 'workouts',
    columns: Object.keys(getTableColumns(healthWorkoutEntries)),
    relation: 'exerciseId -> health_exercises.id'
  }
];

const DRILLDOWN_ROUTES: readonly HealthDrilldownRoute[] = [
  'height',
  'weight',
  'workouts'
];

const isDrilldownRoute = (
  value: string | undefined
): value is HealthDrilldownRoute =>
  value !== undefined && DRILLDOWN_ROUTES.some((route) => route === value);

const getActiveHealthRoute = (
  pathname: string
): HealthDrilldownRoute | undefined => {
  if (!pathname.startsWith(HEALTH_ROUTE_PREFIX)) {
    return undefined;
  }

  const suffix = pathname.slice(HEALTH_ROUTE_PREFIX.length);
  const segment = suffix.split('/')[0];

  return isDrilldownRoute(segment) ? segment : undefined;
};

const isDrilldownCard = (
  card: HealthSchemaCard
): card is HealthSchemaCard & { route: HealthDrilldownRoute } =>
  card.route !== undefined;

const HEALTH_DRILLDOWN_CARDS = HEALTH_SCHEMA_CARDS.filter(isDrilldownCard);

export function Health({ showBackLink = true }: HealthProps) {
  const location = useLocation();
  const activeRoute = getActiveHealthRoute(location.pathname);
  const activeCard =
    HEALTH_DRILLDOWN_CARDS.find((card) => card.route === activeRoute) ??
    undefined;

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

      <div className="mb-3 flex flex-wrap gap-2">
        <Link
          className="rounded-md border px-2 py-1 text-xs"
          to={HEALTH_OVERVIEW_ROUTE}
        >
          Overview
        </Link>
        {HEALTH_DRILLDOWN_CARDS.map((card) => (
          <Link
            key={card.route}
            className="rounded-md border px-2 py-1 text-xs"
            data-testid={`health-nav-${card.route}`}
            to={`${HEALTH_ROUTE_PREFIX}${card.route}`}
          >
            {card.title}
          </Link>
        ))}
      </div>

      {activeCard ? (
        <div
          className="rounded-lg border p-4"
          data-testid={`health-detail-${activeCard.route}`}
        >
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <activeCard.icon className="h-4 w-4" />
            {activeCard.title}
          </div>
          <p className="mt-2 text-sm">{activeCard.description}</p>
          <p className="mt-2 font-mono text-muted-foreground text-xs">
            route: {HEALTH_ROUTE_PREFIX}
            {activeCard.route}
          </p>
          <p className="mt-1 font-mono text-muted-foreground text-xs">
            table: {activeCard.tableName}
          </p>
          <p className="mt-1 font-mono text-muted-foreground text-xs">
            columns: {activeCard.columns.join(', ')}
          </p>
          {activeCard.relation ? (
            <p className="mt-1 font-mono text-muted-foreground text-xs">
              relation: {activeCard.relation}
            </p>
          ) : null}
          <Link
            className="mt-3 inline-flex rounded-md border px-2 py-1 text-xs"
            data-testid="health-overview-link"
            to={HEALTH_OVERVIEW_ROUTE}
          >
            Back to Overview
          </Link>
        </div>
      ) : (
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
                {card.route ? (
                  <Link
                    className="mt-3 inline-flex rounded-md border px-2 py-1 text-xs"
                    data-testid={`health-card-link-${card.route}`}
                    to={`${HEALTH_ROUTE_PREFIX}${card.route}`}
                  >
                    Open {card.title}
                  </Link>
                ) : (
                  <p className="mt-3 text-muted-foreground text-xs">
                    Sub-route coming soon
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
