import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedCSV } from '@/hooks/useContactsImport';
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
      if (onDragStart) {
        dragHandlers.onDragStart = onDragStart;
      } else {
        delete dragHandlers.onDragStart;
      }
      if (onDragEnd) {
        dragHandlers.onDragEnd = onDragEnd;
      } else {
        delete dragHandlers.onDragEnd;
      }
      return <div data-testid="dnd-context">{children}</div>;
    },
    DragOverlay: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    )
  };
});

// Sample CSV data for testing
const createMockCSVData = (
  headers: string[],
  rows: string[][] = []
): ParsedCSV => ({
  headers,
  rows
});

describe('ColumnMapper', () => {
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

  it('renders CSV column headers', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByText('Column A')).toBeInTheDocument();
    expect(screen.getByText('Column B')).toBeInTheDocument();
    expect(screen.getByText('Column C')).toBeInTheDocument();
  });

  it('renders contact field sections', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByText('CSV Columns')).toBeInTheDocument();
    expect(screen.getByText('Contact Fields')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('renders basic contact fields', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByText('First Name')).toBeInTheDocument();
    expect(screen.getByText('Last Name')).toBeInTheDocument();
    expect(screen.getByText('Birthday')).toBeInTheDocument();
  });

  it('shows required indicator on First Name field', () => {
    render(<ColumnMapper {...defaultProps} />);

    const firstNameLabel = screen.getByText('First Name');
    const parent = firstNameLabel.parentElement;
    expect(parent).toBeInTheDocument();
    const required = within(parent as HTMLElement).getByText('*');
    expect(required).toBeInTheDocument();
  });

  it('renders email field groups', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByText('Email 1')).toBeInTheDocument();
    expect(screen.getByText('Email 2')).toBeInTheDocument();
  });

  it('renders phone field groups', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByText('Phone 1')).toBeInTheDocument();
    expect(screen.getByText('Phone 2')).toBeInTheDocument();
    expect(screen.getByText('Phone 3')).toBeInTheDocument();
  });

  it('renders Cancel and Import buttons', () => {
    render(<ColumnMapper {...defaultProps} />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });

  it('disables Import button when firstName is not mapped', () => {
    render(<ColumnMapper {...defaultProps} />);

    const importButton = screen.getByRole('button', { name: /import/i });
    expect(importButton).toBeDisabled();
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

  it('ignores drag end with invalid target id', () => {
    render(<ColumnMapper {...defaultProps} />);

    const importButton = screen.getByRole('button', { name: /import/i });
    expect(importButton).toBeDisabled();

    act(() => {
      dragHandlers.onDragEnd?.({
        active: { data: { current: { index: 1 } } },
        over: { id: 'target-unknown' }
      });
    });

    expect(importButton).toBeDisabled();
  });

  it('ignores drag end when index is missing', () => {
    render(<ColumnMapper {...defaultProps} />);

    const importButton = screen.getByRole('button', { name: /import/i });
    expect(importButton).toBeDisabled();

    act(() => {
      dragHandlers.onDragEnd?.({
        active: { data: { current: null } },
        over: { id: 'target-firstName' }
      });
    });

    expect(importButton).toBeDisabled();
  });

  it('calls onCancel when Cancel button is clicked', async () => {
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

  it('shows "Importing..." text when importing', () => {
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

  describe('Google Contacts auto-mapping', () => {
    it('auto-maps Google Contacts CSV headers', () => {
      const googleData = createMockCSVData([
        'First Name',
        'Last Name',
        'Birthday',
        'E-mail 1 - Label',
        'E-mail 1 - Value'
      ]);
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // Import button should be enabled because First Name is auto-mapped
      const importButton = screen.getByRole('button', { name: /import/i });
      expect(importButton).not.toBeDisabled();
    });

    it('enables Import button when First Name is auto-mapped', () => {
      const googleData = createMockCSVData(['First Name', 'Other Column']);
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      const importButton = screen.getByRole('button', { name: /import/i });
      expect(importButton).not.toBeDisabled();
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

      // The CSV Columns section contains draggable columns
      // Mapped columns should be disabled (have cursor-not-allowed and opacity-50)
      const csvColumnsSection = screen.getByText('CSV Columns').parentElement;
      expect(csvColumnsSection).toBeInTheDocument();

      // Find columns with disabled styling in the source list
      const disabledColumns = csvColumnsSection?.querySelectorAll(
        '.cursor-not-allowed'
      );
      // Phone 1-2 Label and Value = 4 columns, plus First Name = 5 total mapped
      expect(disabledColumns?.length).toBe(5);
    });
  });

  describe('Preview table', () => {
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

    it('shows total row count in preview', () => {
      const data = createMockCSVData(
        ['First Name'],
        [['John'], ['Jane'], ['Bob'], ['Alice'], ['Eve']]
      );
      render(<ColumnMapper {...defaultProps} data={data} />);

      expect(screen.getByText('5 total rows')).toBeInTheDocument();
    });

    it('displays mapped column values in preview table', () => {
      const data = createMockCSVData(
        ['First Name', 'Last Name'],
        [['John', 'Doe']]
      );
      render(<ColumnMapper {...defaultProps} data={data} />);

      // The preview table should show the mapped values
      const table = screen.getByRole('table');
      expect(within(table).getByText('John')).toBeInTheDocument();
      expect(within(table).getByText('Doe')).toBeInTheDocument();
    });

    it('shows only first 3 rows in preview', () => {
      const data = createMockCSVData(
        ['First Name'],
        [['Row1'], ['Row2'], ['Row3'], ['Row4'], ['Row5']]
      );
      render(<ColumnMapper {...defaultProps} data={data} />);

      const table = screen.getByRole('table');
      expect(within(table).getByText('Row1')).toBeInTheDocument();
      expect(within(table).getByText('Row2')).toBeInTheDocument();
      expect(within(table).getByText('Row3')).toBeInTheDocument();
      expect(within(table).queryByText('Row4')).not.toBeInTheDocument();
      expect(within(table).queryByText('Row5')).not.toBeInTheDocument();
    });
  });

  describe('onImport callback', () => {
    it('calls onImport with mapping when Import button is clicked', async () => {
      const user = userEvent.setup();
      const onImport = vi.fn();
      const data = createMockCSVData(['First Name', 'Last Name']);

      render(
        <ColumnMapper {...defaultProps} data={data} onImport={onImport} />
      );

      await user.click(screen.getByRole('button', { name: /import/i }));

      expect(onImport).toHaveBeenCalledTimes(1);
      expect(onImport).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 0,
          lastName: 1
        })
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

      render(
        <ColumnMapper {...defaultProps} data={data} onImport={onImport} />
      );

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

  describe('column draggable states', () => {
    it('renders grip icons for draggable columns', () => {
      render(<ColumnMapper {...defaultProps} />);

      // Each column chip should have a grip icon (svg)
      const columnChips = screen
        .getAllByText(/Column [ABC]/)
        .map((el) => el.closest('div'));

      for (const chip of columnChips) {
        expect(chip?.querySelector('svg')).toBeInTheDocument();
      }
    });

    it('shows drag instructions', () => {
      render(<ColumnMapper {...defaultProps} />);

      expect(
        screen.getByText('Drag columns to map them to contact fields')
      ).toBeInTheDocument();
    });
  });

  describe('drop zone placeholders', () => {
    it('shows placeholders for empty drop zones', () => {
      render(<ColumnMapper {...defaultProps} />);

      // Basic fields should have "Drag a column here" placeholder
      const placeholders = screen.getAllByText('Drag a column here');
      expect(placeholders.length).toBeGreaterThan(0);
    });

    it('shows Label and Value placeholders for grouped fields', () => {
      render(<ColumnMapper {...defaultProps} />);

      // Email and Phone sections have Label/Value columns
      const labelPlaceholders = screen.getAllByText('Label');
      const valuePlaceholders = screen.getAllByText('Value');

      expect(labelPlaceholders.length).toBeGreaterThan(0);
      expect(valuePlaceholders.length).toBeGreaterThan(0);
    });
  });

  describe('remove mapping functionality', () => {
    it('renders remove buttons for mapped columns', () => {
      const googleData = createMockCSVData(
        ['First Name', 'Last Name'],
        [['John', 'Doe']]
      );
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // Find the Contact Fields section which contains the mapped fields
      const contactFieldsSection =
        screen.getByText('Contact Fields').parentElement;

      // Look for X buttons (SVG icons inside buttons) in the drop zones
      const xButtons = contactFieldsSection?.querySelectorAll('button svg');
      // First Name and Last Name are auto-mapped, so there should be 2 X buttons
      expect(xButtons?.length).toBeGreaterThanOrEqual(2);
    });

    it('can remove a mapped column by clicking X button', async () => {
      const user = userEvent.setup();
      const googleData = createMockCSVData(
        ['First Name', 'Last Name'],
        [['John', 'Doe']]
      );
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // Find the Contact Fields section which contains the mapped fields
      const contactFieldsSection =
        screen.getByText('Contact Fields').parentElement;

      // Look for X buttons (SVG icons inside buttons) in the drop zones
      const xButtons = contactFieldsSection?.querySelectorAll('button svg');
      expect(xButtons?.length).toBeGreaterThanOrEqual(2);

      // Click the first X button to remove the First Name mapping
      if (xButtons?.[0]) {
        await user.click(xButtons[0].parentElement as HTMLElement);
      }

      // Import button should be disabled after removing First Name mapping
      const importButton = screen.getByRole('button', { name: /import/i });
      expect(importButton).toBeDisabled();
    });
  });

  describe('preview table with empty values', () => {
    it('displays dash for empty cell values', () => {
      const data = createMockCSVData(
        ['First Name', 'Last Name'],
        [['John', '']]
      );
      render(<ColumnMapper {...defaultProps} data={data} />);

      const table = screen.getByRole('table');
      // The empty Last Name should show as '-'
      expect(within(table).getByText('John')).toBeInTheDocument();
      // Find all dashes in the table
      const cells = within(table).getAllByRole('cell');
      const dashCell = cells.find((cell) => cell.textContent === '-');
      expect(dashCell).toBeDefined();
    });
  });

  describe('Email 2 and Phone 3 mappings', () => {
    it('auto-maps Email 2 columns', () => {
      const googleData = createMockCSVData([
        'First Name',
        'E-mail 2 - Label',
        'E-mail 2 - Value'
      ]);
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // All 3 columns should be mapped and disabled
      const csvColumnsSection = screen.getByText('CSV Columns').parentElement;
      const disabledColumns = csvColumnsSection?.querySelectorAll(
        '.cursor-not-allowed'
      );
      expect(disabledColumns?.length).toBe(3);
    });

    it('auto-maps Phone 3 columns', () => {
      const googleData = createMockCSVData([
        'First Name',
        'Phone 3 - Label',
        'Phone 3 - Value'
      ]);
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // All 3 columns should be mapped and disabled
      const csvColumnsSection = screen.getByText('CSV Columns').parentElement;
      const disabledColumns = csvColumnsSection?.querySelectorAll(
        '.cursor-not-allowed'
      );
      expect(disabledColumns?.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles CSV with no matching Google Contacts headers', () => {
      const data = createMockCSVData(['Random Column', 'Another Column']);
      render(<ColumnMapper {...defaultProps} data={data} />);

      // Import should be disabled as nothing is mapped
      const importButton = screen.getByRole('button', { name: /import/i });
      expect(importButton).toBeDisabled();
    });

    it('handles single row preview', () => {
      const data = createMockCSVData(['First Name'], [['OnlyRow']]);
      render(<ColumnMapper {...defaultProps} data={data} />);

      const table = screen.getByRole('table');
      expect(within(table).getByText('OnlyRow')).toBeInTheDocument();
      expect(screen.getByText('1 total rows')).toBeInTheDocument();
    });
  });
});
