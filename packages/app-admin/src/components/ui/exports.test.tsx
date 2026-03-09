import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';

describe('admin ui export wrappers', () => {
  it('renders exported UI primitives', () => {
    render(
      <div>
        <Button>Save</Button>
        <Input aria-label="name" defaultValue="Ada" />
        <Textarea aria-label="notes" defaultValue="hello" />
      </div>
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Ada');
    expect(screen.getByLabelText('notes')).toHaveValue('hello');
  });
});
