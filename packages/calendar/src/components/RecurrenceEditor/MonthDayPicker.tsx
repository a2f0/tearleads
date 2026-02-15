import { clsx } from 'clsx';
import { RRule } from 'rrule';

export type MonthDayType = 'dayOfMonth' | 'nthWeekday';

export interface MonthDayValue {
  type: MonthDayType;
  dayOfMonth?: number;
  nthWeekday?: {
    n: number;
    weekday: number;
  };
}

interface MonthDayPickerProps {
  value: MonthDayValue;
  onChange: (value: MonthDayValue) => void;
  disabled?: boolean;
}

const ordinalOptions = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' }
] as const;

const weekdayOptions = [
  { value: RRule.SU.weekday, label: 'Sunday' },
  { value: RRule.MO.weekday, label: 'Monday' },
  { value: RRule.TU.weekday, label: 'Tuesday' },
  { value: RRule.WE.weekday, label: 'Wednesday' },
  { value: RRule.TH.weekday, label: 'Thursday' },
  { value: RRule.FR.weekday, label: 'Friday' },
  { value: RRule.SA.weekday, label: 'Saturday' }
] as const;

export function MonthDayPicker({
  value,
  onChange,
  disabled = false
}: MonthDayPickerProps) {
  const handleTypeChange = (type: MonthDayType) => {
    if (type === 'dayOfMonth') {
      onChange({
        type: 'dayOfMonth',
        dayOfMonth: value.dayOfMonth ?? 1
      });
    } else {
      onChange({
        type: 'nthWeekday',
        nthWeekday: value.nthWeekday ?? { n: 1, weekday: RRule.MO.weekday }
      });
    }
  };

  const handleDayOfMonthChange = (day: number) => {
    onChange({
      type: 'dayOfMonth',
      dayOfMonth: Math.min(31, Math.max(1, day))
    });
  };

  const handleNthChange = (n: number) => {
    onChange({
      type: 'nthWeekday',
      nthWeekday: {
        n,
        weekday: value.nthWeekday?.weekday ?? RRule.MO.weekday
      }
    });
  };

  const handleWeekdayChange = (weekday: number) => {
    onChange({
      type: 'nthWeekday',
      nthWeekday: {
        n: value.nthWeekday?.n ?? 1,
        weekday
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="monthDayType"
            checked={value.type === 'dayOfMonth'}
            onChange={() => handleTypeChange('dayOfMonth')}
            disabled={disabled}
            className="accent-primary"
          />
          <span className="text-sm">On day</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="monthDayType"
            checked={value.type === 'nthWeekday'}
            onChange={() => handleTypeChange('nthWeekday')}
            disabled={disabled}
            className="accent-primary"
          />
          <span className="text-sm">On the</span>
        </label>
      </div>

      {value.type === 'dayOfMonth' ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={31}
            value={value.dayOfMonth ?? 1}
            onChange={(e) => handleDayOfMonthChange(Number(e.target.value))}
            disabled={disabled}
            className={clsx(
              'w-16 rounded-md border bg-background px-2 py-2 text-center text-base',
              disabled && 'cursor-not-allowed opacity-50'
            )}
            aria-label="Day of month"
            data-testid="day-of-month-input"
          />
          <span className="text-muted-foreground text-sm">of the month</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={value.nthWeekday?.n ?? 1}
            onChange={(e) => handleNthChange(Number(e.target.value))}
            disabled={disabled}
            className={clsx(
              'rounded-md border bg-background px-3 py-2 text-base',
              disabled && 'cursor-not-allowed opacity-50'
            )}
            aria-label="Ordinal position"
            data-testid="nth-select"
          >
            {ordinalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={value.nthWeekday?.weekday ?? RRule.MO.weekday}
            onChange={(e) => handleWeekdayChange(Number(e.target.value))}
            disabled={disabled}
            className={clsx(
              'rounded-md border bg-background px-3 py-2 text-base',
              disabled && 'cursor-not-allowed opacity-50'
            )}
            aria-label="Day of week"
            data-testid="weekday-select"
          >
            {weekdayOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
