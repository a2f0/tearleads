import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedCSV } from '@/hooks/useContactsImport';
import { ColumnMapper } from './ColumnMapper';

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
    expect(parent).not.toBeNull();
    if (parent) {
      const required = within(parent).getByText('*');
      expect(required).toBeInTheDocument();
    }
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

    it('auto-maps phone columns', () => {
      const googleData = createMockCSVData([
        'First Name',
        'Phone 1 - Label',
        'Phone 1 - Value',
        'Phone 2 - Label',
        'Phone 2 - Value'
      ]);
      render(<ColumnMapper {...defaultProps} data={googleData} />);

      // Columns that are mapped should be disabled in the source list
      const mappedColumns = screen.getAllByText(/Phone \d - (Label|Value)/);
      expect(mappedColumns.length).toBeGreaterThanOrEqual(4);
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
});
