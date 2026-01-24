import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { V86Window } from './V86Window';

vi.mock('./IsoDirectory', () => ({
  IsoDirectory: ({
    onSelectIso
  }: {
    onSelectIso: (entry: unknown) => void;
  }) => (
    <div data-testid="iso-directory">
      <button
        type="button"
        onClick={() =>
          onSelectIso({
            id: 'test-iso',
            name: 'Test ISO',
            memoryMb: 256,
            bootType: 'cdrom'
          })
        }
      >
        Select Test ISO
      </button>
    </div>
  )
}));

vi.mock('./V86Emulator', () => ({
  V86Emulator: ({
    iso,
    onBack
  }: {
    iso: { name: string };
    onBack: () => void;
  }) => (
    <div data-testid="v86-emulator">
      <span>Emulator: {iso.name}</span>
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  )
}));

describe('V86Window', () => {
  const defaultProps = {
    id: 'test-v86-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onDimensionsChange: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100,
    initialDimensions: undefined
  };

  it('renders the floating window with correct title', () => {
    render(<V86Window {...defaultProps} />);
    expect(screen.getByText('v86')).toBeInTheDocument();
  });

  it('shows IsoDirectory initially', () => {
    render(<V86Window {...defaultProps} />);
    expect(screen.getByTestId('iso-directory')).toBeInTheDocument();
    expect(screen.queryByTestId('v86-emulator')).not.toBeInTheDocument();
  });

  it('switches to V86Emulator when an ISO is selected', async () => {
    const user = userEvent.setup();
    render(<V86Window {...defaultProps} />);

    await user.click(screen.getByText('Select Test ISO'));

    expect(screen.getByTestId('v86-emulator')).toBeInTheDocument();
    expect(screen.getByText('Emulator: Test ISO')).toBeInTheDocument();
    expect(screen.queryByTestId('iso-directory')).not.toBeInTheDocument();
  });

  it('returns to IsoDirectory when back is clicked', async () => {
    const user = userEvent.setup();
    render(<V86Window {...defaultProps} />);

    await user.click(screen.getByText('Select Test ISO'));
    expect(screen.getByTestId('v86-emulator')).toBeInTheDocument();

    await user.click(screen.getByText('Back'));
    expect(screen.getByTestId('iso-directory')).toBeInTheDocument();
    expect(screen.queryByTestId('v86-emulator')).not.toBeInTheDocument();
  });

  it('renders with initial dimensions when provided', () => {
    const initialDimensions = {
      x: 100,
      y: 100,
      width: 900,
      height: 700
    };
    render(
      <V86Window {...defaultProps} initialDimensions={initialDimensions} />
    );
    expect(screen.getByText('v86')).toBeInTheDocument();
  });

  it('renders the menu bar', () => {
    render(<V86Window {...defaultProps} />);
    expect(screen.getByText('File')).toBeInTheDocument();
  });
});
