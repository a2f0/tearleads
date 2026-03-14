import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { HealthTracker } from '../lib/healthTracker';
import { HealthRuntimeProvider } from '../runtime';
import { Health } from './Health';

import type { HealthDrilldownRoute } from './Health';

const mockTracker: HealthTracker = {
  listExercises: vi.fn(async () => []),
  listParentExercises: vi.fn(async () => []),
  listChildExercises: vi.fn(async () => []),
  getExerciseHierarchy: vi.fn(async () => new Map()),
  addExercise: vi.fn(async (input) => ({
    id: input.id ?? 'exercise_1',
    name: input.name,
    ...(input.parentId ? { parentId: input.parentId } : {})
  })),
  listHeightReadings: vi.fn(async () => []),
  addHeightReading: vi.fn(async (input) => ({
    id: 'height_1',
    recordedAt: new Date(input.recordedAt).toISOString(),
    value: input.value,
    unit: input.unit ?? 'in',
    contactId: input.contactId ?? null,
    ...(input.note ? { note: input.note } : {})
  })),
  listWeightReadings: vi.fn(async () => []),
  addWeightReading: vi.fn(async (input) => ({
    id: 'weight_1',
    recordedAt: new Date(input.recordedAt).toISOString(),
    value: input.value,
    unit: input.unit ?? 'lb',
    contactId: input.contactId ?? null,
    ...(input.note ? { note: input.note } : {})
  })),
  listBloodPressureReadings: vi.fn(async () => []),
  addBloodPressureReading: vi.fn(async (input) => ({
    id: 'bp_1',
    recordedAt: new Date(input.recordedAt).toISOString(),
    systolic: input.systolic,
    diastolic: input.diastolic,
    contactId: input.contactId ?? null,
    ...(input.pulse ? { pulse: input.pulse } : {}),
    ...(input.note ? { note: input.note } : {})
  })),
  listWorkoutEntries: vi.fn(async () => []),
  addWorkoutEntry: vi.fn(async (input) => ({
    id: 'workout_1',
    performedAt: new Date(input.performedAt).toISOString(),
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseId,
    reps: input.reps,
    weight: input.weight,
    weightUnit: input.weightUnit ?? 'lb',
    contactId: input.contactId ?? null,
    ...(input.note ? { note: input.note } : {})
  })),
  updateContactId: vi.fn(async () => {})
};

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
      <HealthRuntimeProvider
        databaseState={{
          isUnlocked: true,
          isLoading: false,
          currentInstanceId: 'test-instance'
        }}
        createTracker={() => mockTracker}
        availableContacts={[]}
      >
        <Health
          {...(showBackLink !== undefined ? { showBackLink } : {})}
          {...(activeRoute !== undefined ? { activeRoute } : {})}
          {...(onRouteChange !== undefined ? { onRouteChange } : {})}
        />
      </HealthRuntimeProvider>
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

  it('supports click-through sub-routes in health categories', async () => {
    renderHealth();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('health-card-link-height'));
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
    expect(screen.getByText('No height readings yet')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
  });

  it('renders activeRoute when provided in window mode', async () => {
    renderHealth({ showBackLink: false, activeRoute: 'height' });
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('No height readings yet')).toBeTruthy();
    });
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

  it('renders workout route detail directly', async () => {
    renderHealth({ initialEntries: ['/health/height'] });
    expect(screen.getByTestId('health-detail-height')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('No height readings yet')).toBeTruthy();
    });
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
