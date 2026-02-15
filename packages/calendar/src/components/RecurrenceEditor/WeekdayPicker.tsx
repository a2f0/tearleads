import { clsx } from 'clsx';
import { RRule } from 'rrule';

interface WeekdayPickerProps {
  value: number[];
  onChange: (weekdays: number[]) => void;
  disabled?: boolean;
}

const weekdayOptions = [
  { value: RRule.SU.weekday, label: 'S', fullLabel: 'Sunday' },
  { value: RRule.MO.weekday, label: 'M', fullLabel: 'Monday' },
  { value: RRule.TU.weekday, label: 'T', fullLabel: 'Tuesday' },
  { value: RRule.WE.weekday, label: 'W', fullLabel: 'Wednesday' },
  { value: RRule.TH.weekday, label: 'T', fullLabel: 'Thursday' },
  { value: RRule.FR.weekday, label: 'F', fullLabel: 'Friday' },
  { value: RRule.SA.weekday, label: 'S', fullLabel: 'Saturday' }
] as const;

export function WeekdayPicker({
  value,
  onChange,
  disabled = false
}: WeekdayPickerProps) {
  const toggleWeekday = (weekday: number) => {
    if (value.includes(weekday)) {
      if (value.length > 1) {
        onChange(value.filter((w) => w !== weekday));
      }
    } else {
      onChange([...value, weekday].sort((a, b) => a - b));
    }
  };

  return (
    <fieldset className="flex gap-1" aria-label="Select days of week">
      {weekdayOptions.map((option, index) => {
        const isSelected = value.includes(option.value);
        return (
          <button
            key={`${option.fullLabel}-${index}`}
            type="button"
            onClick={() => toggleWeekday(option.value)}
            disabled={disabled}
            aria-pressed={isSelected}
            aria-label={option.fullLabel}
            data-testid={`weekday-${option.fullLabel.toLowerCase()}`}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm transition-colors',
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
