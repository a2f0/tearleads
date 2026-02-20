import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedCSV } from '@/hooks/contacts';
import { ColumnMapper } from './ColumnMapper';

type DragStartPayload = { active: { id: string } };
type DragEndPayload = {
  active: { data: { current: { index: number } | null } };
  over: { id: string } | null;
};

const dragHandlers: {
  onDragStart?: (event: DragStartPayload) => void;
  onDragEnd?: (event: DragEndPayload) => void;
} = {};

vi.mock('@dnd-kit/core', async () => {
  const actual =
    await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({
      onDragStart,
      onDragEnd,
      children
    }: {
      onDragStart?: (event: DragStartPayload) => void;
      onDragEnd?: (event: DragEndPayload) => void;
      children: ReactNode;
    }) => {
      if (onDragStart) dragHandlers.onDragStart = onDragStart;
      else delete dragHandlers.onDragStart;
      if (onDragEnd) dragHandlers.onDragEnd = onDragEnd;
      else delete dragHandlers.onDragEnd;
      return <div data-testid="dnd-context">{children}</div>;
    },
    DragOverlay: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    )
  };
});

const createMockCSVData = (
  headers: string[],
  rows: string[][] = []
): ParsedCSV => ({
  headers,
  rows
});

const defaultProps = {
  data: createMockCSVData(
    ['Column A', 'Column B', 'Column C'],
    [
      ['Value A1', 'Value B1', 'Value C1'],
      ['Value A2', 'Value B2', 'Value C2']
    ]
  ),
  onImport: vi.fn(),
  onCancel: vi.fn(),
  importing: false
};

describe('ColumnMapper', () => {
  it('renders CSV column headers and contact field sections', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getByText('Column A')).toBeInTheDocument();
    expect(screen.getByText('Column B')).toBeInTheDocument();
    expect(screen.getByText('CSV Columns')).toBeInTheDocument();
    expect(screen.getByText('Contact Fields')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('renders basic contact fields with required indicator', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getByText('First Name')).toBeInTheDocument();
    expect(screen.getByText('Last Name')).toBeInTheDocument();
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    const firstNameLabel = screen.getByText('First Name');
    const parent = firstNameLabel.parentElement;
    expect(parent).toBeInTheDocument();
    if (parent) expect(within(parent).getByText('*')).toBeInTheDocument();
  });

  it('renders email and phone field groups', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getByText('Email 1')).toBeInTheDocument();
    expect(screen.getByText('Email 2')).toBeInTheDocument();
    expect(screen.getByText('Phone 1')).toBeInTheDocument();
    expect(screen.getByText('Phone 2')).toBeInTheDocument();
    expect(screen.getByText('Phone 3')).toBeInTheDocument();
  });

  it('disables Import button when firstName is not mapped', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('enables Import when a valid drag maps first name', () => {
    render(<ColumnMapper {...defaultProps} />);
    const importButton = screen.getByRole('button', { name: /import/i });
    expect(importButton).toBeDisabled();
    act(() => {
      dragHandlers.onDragStart?.({ active: { id: 'column-0' } });
      dragHandlers.onDragEnd?.({
        active: { data: { current: { index: 0 } } },
        over: { id: 'target-firstName' }
      });
    });
    expect(importButton).not.toBeDisabled();
  });

  it('ignores drag end with invalid target or missing index', () => {
    render(<ColumnMapper {...defaultProps} />);
    const importButton = screen.getByRole('button', { name: /import/i });
    act(() => {
      dragHandlers.onDragEnd?.({
        active: { data: { current: { index: 1 } } },
        over: { id: 'target-unknown' }
      });
    });
    expect(importButton).toBeDisabled();
    act(() => {
      dragHandlers.onDragEnd?.({
        active: { data: { current: null } },
        over: { id: 'target-firstName' }
      });
    });
    expect(importButton).toBeDisabled();
  });

  it('calls onCancel and handles cancel button states', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ColumnMapper {...defaultProps} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel button when importing', () => {
    render(<ColumnMapper {...defaultProps} importing={true} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('shows "Importing..." text and row count', () => {
    const googleData = createMockCSVData(
      ['First Name', 'Last Name'],
      [['John', 'Doe']]
    );
    render(
      <ColumnMapper {...defaultProps} data={googleData} importing={true} />
    );
    expect(
      screen.getByRole('button', { name: /importing/i })
    ).toBeInTheDocument();
  });

  it('displays row count in import button', () => {
    const data = createMockCSVData(
      ['First Name'],
      [['John'], ['Jane'], ['Bob']]
    );
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(screen.getByText(/import 3 contacts/i)).toBeInTheDocument();
  });
});

describe('ColumnMapper Google Contacts auto-mapping', () => {
  it('auto-maps Google Contacts CSV headers and enables Import', () => {
    const googleData = createMockCSVData([
      'First Name',
      'Last Name',
      'Birthday',
      'E-mail 1 - Label',
      'E-mail 1 - Value'
    ]);
    render(<ColumnMapper {...defaultProps} data={googleData} />);
    expect(screen.getByRole('button', { name: /import/i })).not.toBeDisabled();
  });

  it('auto-maps phone columns and disables them', () => {
    const googleData = createMockCSVData([
      'First Name',
      'Phone 1 - Label',
      'Phone 1 - Value',
      'Phone 2 - Label',
      'Phone 2 - Value'
    ]);
    render(<ColumnMapper {...defaultProps} data={googleData} />);
    const csvColumnsSection = screen.getByText('CSV Columns').parentElement;
    const disabledColumns = csvColumnsSection?.querySelectorAll(
      '.cursor-not-allowed'
    );
    expect(disabledColumns?.length).toBe(5);
  });

  it('auto-maps Email 2 and Phone 3 columns', () => {
    const googleData = createMockCSVData([
      'First Name',
      'E-mail 2 - Label',
      'E-mail 2 - Value'
    ]);
    const { unmount: unmountEmail } = render(
      <ColumnMapper {...defaultProps} data={googleData} />
    );
    const csvColumnsSection = screen.getByText('CSV Columns').parentElement;
    expect(
      csvColumnsSection?.querySelectorAll('.cursor-not-allowed')?.length
    ).toBe(3);
    unmountEmail();

    const phone3Data = createMockCSVData([
      'First Name',
      'Phone 3 - Label',
      'Phone 3 - Value'
    ]);
    render(<ColumnMapper {...defaultProps} data={phone3Data} />);
    const section = screen.getByText('CSV Columns').parentElement;
    expect(section?.querySelectorAll('.cursor-not-allowed')?.length).toBe(3);
  });
});

describe('ColumnMapper Preview table', () => {
  it('renders preview section when there are rows', () => {
    const data = createMockCSVData(
      ['First Name', 'Last Name'],
      [
        ['John', 'Doe'],
        ['Jane', 'Smith']
      ]
    );
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(screen.getByText('Preview (first 3 rows)')).toBeInTheDocument();
  });

  it('does not render preview when there are no rows', () => {
    const data = createMockCSVData(['First Name', 'Last Name'], []);
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(
      screen.queryByText('Preview (first 3 rows)')
    ).not.toBeInTheDocument();
  });

  it('shows total row count and mapped column values', () => {
    const data = createMockCSVData(
      ['First Name', 'Last Name'],
      [['John', 'Doe']]
    );
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(screen.getByText('1 total rows')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('John')).toBeInTheDocument();
    expect(within(table).getByText('Doe')).toBeInTheDocument();
  });

  it('shows only first 3 rows in preview', () => {
    const data = createMockCSVData(
      ['First Name'],
      [['Row1'], ['Row2'], ['Row3'], ['Row4']]
    );
    render(<ColumnMapper {...defaultProps} data={data} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Row1')).toBeInTheDocument();
    expect(within(table).getByText('Row3')).toBeInTheDocument();
    expect(within(table).queryByText('Row4')).not.toBeInTheDocument();
  });

  it('displays dash for empty cell values', () => {
    const data = createMockCSVData(['First Name', 'Last Name'], [['John', '']]);
    render(<ColumnMapper {...defaultProps} data={data} />);
    const table = screen.getByRole('table');
    const cells = within(table).getAllByRole('cell');
    expect(cells.some((cell) => cell.textContent === '-')).toBe(true);
  });
});

describe('ColumnMapper onImport callback', () => {
  it('calls onImport with mapping when Import button is clicked', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const data = createMockCSVData(['First Name', 'Last Name']);
    render(<ColumnMapper {...defaultProps} data={data} onImport={onImport} />);
    await user.click(screen.getByRole('button', { name: /import/i }));
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 0, lastName: 1 })
    );
  });

  it('includes all mapped fields in onImport callback', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const data = createMockCSVData([
      'First Name',
      'Last Name',
      'Birthday',
      'E-mail 1 - Value',
      'E-mail 1 - Label',
      'Phone 1 - Value',
      'Phone 1 - Label'
    ]);
    render(<ColumnMapper {...defaultProps} data={data} onImport={onImport} />);
    await user.click(screen.getByRole('button', { name: /import/i }));
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 0,
        lastName: 1,
        birthday: 2,
        email1Value: 3,
        email1Label: 4,
        phone1Value: 5,
        phone1Label: 6
      })
    );
  });
});

