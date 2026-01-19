import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsWindow } from './DocumentsWindow';

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

vi.mock('@/pages/Documents', () => ({
  Documents: ({
    onSelectDocument
  }: {
    onSelectDocument?: (documentId: string) => void;
  }) => (
    <div data-testid="documents-content">
      <button
        type="button"
        onClick={() => onSelectDocument?.('doc-1')}
        data-testid="select-document"
      >
        Select Document
      </button>
    </div>
  )
}));

vi.mock('@/pages/DocumentDetail', () => ({
  DocumentDetail: ({ documentId }: { documentId?: string }) => (
    <div data-testid="document-detail">Document {documentId}</div>
  )
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() })
}));

describe('DocumentsWindow', () => {
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
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Documents');
  });

  it('renders Documents content', () => {
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('documents-content')).toBeInTheDocument();
  });

  it('renders detail view when a document is selected', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-document'));

    expect(screen.getByTestId('document-detail')).toHaveTextContent(
      'Document doc-1'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DocumentsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 700, height: 550 };
    render(
      <DocumentsWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <DocumentsWindow
        {...defaultProps}
        onDimensionsChange={onDimensionsChange}
      />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
