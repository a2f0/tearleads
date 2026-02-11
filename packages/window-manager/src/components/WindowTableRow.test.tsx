import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowTableRow } from './WindowTableRow.js';

describe('WindowTableRow', () => {
  it('applies base row styles', () => {
    const { container } = render(
      <table>
        <tbody>
          <WindowTableRow>
            <td>Row</td>
          </WindowTableRow>
        </tbody>
      </table>
    );

    const row = container.querySelector('tr');
    expect(row).toHaveClass(
      'cursor-pointer',
      'border-border/50',
      'border-b',
      'hover:bg-accent/50'
    );
  });

  it('applies selected and dimmed styles', () => {
    const { container } = render(
      <table>
        <tbody>
          <WindowTableRow isSelected={true} isDimmed={true}>
            <td>Row</td>
          </WindowTableRow>
        </tbody>
      </table>
    );

    const row = container.querySelector('tr');
    expect(row).toHaveClass('bg-accent/50', 'opacity-60');
  });
});
