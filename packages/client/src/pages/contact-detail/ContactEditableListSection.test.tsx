import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mail } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ContactEditableListSection } from './ContactEditableListSection';

interface TestDisplayItem {
  id: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
}

interface TestFormItem {
  id: string;
  value: string;
  label: string;
  isPrimary: boolean;
  isDeleted?: boolean;
}

const defaultProps = {
  icon: Mail,
  sectionTitle: 'Test Items',
  inputType: 'email' as const,
  inputPlaceholder: 'Enter value',
  addButtonLabel: 'Add Item',
  primaryRadioName: 'primaryTest',
  valueField: 'value' as const,
  getDisplayValue: (item: TestDisplayItem) => item.value,
  getLinkHref: (value: string) => `mailto:${value}`,
  testIdPrefix: 'test'
};

function renderComponent(props: {
  isEditing: boolean;
  items: TestDisplayItem[];
  formItems: TestFormItem[];
  onValueChange?: (
    id: string,
    field: keyof TestFormItem,
    value: string | boolean
  ) => void;
  onPrimaryChange?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
}) {
  return render(
    <ThemeProvider>
      <ContactEditableListSection
        {...defaultProps}
        isEditing={props.isEditing}
        items={props.items}
        formItems={props.formItems}
        onValueChange={props.onValueChange ?? vi.fn()}
        onPrimaryChange={props.onPrimaryChange ?? vi.fn()}
        onDelete={props.onDelete ?? vi.fn()}
        onAdd={props.onAdd ?? vi.fn()}
      />
    </ThemeProvider>
  );
}

