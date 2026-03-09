import { Frequency } from 'rrule';

interface IntervalInputProps {
  value: number;
  frequency: Frequency;
  onChange: (interval: number) => void;
  disabled?: boolean;
}

function getFrequencyLabel(frequency: Frequency, plural: boolean): string {
  const labels: Record<Frequency, [string, string]> = {
    [Frequency.YEARLY]: ['year', 'years'],
    [Frequency.MONTHLY]: ['month', 'months'],
    [Frequency.WEEKLY]: ['week', 'weeks'],
    [Frequency.DAILY]: ['day', 'days'],
    [Frequency.HOURLY]: ['hour', 'hours'],
    [Frequency.MINUTELY]: ['minute', 'minutes'],
    [Frequency.SECONDLY]: ['second', 'seconds']
  };

  const [singular, pluralForm] = labels[frequency] ?? ['period', 'periods'];
  return plural ? pluralForm : singular;
}

export function IntervalInput({
  value,
  frequency,
  onChange,
  disabled = false
}: IntervalInputProps) {
  const label = getFrequencyLabel(frequency, value !== 1);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">Every</span>
      <input
        type="number"
        min={1}
        max={999}
        value={value}
        onChange={(e) => {
          const newValue = Number(e.target.value);
          if (Number.isFinite(newValue) && newValue >= 1) {
            onChange(newValue);
          }
        }}
        className="w-16 rounded-md border bg-background px-2 py-2 text-center text-base"
        aria-label="Recurrence interval"
        disabled={disabled}
        data-testid="interval-input"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}
