import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContactPickerSelect } from './ContactPickerSelect';

const mockContacts = [
  { id: 'contact-1', name: 'Alice' },
  { id: 'contact-2', name: 'Bob' }
];

describe('ContactPickerSelect', () => {
  it('renders with "None" as default option', () => {
    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value={null}
        onChange={vi.fn()}
      />
    );

    const select = screen.getByLabelText('Contact');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('');
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders all contacts as options', () => {
    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value={null}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('reflects the selected contact value', () => {
    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value="contact-2"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Contact')).toHaveValue('contact-2');
  });

  it('calls onChange with contactId when a contact is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value={null}
        onChange={onChange}
      />
    );

    await user.selectOptions(screen.getByLabelText('Contact'), 'contact-1');

    expect(onChange).toHaveBeenCalledWith('contact-1');
  });

  it('calls onChange with null when "None" is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value="contact-1"
        onChange={onChange}
      />
    );

    await user.selectOptions(screen.getByLabelText('Contact'), '');

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is disabled when disabled prop is true', () => {
    render(
      <ContactPickerSelect
        contacts={mockContacts}
        value={null}
        onChange={vi.fn()}
        disabled
      />
    );

    expect(screen.getByLabelText('Contact')).toBeDisabled();
  });

  it('is disabled when contacts list is empty', () => {
    render(
      <ContactPickerSelect
        contacts={[]}
        value={null}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Contact')).toBeDisabled();
  });
});
