import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Health } from './Health';

function renderHealth({
  showBackLink,
  initialEntries
}: {
  showBackLink?: boolean;
  initialEntries?: string[];
} = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries ?? ['/health']}>
      <Health {...(showBackLink !== undefined ? { showBackLink } : {})} />
    </MemoryRouter>
  );
}

describe('Health', () => {
  it('renders heading and health feature cards', () => {
    renderHealth();

    expect(screen.getByRole('heading', { name: 'Health' })).toBeTruthy();
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
    expect(screen.getByText('Open Weight Tracking')).toBeTruthy();
    expect(screen.getByText('Blood Pressure')).toBeTruthy();
    expect(screen.getByText('Exercises')).toBeTruthy();
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
    expect(screen.getByText('columns: id, name, createdAt')).toBeTruthy();
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
    expect(screen.getByText('route: /health/height')).toBeTruthy();

    await user.click(screen.getByTestId('health-nav-weight'));
    expect(screen.getByTestId('health-detail-weight')).toBeTruthy();

    await user.click(screen.getByTestId('health-overview-link'));
    expect(screen.getByText('Open Height Tracking')).toBeTruthy();
  });

  it('renders workout route detail directly', () => {
    renderHealth({ initialEntries: ['/health/workouts'] });
    expect(screen.getByTestId('health-detail-workouts')).toBeTruthy();
    expect(screen.getByText('route: /health/workouts')).toBeTruthy();
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
