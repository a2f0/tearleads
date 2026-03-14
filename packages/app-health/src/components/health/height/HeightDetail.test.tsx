import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeightDetail } from './HeightDetail';

const mockAddReading = vi.fn();
const mockUseHeightData = vi.fn();
const mockRegisterReadingInVfs = vi.fn().mockResolvedValue(undefined);
const mockLinkReadingToContact = vi.fn().mockResolvedValue(undefined);
let mockAvailableContacts: Array<{ id: string; name: string }> = [];

vi.mock('./useHeightData', () => ({
  useHeightData: () => mockUseHeightData()
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
    id: 'height_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 42.5,
    unit: 'in' as const,
    note: 'Annual checkup',
    contactId: null
  }
];

describe('HeightDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailableContacts = [];
    mockAddReading.mockResolvedValue({
      id: 'height_2',
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 43,
      unit: 'in' as const,
      contactId: null
    });
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(
      screen.getByText('Unlock to view height readings')
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      addReading: mockAddReading
    });

    const { container } = render(<HeightDetail />, { wrapper });

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: 'Database error',
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    expect(screen.getByText('Failed to load height data')).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
  });

  it('renders form and table when unlocked', () => {
    mockUseHeightData.mockReturnValue({
      readings: mockReadings,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    expect(
      screen.getByRole('form', { name: 'Add height reading form' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('height-table')).toBeInTheDocument();
    expect(screen.getByText('42.5 in')).toBeInTheDocument();
  });

  it('calls addReading when form is submitted', async () => {
    const user = userEvent.setup();
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    await user.type(screen.getByLabelText('Height'), '43');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockAddReading).toHaveBeenCalledTimes(1);
    });
  });

  it('registers in VFS and links to contact on submit', async () => {
    const user = userEvent.setup();
    mockAvailableContacts = [{ id: 'contact-1', name: 'Alice' }];
    mockAddReading.mockResolvedValue({
      id: 'height_3',
      recordedAt: '2024-01-17T10:00:00.000Z',
      value: 44,
      unit: 'in' as const,
      contactId: 'contact-1'
    });
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    await user.type(screen.getByLabelText('Height'), '44');
    await user.selectOptions(screen.getByLabelText('Contact'), 'contact-1');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockRegisterReadingInVfs).toHaveBeenCalledWith(
        'height_3',
        '2024-01-17T10:00:00.000Z'
      );
    });
    expect(mockLinkReadingToContact).toHaveBeenCalledWith(
      'height_3',
      'contact-1'
    );
  });

  it('shows empty state when no readings', () => {
    mockUseHeightData.mockReturnValue({
      readings: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addReading: mockAddReading
    });

    render(<HeightDetail />, { wrapper });

    expect(screen.getByText('No height readings yet')).toBeInTheDocument();
  });
});
