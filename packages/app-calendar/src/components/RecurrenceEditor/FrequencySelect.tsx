import { Frequency } from 'rrule';

interface FrequencySelectProps {
  value: Frequency;
  onChange: (frequency: Frequency) => void;
  disabled?: boolean;
}

const frequencyOptions = [
  { value: Frequency.DAILY, label: 'Daily' },
  { value: Frequency.WEEKLY, label: 'Weekly' },
  { value: Frequency.MONTHLY, label: 'Monthly' },
  { value: Frequency.YEARLY, label: 'Yearly' }
] as const;

export function FrequencySelect({
  value,
  onChange,
  disabled = false
}: FrequencySelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as Frequency)}
      className="rounded-md border bg-background px-3 py-2 text-base"
      aria-label="Recurrence frequency"
      disabled={disabled}
      data-testid="frequency-select"
    >
      {frequencyOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
