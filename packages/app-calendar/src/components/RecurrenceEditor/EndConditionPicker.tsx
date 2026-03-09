import { clsx } from 'clsx';

export type EndConditionType = 'never' | 'until' | 'count';

export interface EndConditionValue {
  type: EndConditionType;
  until?: Date;
  count?: number;
}

interface EndConditionPickerProps {
  value: EndConditionValue;
  onChange: (value: EndConditionValue) => void;
  disabled?: boolean;
}

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

export function EndConditionPicker({
  value,
  onChange,
  disabled = false
}: EndConditionPickerProps) {
  const handleTypeChange = (type: EndConditionType) => {
    if (type === 'never') {
      onChange({ type: 'never' });
    } else if (type === 'until') {
      const defaultUntil = new Date();
      defaultUntil.setMonth(defaultUntil.getMonth() + 1);
      onChange({
        type: 'until',
        until: value.until ?? defaultUntil
      });
    } else {
      onChange({
        type: 'count',
        count: value.count ?? 10
      });
    }
  };

  const handleUntilChange = (dateString: string) => {
    const date = new Date(dateString);
    if (!Number.isNaN(date.getTime())) {
      onChange({
        type: 'until',
        until: date
      });
    }
  };

  const handleCountChange = (count: number) => {
    onChange({
      type: 'count',
      count: Math.max(1, count)
    });
  };

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">Ends</p>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="endCondition"
            checked={value.type === 'never'}
            onChange={() => handleTypeChange('never')}
            disabled={disabled}
            className="accent-primary"
          />
          <span className="text-sm">Never</span>
        </label>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="endCondition"
              checked={value.type === 'until'}
              onChange={() => handleTypeChange('until')}
              disabled={disabled}
              className="accent-primary"
            />
            <span className="text-sm">On</span>
          </label>
          <input
            type="date"
            value={value.until ? formatDateForInput(value.until) : ''}
            onChange={(e) => handleUntilChange(e.target.value)}
            disabled={disabled || value.type !== 'until'}
            className={clsx(
              'rounded-md border bg-background px-3 py-2 text-base',
              (disabled || value.type !== 'until') &&
                'cursor-not-allowed opacity-50'
            )}
            aria-label="End date"
            data-testid="until-date-input"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="endCondition"
              checked={value.type === 'count'}
              onChange={() => handleTypeChange('count')}
              disabled={disabled}
              className="accent-primary"
            />
            <span className="text-sm">After</span>
          </label>
          <input
            type="number"
            min={1}
            max={999}
            value={value.count ?? 10}
            onChange={(e) => handleCountChange(Number(e.target.value))}
            disabled={disabled || value.type !== 'count'}
            className={clsx(
              'w-16 rounded-md border bg-background px-2 py-2 text-center text-base',
              (disabled || value.type !== 'count') &&
                'cursor-not-allowed opacity-50'
            )}
            aria-label="Number of occurrences"
            data-testid="count-input"
          />
          <span className="text-sm">occurrences</span>
        </div>
      </div>
    </div>
  );
}
