import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BloodPressureDetail } from './BloodPressureDetail';

const mockAddReading = vi.fn();
const mockUseBloodPressureData = vi.fn();

vi.mock('./useBloodPressureData', () => ({
  useBloodPressureData: () => mockUseBloodPressureData()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock to view {description}</div>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: vi.fn()
  })
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const mockReadings = [
  {
    id: 'bp_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    note: 'Morning reading'
  }
];

describe('BloodPressureDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddReading.mockResolvedValue({
      id: 'bp_2',
      recordedAt: '2024-01-16T10:00:00.000Z',
      systolic: 118,
      diastolic: 78
    });
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addReading: mockAddReading
    });

    render(<BloodPressureDetail />, { wrapper });

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(
      screen.getByText('Unlock to view blood pressure readings')
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      addReading: mockAddReading
    });

    const { container } = render(<BloodPressureDetail />, { wrapper });

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: 'Database error',
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<BloodPressureDetail />, { wrapper });

    expect(
      screen.getByText('Failed to load blood pressure data')
    ).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
  });

  it('renders form and table when unlocked', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: mockReadings,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<BloodPressureDetail />, { wrapper });

    expect(
      screen.getByRole('form', { name: 'Add blood pressure reading form' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('blood-pressure-table')).toBeInTheDocument();
    expect(screen.getByText('120/80')).toBeInTheDocument();
  });

  it('calls addReading when form is submitted', async () => {
    const user = userEvent.setup();
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<BloodPressureDetail />, { wrapper });

    await user.type(screen.getByLabelText('Systolic'), '120');
    await user.type(screen.getByLabelText('Diastolic'), '80');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockAddReading).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no readings', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<BloodPressureDetail />, { wrapper });

    expect(
      screen.getByText('No blood pressure readings yet')
    ).toBeInTheDocument();
  });
});
