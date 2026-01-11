import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableTitle } from './EditableTitle';

describe('EditableTitle', () => {
  it('renders the title in view mode', () => {
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Test Title' })
    ).toBeInTheDocument();
  });

  it('renders edit button in view mode', () => {
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Edit name' })
    ).toBeInTheDocument();
  });

  it('switches to edit mode when edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Test Title');
  });

  it('focuses the input when entering edit mode', async () => {
    const user = userEvent.setup();
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('shows save and cancel buttons in edit mode', async () => {
    const user = userEvent.setup();
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('cancels edit mode when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('heading', { name: 'Test Title' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('reverts to original value when cancelled', async () => {
    const user = userEvent.setup();
    render(<EditableTitle value="Test Title" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('heading', { name: 'Test Title' })
    ).toBeInTheDocument();
  });

  it('calls onSave with new value when save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Title');
    });
  });

  it('exits edit mode after successful save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    });
  });

  it('stays in edit mode after save failure', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  it('shows error when trying to save empty value', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Name cannot be empty');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('trims whitespace from value before saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '  New Title  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Title');
    });
  });

  it('does not call onSave if value has not changed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves on Enter key press', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title{Enter}');

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('New Title');
    });
  });

  it('cancels on Escape key press', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableTitle value="Test Title" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'New Title');
    await user.keyboard('{Escape}');

    expect(
      screen.getByRole('heading', { name: 'Test Title' })
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  describe('data-testid', () => {
    it('applies data-testid to title heading', () => {
      render(
        <EditableTitle
          value="Test Title"
          onSave={vi.fn()}
          data-testid="my-title"
        />
      );

      expect(screen.getByTestId('my-title')).toBeInTheDocument();
    });

    it('applies data-testid to edit button', () => {
      render(
        <EditableTitle
          value="Test Title"
          onSave={vi.fn()}
          data-testid="my-title"
        />
      );

      expect(screen.getByTestId('my-title-edit')).toBeInTheDocument();
    });

    it('applies data-testid to input in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <EditableTitle
          value="Test Title"
          onSave={vi.fn()}
          data-testid="my-title"
        />
      );

      await user.click(screen.getByRole('button', { name: 'Edit name' }));

      expect(screen.getByTestId('my-title-input')).toBeInTheDocument();
    });

    it('applies data-testid to save button in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <EditableTitle
          value="Test Title"
          onSave={vi.fn()}
          data-testid="my-title"
        />
      );

      await user.click(screen.getByRole('button', { name: 'Edit name' }));

      expect(screen.getByTestId('my-title-save')).toBeInTheDocument();
    });

    it('applies data-testid to cancel button in edit mode', async () => {
      const user = userEvent.setup();
      render(
        <EditableTitle
          value="Test Title"
          onSave={vi.fn()}
          data-testid="my-title"
        />
      );

      await user.click(screen.getByRole('button', { name: 'Edit name' }));

      expect(screen.getByTestId('my-title-cancel')).toBeInTheDocument();
    });
  });
});
