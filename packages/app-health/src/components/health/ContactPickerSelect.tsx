import type { AvailableContact } from '../../runtime/HealthRuntimeContext';
import { selectClassName } from './selectClassName';

interface ContactPickerSelectProps {
  contacts: AvailableContact[];
  value: string | null;
  onChange: (contactId: string | null) => void;
  disabled?: boolean;
}

export function ContactPickerSelect({
  contacts,
  value,
  onChange,
  disabled = false
}: ContactPickerSelectProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor="reading-contact"
        className="font-medium text-muted-foreground text-sm"
      >
        Contact
      </label>
      <select
        id="reading-contact"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={selectClassName}
        disabled={disabled || contacts.length === 0}
      >
        <option value="">None</option>
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {contact.name}
          </option>
        ))}
      </select>
    </div>
  );
}
