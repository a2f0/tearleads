import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeightDetail } from './WeightDetail';

const mockAddReading = vi.fn();
const mockUseWeightData = vi.fn();
const mockRegisterReadingInVfs = vi.fn().mockResolvedValue(undefined);
const mockLinkReadingToContact = vi.fn().mockResolvedValue(undefined);
let mockAvailableContacts: Array<{ id: string; name: string }> = [];

vi.mock('./useWeightData', () => ({
  useWeightData: () => mockUseWeightData()
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
    id: 'weight_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 185.5,
    unit: 'lb' as const,
    note: 'Morning weight',
    contactId: null
  }
];

describe('WeightDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailableContacts = [];
    mockAddReading.mockResolvedValue({
      id: 'weight_2',
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 184,
      unit: 'lb' as const,
      contactId: null
    });
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(
      screen.getByText('Unlock to view weight readings')
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      addReading: mockAddReading
    });

    const { container } = render(<WeightDetail />, { wrapper });

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: 'Database error',
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    expect(screen.getByText('Failed to load weight data')).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
  });

  it('renders form and table when unlocked', () => {
    mockUseWeightData.mockReturnValue({
      readings: mockReadings,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    expect(
      screen.getByRole('form', { name: 'Add weight reading form' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('weight-table')).toBeInTheDocument();
    expect(screen.getByText('185.5 lb')).toBeInTheDocument();
  });

  it('calls addReading when form is submitted', async () => {
    const user = userEvent.setup();
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    await user.type(screen.getByLabelText('Weight'), '184');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockAddReading).toHaveBeenCalledTimes(1);
    });
  });

  it('registers in VFS and links to contact on submit', async () => {
    const user = userEvent.setup();
    mockAvailableContacts = [{ id: 'contact-1', name: 'Alice' }];
    mockAddReading.mockResolvedValue({
      id: 'weight_3',
      recordedAt: '2024-01-17T10:00:00.000Z',
      value: 183,
      unit: 'lb' as const,
      contactId: 'contact-1'
    });
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    await user.type(screen.getByLabelText('Weight'), '183');
    await user.selectOptions(screen.getByLabelText('Contact'), 'contact-1');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockRegisterReadingInVfs).toHaveBeenCalledWith(
        'weight_3',
        '2024-01-17T10:00:00.000Z'
      );
    });
    expect(mockLinkReadingToContact).toHaveBeenCalledWith(
      'weight_3',
      'contact-1'
    );
  });

  it('shows empty state when no readings', () => {
    mockUseWeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<WeightDetail />, { wrapper });

    expect(screen.getByText('No weight readings yet')).toBeInTheDocument();
  });
});
