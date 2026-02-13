import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowControlGroup } from './WindowControlGroup.js';

describe('WindowControlGroup', () => {
  it('renders with left alignment by default', () => {
    const { container } = render(
      <WindowControlGroup>
        <span>Group</span>
      </WindowControlGroup>
    );

    expect(container.firstChild).toHaveClass('flex', 'min-w-0', 'items-center');
    expect(container.firstChild).not.toHaveClass('ml-auto');
  });

  it('applies right alignment and custom class', () => {
    const { container } = render(
      <WindowControlGroup align="right" className="custom-class">
        <span>Group</span>
      </WindowControlGroup>
    );

    expect(container.firstChild).toHaveClass('ml-auto', 'custom-class');
  });
});
