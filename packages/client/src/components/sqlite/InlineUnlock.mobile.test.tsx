import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineUnlock } from './InlineUnlock';

const mockUseDatabaseContext = vi.fn();
const mockIsBiometricAvailable = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/crypto/key-manager', () => ({
  isBiometricAvailable: () => mockIsBiometricAvailable()
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: () => 'ios'
  };
});

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('InlineUnlock mobile biometric flows', () => {
  const mockUnlock = vi.fn();
  const mockRestoreSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: true,
      isUnlocked: false,
      hasPersistedSession: false,
      unlock: mockUnlock,
      restoreSession: mockRestoreSession
    });
  });

  it.each([
    ['faceId', 'Face ID'],
    ['touchId', 'Touch ID'],
    ['fingerprint', 'Fingerprint'],
    ['iris', 'Iris'],
    ['unknown', 'Biometric']
  ])('shows biometric label for %s', async (biometryType, label) => {
    mockIsBiometricAvailable.mockResolvedValue({
      isAvailable: true,
      biometryType
    });

    renderWithRouter(<InlineUnlock />);

    await waitFor(() => {
      expect(
        screen.getByText(`Remember with ${label}`)
      ).toBeInTheDocument();
    });
  });

  it('falls back to keep unlocked when biometrics are unavailable', async () => {
    mockIsBiometricAvailable.mockResolvedValue({
      isAvailable: false,
      biometryType: null
    });

    renderWithRouter(<InlineUnlock />);

    await waitFor(() => {
      expect(screen.getByText('Keep unlocked')).toBeInTheDocument();
    });
  });

  it('renders biometric restore label when a session is persisted', async () => {
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: true,
      isUnlocked: false,
      hasPersistedSession: true,
      unlock: mockUnlock,
      restoreSession: mockRestoreSession
    });

    mockIsBiometricAvailable.mockResolvedValue({
      isAvailable: true,
      biometryType: 'faceId'
    });

    renderWithRouter(<InlineUnlock />);

    await waitFor(() => {
      expect(screen.getByTestId('inline-unlock-restore')).toHaveTextContent(
        'Face ID'
      );
    });
  });
});