describe('ContactEditableListSection', () => {
  describe('view mode', () => {
    it('renders nothing when items array is empty', () => {
      const { container } = renderComponent({
        isEditing: false,
        items: [],
        formItems: []
      });

      expect(container.firstChild).toBeNull();
    });

    it('renders section title', () => {
      renderComponent({
        isEditing: false,
        items: [
          { id: '1', value: 'test@example.com', label: null, isPrimary: false }
        ],
        formItems: []
      });

      expect(screen.getByText('Test Items')).toBeInTheDocument();
    });

    it('renders items with links', () => {
      renderComponent({
        isEditing: false,
        items: [
          { id: '1', value: 'test@example.com', label: null, isPrimary: false }
        ],
        formItems: []
      });

      const link = screen.getByRole('link', { name: 'test@example.com' });
      expect(link).toHaveAttribute('href', 'mailto:test@example.com');
    });

    it('renders item label when present', () => {
      renderComponent({
        isEditing: false,
        items: [
          {
            id: '1',
            value: 'test@example.com',
            label: 'work',
            isPrimary: false
          }
        ],
        formItems: []
      });

      expect(screen.getByText('(work)')).toBeInTheDocument();
    });

    it('does not render label when null', () => {
      renderComponent({
        isEditing: false,
        items: [
          { id: '1', value: 'test@example.com', label: null, isPrimary: false }
        ],
        formItems: []
      });

      expect(screen.queryByText('(work)')).not.toBeInTheDocument();
    });

    it('renders primary badge for primary items', () => {
      renderComponent({
        isEditing: false,
        items: [
          { id: '1', value: 'test@example.com', label: null, isPrimary: true }
        ],
        formItems: []
      });

      expect(screen.getByText('Primary')).toBeInTheDocument();
    });

    it('does not render primary badge for non-primary items', () => {
      renderComponent({
        isEditing: false,
        items: [
          { id: '1', value: 'test@example.com', label: null, isPrimary: false }
        ],
        formItems: []
      });

      expect(screen.queryByText('Primary')).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    const formItems: TestFormItem[] = [
      { id: '1', value: 'test@example.com', label: 'work', isPrimary: true },
      { id: '2', value: 'other@example.com', label: '', isPrimary: false }
    ];

    it('renders section title', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      expect(screen.getByText('Test Items')).toBeInTheDocument();
    });

    it('renders value inputs for each form item', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      expect(screen.getByTestId('edit-test-1')).toHaveValue('test@example.com');
      expect(screen.getByTestId('edit-test-2')).toHaveValue(
        'other@example.com'
      );
    });

    it('renders label inputs for each form item', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      expect(screen.getByTestId('edit-test-label-1')).toHaveValue('work');
      expect(screen.getByTestId('edit-test-label-2')).toHaveValue('');
    });

    it('renders primary radio buttons', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      const radios = screen.getAllByRole('radio', { name: /primary/i });
      expect(radios).toHaveLength(2);
      expect(radios[0]).toBeChecked();
      expect(radios[1]).not.toBeChecked();
    });

    it('renders delete buttons', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      expect(screen.getByTestId('delete-test-1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-test-2')).toBeInTheDocument();
    });

    it('renders add button', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems
      });

      expect(screen.getByTestId('add-test-button')).toBeInTheDocument();
      expect(screen.getByText('Add Item')).toBeInTheDocument();
    });

    it('filters out deleted items', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems: [
          {
            id: '1',
            value: 'test@example.com',
            label: '',
            isPrimary: true,
            isDeleted: true
          },
          { id: '2', value: 'other@example.com', label: '', isPrimary: false }
        ]
      });

      expect(screen.queryByTestId('edit-test-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('edit-test-2')).toBeInTheDocument();
    });

    it('calls onValueChange when value is changed', async () => {
      const onValueChange = vi.fn();
      const user = userEvent.setup();

      renderComponent({
        isEditing: true,
        items: [],
        formItems: [{ id: '1', value: '', label: '', isPrimary: true }],
        onValueChange
      });

      await user.type(screen.getByTestId('edit-test-1'), 'a');

      expect(onValueChange).toHaveBeenCalledWith('1', 'value', 'a');
    });

    it('calls onValueChange when label is changed', async () => {
      const onValueChange = vi.fn();
      const user = userEvent.setup();

      renderComponent({
        isEditing: true,
        items: [],
        formItems: [{ id: '1', value: 'test', label: '', isPrimary: true }],
        onValueChange
      });

      await user.type(screen.getByTestId('edit-test-label-1'), 'home');

      expect(onValueChange).toHaveBeenCalledWith('1', 'label', 'h');
    });

    it('calls onPrimaryChange when radio is clicked', async () => {
      const onPrimaryChange = vi.fn();
      const user = userEvent.setup();

      renderComponent({
        isEditing: true,
        items: [],
        formItems: [
          { id: '1', value: 'test1', label: '', isPrimary: true },
          { id: '2', value: 'test2', label: '', isPrimary: false }
        ],
        onPrimaryChange
      });

      const radios = screen.getAllByRole('radio', { name: /primary/i });
      const secondRadio = radios[1];
      if (!secondRadio) {
        throw new Error('Expected second radio button to exist');
      }
      await user.click(secondRadio);

      expect(onPrimaryChange).toHaveBeenCalledWith('2');
    });

    it('calls onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn();
      const user = userEvent.setup();

      renderComponent({
        isEditing: true,
        items: [],
        formItems: [{ id: '1', value: 'test', label: '', isPrimary: true }],
        onDelete
      });

      await user.click(screen.getByTestId('delete-test-1'));

      expect(onDelete).toHaveBeenCalledWith('1');
    });

    it('calls onAdd when add button is clicked', async () => {
      const onAdd = vi.fn();
      const user = userEvent.setup();

      renderComponent({
        isEditing: true,
        items: [],
        formItems: [],
        onAdd
      });

      await user.click(screen.getByTestId('add-test-button'));

      expect(onAdd).toHaveBeenCalled();
    });

    it('uses correct input type', () => {
      renderComponent({
        isEditing: true,
        items: [],
        formItems: [{ id: '1', value: 'test', label: '', isPrimary: true }]
      });

      expect(screen.getByTestId('edit-test-1')).toHaveAttribute(
        'type',
        'email'
      );
    });
  });
});