describe('ColumnMapper drag and drop states', () => {
  it('renders grip icons and drag instructions', () => {
    render(<ColumnMapper {...defaultProps} />);
    const columnChips = screen
      .getAllByText(/Column [ABC]/)
      .map((el) => el.closest('div'));
    for (const chip of columnChips)
      expect(chip?.querySelector('svg')).toBeInTheDocument();
    expect(
      screen.getByText('Drag columns to map them to contact fields')
    ).toBeInTheDocument();
  });

  it('shows placeholders for drop zones', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getAllByText('Drag a column here').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Label').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
  });
});

describe('ColumnMapper remove mapping', () => {
  it('renders remove buttons for mapped columns', () => {
    const googleData = createMockCSVData(
      ['First Name', 'Last Name'],
      [['John', 'Doe']]
    );
    render(<ColumnMapper {...defaultProps} data={googleData} />);
    const contactFieldsSection =
      screen.getByText('Contact Fields').parentElement;
    const xButtons = contactFieldsSection?.querySelectorAll('button svg');
    expect(xButtons?.length).toBeGreaterThanOrEqual(2);
  });

  it('can remove a mapped column by clicking X button', async () => {
    const user = userEvent.setup();
    const googleData = createMockCSVData(
      ['First Name', 'Last Name'],
      [['John', 'Doe']]
    );
    render(<ColumnMapper {...defaultProps} data={googleData} />);
    const contactFieldsSection =
      screen.getByText('Contact Fields').parentElement;
    const xButtons = contactFieldsSection?.querySelectorAll('button svg');
    if (xButtons?.[0]?.parentElement)
      await user.click(xButtons[0].parentElement);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });
});

describe('ColumnMapper edge cases', () => {
  it('handles CSV with no matching headers', () => {
    const data = createMockCSVData(['Random Column', 'Another Column']);
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });

  it('handles single row preview', () => {
    const data = createMockCSVData(['First Name'], [['OnlyRow']]);
    render(<ColumnMapper {...defaultProps} data={data} />);
    expect(screen.getByRole('table').textContent).toContain('OnlyRow');
    expect(screen.getByText('1 total rows')).toBeInTheDocument();
  });
});
