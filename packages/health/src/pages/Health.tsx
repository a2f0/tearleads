import {
  Activity,
  Dumbbell,
  HeartPulse,
  type LucideIcon,
  Ruler,
  Scale
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import {
  BloodPressureDetail,
  ExerciseDetail,
  HeightDetail,
  WeightDetail,
  WorkoutDetail
} from '../components/health';
import { BackLink } from '@/components/ui/back-link';

export type HealthDrilldownRoute =
  | 'height'
  | 'weight'
  | 'workouts'
  | 'blood-pressure'
  | 'exercises';

interface HealthProps {
  showBackLink?: boolean;
  refreshToken?: number;
  activeRoute?: HealthDrilldownRoute | undefined;
  onRouteChange?: (route: HealthDrilldownRoute | undefined) => void;
}

interface HealthCard {
  title: string;
  description: string;
  icon: LucideIcon;
  route: HealthDrilldownRoute;
}

const HEALTH_OVERVIEW_ROUTE = '/health';
const HEALTH_ROUTE_PREFIX = '/health/';

const HEALTH_CARDS: HealthCard[] = [
  {
    title: 'Height Tracking',
    description: 'Track height over time for each child.',
    icon: Ruler,
    route: 'height'
  },
  {
    title: 'Weight Tracking',
    description: 'Record and review weight history.',
    icon: Scale,
    route: 'weight'
  },
  {
    title: 'Blood Pressure',
    description: 'Capture systolic/diastolic readings over time.',
    icon: HeartPulse,
    route: 'blood-pressure'
  },
  {
    title: 'Exercises',
    description: 'Maintain a reusable exercise catalog for workouts.',
    icon: Dumbbell,
    route: 'exercises'
  },
  {
    title: 'Workouts',
    description: 'Log reps, weight, and workout notes for each session.',
    icon: Activity,
    route: 'workouts'
  }
];

const DRILLDOWN_ROUTES: readonly HealthDrilldownRoute[] = [
  'height',
  'weight',
  'workouts',
  'blood-pressure',
  'exercises'
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

export const HEALTH_DRILLDOWN_CARDS = HEALTH_CARDS;

export function Health({
  showBackLink = true,
  refreshToken = 0,
  activeRoute: controlledRoute,
  onRouteChange
}: HealthProps) {
  const location = useLocation();
  const routeFromPath = getActiveHealthRoute(location.pathname);

  // Use controlled route when in window mode (showBackLink=false), path-based when in page mode
  const activeRoute = showBackLink ? routeFromPath : controlledRoute;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {showBackLink && (
        <div className="flex flex-col gap-2 pb-4">
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
          <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
            Health
          </h1>
          <p className="text-muted-foreground text-sm">
            Health is now available as a desktop launcher and Start menu item.
          </p>
        </div>
      )}

      {showBackLink && (
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
      )}

      {activeRoute ? (
        <div
          className="min-h-0 flex-1 overflow-hidden"
          data-testid={`health-detail-${activeRoute}`}
        >
          {activeRoute === 'height' && <HeightDetail />}
          {activeRoute === 'weight' && (
            <WeightDetail refreshToken={refreshToken} />
          )}
          {activeRoute === 'workouts' && (
            <WorkoutDetail refreshToken={refreshToken} />
          )}
          {activeRoute === 'blood-pressure' && (
            <BloodPressureDetail refreshToken={refreshToken} />
          )}
          {activeRoute === 'exercises' && (
            <ExerciseDetail refreshToken={refreshToken} />
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {HEALTH_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.route} className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Icon className="h-4 w-4" />
                  {card.title}
                </div>
                <p className="mt-2 text-sm">{card.description}</p>
                {showBackLink ? (
                  <Link
                    className="mt-3 inline-flex rounded-md border px-2 py-1 text-xs"
                    data-testid={`health-card-link-${card.route}`}
                    to={`${HEALTH_ROUTE_PREFIX}${card.route}`}
                  >
                    Open {card.title}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="mt-3 inline-flex rounded-md border px-2 py-1 text-xs"
                    data-testid={`health-card-link-${card.route}`}
                    onClick={() => onRouteChange?.(card.route)}
                  >
                    Open {card.title}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
