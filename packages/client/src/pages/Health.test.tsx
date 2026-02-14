import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Health } from './Health';

function renderHealth(props?: { showBackLink?: boolean }) {
  return render(
    <MemoryRouter>
      <Health {...props} />
    </MemoryRouter>
  );
}

describe('Health', () => {
  it('renders heading and health feature cards', () => {
    renderHealth();

    expect(screen.getByRole('heading', { name: 'Health' })).toBeTruthy();
    expect(screen.getByText('Weight Tracking')).toBeTruthy();
    expect(screen.getByText('Blood Pressure')).toBeTruthy();
    expect(screen.getByText('Exercises')).toBeTruthy();
    expect(screen.getByText('Workouts')).toBeTruthy();
  });

  it('exposes health table schema details', () => {
    renderHealth();

    expect(screen.getByText('table: health_weight_readings')).toBeTruthy();
    expect(screen.getByText('table: health_blood_pressure_readings')).toBeTruthy();
    expect(screen.getByText('table: health_exercises')).toBeTruthy();
    expect(screen.getByText('table: health_workout_entries')).toBeTruthy();

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

  it('shows the back link by default', () => {
    renderHealth();
    expect(screen.getByText('Back to Home')).toBeTruthy();
  });

  it('hides back link when showBackLink is false', () => {
    renderHealth({ showBackLink: false });
    expect(screen.queryByText('Back to Home')).toBeNull();
  });
});
