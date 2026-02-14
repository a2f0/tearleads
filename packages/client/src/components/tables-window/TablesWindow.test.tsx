import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TablesWindow } from './TablesWindow';

function renderTablesWindow(props: ComponentProps<typeof TablesWindow>) {
  return render(
    <MemoryRouter initialEntries={['/sqlite/tables']}>
      <TablesWindow {...props} />
    </MemoryRouter>
  );
}

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
  DesktopFloatingWindow: ({
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
  };
});

vi.mock('@/pages/Tables', () => ({
  Tables: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="tables-content" data-show-back-link={showBackLink}>
      Tables Content
    </div>
  )
}));

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
    renderTablesWindow(defaultProps);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    renderTablesWindow(defaultProps);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Tables');
  });

  it('renders tables content', () => {
    renderTablesWindow(defaultProps);
    expect(screen.getByTestId('tables-content')).toBeInTheDocument();
    expect(screen.getByTestId('tables-content')).toHaveAttribute(
      'data-show-back-link',
      'false'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTablesWindow({ ...defaultProps, onClose });

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 700, height: 550 };
    renderTablesWindow({ ...defaultProps, initialDimensions });
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    renderTablesWindow({ ...defaultProps, onDimensionsChange });
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
