import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TablesWindow } from './TablesWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    ...rest
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="floating-window"
      data-props={JSON.stringify(rest)}
      data-props-keys={JSON.stringify(Object.keys(rest))}
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/Tables', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    Tables: () => {
      const location = useLocation();
      return <div data-testid="tables-content">{location.pathname}</div>;
    }
  };
});

vi.mock('@/pages/TableRows', () => ({
  TableRows: () => <div data-testid="table-rows-content">Rows Content</div>
}));

describe('TablesWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<TablesWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<TablesWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Tables');
  });

  it('renders tables content', () => {
    render(<TablesWindow {...defaultProps} />);
    expect(screen.getByTestId('tables-content')).toHaveTextContent(
      '/sqlite/tables'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TablesWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 700, height: 550 };
    render(
      <TablesWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <TablesWindow {...defaultProps} onDimensionsChange={onDimensionsChange} />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
