import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { ContactsWindowNew } from './ContactsWindowNew';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}));

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined)
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb,
  getDatabaseAdapter: () => ({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined)
  })
}));

describe('ContactsWindowNew', () => {
  const defaultProps = {
    onBack: vi.fn(),
    onCreated: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDb.values.mockResolvedValue(undefined);
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders back button', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByTestId('window-new-contact-back')).toBeInTheDocument();
  });

  it('renders save button', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByTestId('window-new-contact-save')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ContactsWindowNew {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-new-contact-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders form fields when unlocked', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByTestId('window-new-first-name')).toBeInTheDocument();
    expect(screen.getByTestId('window-new-last-name')).toBeInTheDocument();
    expect(screen.getByTestId('window-new-birthday')).toBeInTheDocument();
  });

  it('shows error when first name is empty and save is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
    });
  });

  it('allows adding and entering first name', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    expect(firstNameInput).toHaveValue('John');
  });

  it('allows adding and entering last name', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const lastNameInput = screen.getByTestId('window-new-last-name');
    await user.type(lastNameInput, 'Doe');

    expect(lastNameInput).toHaveValue('Doe');
  });

  it('allows adding email', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBeGreaterThan(0);
    });
  });

  it('allows adding phone', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBeGreaterThan(0);
    });
  });

  it('shows error for empty email when added', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-add-email'));

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(
        screen.getByText('Email address cannot be empty')
      ).toBeInTheDocument();
    });
  });

  it('shows error for invalid email format', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBeGreaterThan(0);
    });

    const emailInputs = screen.getAllByPlaceholderText('Email');
    const emailInput = emailInputs[0];
    if (!emailInput) throw new Error('Email input not found');
    await user.type(emailInput, 'invalid-email');

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(
        screen.getByText('Please enter a valid email address')
      ).toBeInTheDocument();
    });
  });

  it('shows error for empty phone when added', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-add-phone'));

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(
        screen.getByText('Phone number cannot be empty')
      ).toBeInTheDocument();
    });
  });

  it('successfully creates contact and calls onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<ContactsWindowNew {...defaultProps} onCreated={onCreated} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(mockDb.insert).toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it('displays New Contact header', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByText('New Contact')).toBeInTheDocument();
  });

  it('displays Email Addresses section', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByText('Email Addresses')).toBeInTheDocument();
  });

  it('displays Phone Numbers section', () => {
    render(<ContactsWindowNew {...defaultProps} />);
    expect(screen.getByText('Phone Numbers')).toBeInTheDocument();
  });

  it('handles save error gracefully', async () => {
    mockDb.values.mockRejectedValueOnce(new Error('Database error'));
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to create contact:',
      expect.any(Error)
    );
  });

  it('allows entering email label', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const labelInputs = screen.getAllByPlaceholderText('Label');
      expect(labelInputs.length).toBeGreaterThan(0);
    });

    const labelInputs = screen.getAllByPlaceholderText('Label');
    const labelInput = labelInputs[0];
    if (!labelInput) throw new Error('Label input not found');
    await user.type(labelInput, 'Work');

    expect(labelInput).toHaveValue('Work');
  });

  it('allows entering phone label', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const labelInputs = screen.getAllByPlaceholderText('Label');
      expect(labelInputs.length).toBeGreaterThan(0);
    });

    const labelInputs = screen.getAllByPlaceholderText('Label');
    const labelInput = labelInputs[0];
    if (!labelInput) throw new Error('Label input not found');
    await user.type(labelInput, 'Mobile');

    expect(labelInput).toHaveValue('Mobile');
  });

  it('allows deleting an email', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(1);
    });

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg.lucide-trash-2'));
    if (deleteButtons[0]) {
      await user.click(deleteButtons[0]);
    }

    await waitFor(() => {
      const emailInputs = screen.queryAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(0);
    });
  });

  it('allows deleting a phone', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(1);
    });

    const deleteButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg.lucide-trash-2'));
    if (deleteButtons[0]) {
      await user.click(deleteButtons[0]);
    }

    await waitFor(() => {
      const phoneInputs = screen.queryAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(0);
    });
  });

  it('allows adding multiple emails', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));
    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(2);
    });
  });

  it('allows adding multiple phones', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));
    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(2);
    });
  });

  it('allows entering birthday', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    const birthdayInput = screen.getByTestId('window-new-birthday');
    await user.type(birthdayInput, '1990-01-15');

    expect(birthdayInput).toHaveValue('1990-01-15');
  });

  it('allows changing primary email', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));
    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBe(2);
    });

    const radioButtons = screen.getAllByRole('radio');
    const secondRadio = radioButtons[1];
    if (secondRadio) {
      await user.click(secondRadio);
      expect(secondRadio).toBeChecked();
    }
  });

  it('allows changing primary phone', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));
    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBe(2);
    });

    const radioButtons = screen.getAllByRole('radio');
    const secondRadio = radioButtons[1];
    if (secondRadio) {
      await user.click(secondRadio);
      expect(secondRadio).toBeChecked();
    }
  });

  it('creates contact with email and phone', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<ContactsWindowNew {...defaultProps} onCreated={onCreated} />);

    const firstNameInput = screen.getByTestId('window-new-first-name');
    await user.type(firstNameInput, 'John');

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const emailInputs = screen.getAllByPlaceholderText('Email');
      expect(emailInputs.length).toBe(1);
    });

    const emailInputs = screen.getAllByPlaceholderText('Email');
    const emailInput = emailInputs[0];
    if (emailInput) {
      await user.type(emailInput, 'john@example.com');
    }

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(1);
    });

    const phoneInputs = screen.getAllByPlaceholderText('Phone');
    const phoneInput = phoneInputs[0];
    if (phoneInput) {
      await user.type(phoneInput, '+1234567890');
    }

    await user.click(screen.getByTestId('window-new-contact-save'));

    await waitFor(() => {
      expect(mockDb.insert).toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it('first email is automatically primary', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-email'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBe(1);
    });

    const radioButtons = screen.getAllByRole('radio');
    const firstRadio = radioButtons[0];
    expect(firstRadio).toBeChecked();
  });

  it('first phone is automatically primary', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBe(1);
    });

    const radioButtons = screen.getAllByRole('radio');
    const firstRadio = radioButtons[0];
    expect(firstRadio).toBeChecked();
  });

  it('allows editing phone label', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const labelInputs = screen.getAllByPlaceholderText('Label');
      expect(labelInputs.length).toBe(1);
    });

    const labelInputs = screen.getAllByPlaceholderText('Label');
    const labelInput = labelInputs[0];
    if (labelInput) {
      await user.type(labelInput, 'Work');
      expect(labelInput).toHaveValue('Work');
    }
  });

  it('allows entering phone number', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowNew {...defaultProps} />);

    await user.click(screen.getByTestId('window-new-add-phone'));

    await waitFor(() => {
      const phoneInputs = screen.getAllByPlaceholderText('Phone');
      expect(phoneInputs.length).toBe(1);
    });

    const phoneInputs = screen.getAllByPlaceholderText('Phone');
    const phoneInput = phoneInputs[0];
    if (phoneInput) {
      await user.type(phoneInput, '+1234567890');
      expect(phoneInput).toHaveValue('+1234567890');
    }
  });
});
