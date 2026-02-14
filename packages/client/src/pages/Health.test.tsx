import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Health } from './Health';

// Mock detail components that require DatabaseProvider
vi.mock('@/components/health/weight', () => ({
  WeightDetail: ({ refreshToken }: { refreshToken?: number }) => (
    <div data-testid="weight-detail-mock" data-refresh-token={refreshToken}>
      Weight Detail Mock
    </div>
  )
}));

vi.mock('@/components/health/workouts', () => ({
  WorkoutDetail: ({ refreshToken }: { refreshToken?: number }) => (
    <div data-testid="workout-detail-mock" data-refresh-token={refreshToken}>
      Workout Detail Mock
    </div>
  )
}));

vi.mock('@/components/health/blood-pressure', () => ({
  BloodPressureDetail: ({ refreshToken }: { refreshToken?: number }) => (
    <div
      data-testid="blood-pressure-detail-mock"
      data-refresh-token={refreshToken}
    >
      Blood Pressure Detail Mock
    </div>
  )
}));

vi.mock('@/components/health/exercises', () => ({
  ExerciseDetail: ({ refreshToken }: { refreshToken?: number }) => (
    <div data-testid="exercise-detail-mock" data-refresh-token={refreshToken}>
      Exercise Detail Mock
    </div>
  )
}));

import type { HealthDrilldownRoute } from './Health';

function renderHealth({
  showBackLink,
  initialEntries,
  activeRoute,
  onRouteChange
}: {
  showBackLink?: boolean;
  initialEntries?: string[];
  activeRoute?: HealthDrilldownRoute;
  onRouteChange?: (route: HealthDrilldownRoute | undefined) => void;
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries ?? ['/health']}>
      <Health
        {...(showBackLink !== undefined ? { showBackLink } : {})}
        {...(activeRoute !== undefined ? { activeRoute } : {})}
        {...(onRouteChange !== undefined ? { onRouteChange } : {})}
      />
    </MemoryRouter>
  );
}

describe('Health', () => {
  it('renders heading and health feature cards', () => {
    renderHealth();

    expect(screen.getByRole('heading', { name: 'Health' })).toBeTruthy();
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
    expect(screen.getByText('Open Weight Tracking')).toBeTruthy();
    expect(screen.getByText('Open Blood Pressure')).toBeTruthy();
    expect(screen.getByText('Open Exercises')).toBeTruthy();
    expect(screen.getByText('Open Workouts')).toBeTruthy();
  });

  it('exposes health table schema details', () => {
    renderHealth();

    expect(
      screen.getByText('table: health_height_readings (planned)')
    ).toBeTruthy();
    expect(screen.getByText('table: health_weight_readings')).toBeTruthy();
    expect(
      screen.getByText('table: health_blood_pressure_readings')
    ).toBeTruthy();
    expect(screen.getByText('table: health_exercises')).toBeTruthy();
    expect(screen.getByText('table: health_workout_entries')).toBeTruthy();

    expect(
      screen.getByText(
        'columns: id, recordedAt, valueCenti, unit, childName, note, createdAt'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'columns: id, recordedAt, valueCenti, unit, note, createdAt'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'columns: id, recordedAt, systolic, diastolic, pulse, note, createdAt'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('columns: id, name, parentId, createdAt')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'columns: id, performedAt, exerciseId, reps, weightCenti, weightUnit, note, createdAt'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('relation: exerciseId -> health_exercises.id')
    ).toBeTruthy();
  });

  it('supports click-through sub-routes in health categories', async () => {
    renderHealth();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('health-card-link-height'));
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
    expect(
      screen.getByText(
        'Coming soon — Track height measurements over time for each child.'
      )
    ).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
  });

  it('renders activeRoute when provided in window mode', () => {
    renderHealth({ showBackLink: false, activeRoute: 'height' });
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
  });

  it('calls onRouteChange when card link is clicked in window mode', async () => {
    const onRouteChange = vi.fn();
    renderHealth({ showBackLink: false, onRouteChange });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('health-card-link-height'));
    expect(onRouteChange).toHaveBeenCalledWith('height');
  });

  it('renders all drilldown routes when activeRoute is set', () => {
    const routes: HealthDrilldownRoute[] = [
      'height',
      'weight',
      'workouts',
      'blood-pressure',
      'exercises'
    ];

    routes.forEach((route) => {
      const { unmount } = renderHealth({
        showBackLink: false,
        activeRoute: route
      });
      expect(screen.getByTestId(`health-detail-${route}`)).toBeTruthy();
      unmount();
    });
  });

  it('renders workout route detail directly', () => {
    renderHealth({ initialEntries: ['/health/height'] });
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
    expect(screen.getByTestId('height-detail-placeholder')).toBeTruthy();
  });

  it('shows overview for invalid route segment', () => {
    renderHealth({ initialEntries: ['/health/invalid-route'] });
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
    expect(screen.queryByTestId('health-detail-height')).toBeNull();
  });

  it('shows the back link by default', () => {
    renderHealth();
    expect(screen.getByText('Back to Home')).toBeTruthy();
  });

  it('hides back link when showBackLink is false', () => {
    renderHealth({ showBackLink: false });
    expect(screen.queryByText('Back to Home')).toBeNull();
  });
});
