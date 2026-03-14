import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BloodPressureDetail as BloodPressureDetailComponent } from './BloodPressureDetail';

const mockAddReading = vi.fn();
const mockUseBloodPressureData = vi.fn();
const mockRegisterReadingInVfs = vi.fn().mockResolvedValue(undefined);
const mockLinkReadingToContact = vi.fn().mockResolvedValue(undefined);
let mockAvailableContacts: Array<{ id: string; name: string }> = [];
let BloodPressureDetail: typeof BloodPressureDetailComponent;
let componentVersion = 0;

vi.mock('./useBloodPressureData', () => ({
  useBloodPressureData: () => mockUseBloodPressureData()
}));

vi.mock('../../../runtime', () => ({
  useHealthRuntime: () => ({
    InlineUnlock: ({ description }: { description: string }) => (
      <div data-testid="inline-unlock">Unlock to view {description}</div>
    ),
    registerReadingInVfs: mockRegisterReadingInVfs,
    linkReadingToContact: mockLinkReadingToContact,
    availableContacts: mockAvailableContacts
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
    note: 'Morning reading',
    contactId: null
  }
];

describe('BloodPressureDetail', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockAvailableContacts = [];
    mockAddReading.mockResolvedValue({
      id: 'bp_2',
      recordedAt: '2024-01-16T10:00:00.000Z',
      systolic: 118,
      diastolic: 78,
      contactId: null
    });
    componentVersion += 1;
    const module = await import(
      `./BloodPressureDetail.tsx?test=${componentVersion}`
    );
    BloodPressureDetail = module.BloodPressureDetail;
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addReading: mockAddReading,
      refresh: vi.fn()
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
      addReading: mockAddReading,
      refresh: vi.fn()
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
      addReading: mockAddReading,
      refresh: vi.fn()
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
      addReading: mockAddReading,
      refresh: vi.fn()
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
      addReading: mockAddReading,
      refresh: vi.fn()
    });

    render(<BloodPressureDetail />, { wrapper });

    await user.type(screen.getByLabelText('Systolic'), '120');
    await user.type(screen.getByLabelText('Diastolic'), '80');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockAddReading).toHaveBeenCalledTimes(1);
    });
  });

  it('registers in VFS and links to contact on submit', async () => {
    const user = userEvent.setup();
    mockAvailableContacts = [{ id: 'contact-1', name: 'Alice' }];
    mockAddReading.mockResolvedValue({
      id: 'bp_3',
      recordedAt: '2024-01-17T10:00:00.000Z',
      systolic: 115,
      diastolic: 75,
      contactId: 'contact-1'
    });
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading,
      refresh: vi.fn()
    });

    render(<BloodPressureDetail />, { wrapper });

    await user.type(screen.getByLabelText('Systolic'), '115');
    await user.type(screen.getByLabelText('Diastolic'), '75');
    await user.selectOptions(screen.getByLabelText('Contact'), 'contact-1');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockRegisterReadingInVfs).toHaveBeenCalledWith(
        'bp_3',
        '2024-01-17T10:00:00.000Z'
      );
    });
    expect(mockLinkReadingToContact).toHaveBeenCalledWith('bp_3', 'contact-1');
  });

  it('shows empty state when no readings', () => {
    mockUseBloodPressureData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading,
      refresh: vi.fn()
    });

    render(<BloodPressureDetail />, { wrapper });

    expect(
      screen.getByText('No blood pressure readings yet')
    ).toBeInTheDocument();
  });
});
