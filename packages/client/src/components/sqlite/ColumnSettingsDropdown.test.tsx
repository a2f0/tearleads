import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnSettingsDropdown } from './ColumnSettingsDropdown';

const columns = [
  { name: 'id', type: 'INTEGER', pk: 1 },
  { name: 'title', type: 'TEXT', pk: 0 }
];

describe('ColumnSettingsDropdown', () => {
  it('closes when Escape is pressed', () => {
    render(
      <ColumnSettingsDropdown
        columns={columns}
        hiddenColumns={new Set()}
        onToggleColumn={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('column-settings-button'));
    expect(screen.getByText('Visible Columns')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Visible Columns')).not.toBeInTheDocument();
  });
});
