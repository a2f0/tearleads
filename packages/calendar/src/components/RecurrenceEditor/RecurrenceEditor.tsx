import { useCallback, useEffect, useState } from 'react';
import { Frequency, RRule, Weekday } from 'rrule';
import {
  EndConditionPicker,
  type EndConditionValue
} from './EndConditionPicker';
import { FrequencySelect } from './FrequencySelect';
import { IntervalInput } from './IntervalInput';
import {
  MonthDayPicker,
  type MonthDayValue
} from './MonthDayPicker';
import { WeekdayPicker } from './WeekdayPicker';

interface RecurrenceEditorProps {
  value: string | null;
  onChange: (rrule: string | null) => void;
  startDate: Date;
  disabled?: boolean;
}

interface RecurrenceState {
  frequency: Frequency;
  interval: number;
  weekdays: number[];
  monthDay: MonthDayValue;
  endCondition: EndConditionValue;
}

function parseRRuleString(
  rruleString: string | null,
  startDate: Date
): RecurrenceState {
  const defaultState: RecurrenceState = {
    frequency: Frequency.WEEKLY,
    interval: 1,
    weekdays: [startDate.getDay()],
    monthDay: {
      type: 'dayOfMonth',
      dayOfMonth: startDate.getDate()
    },
    endCondition: { type: 'never' }
  };

  if (!rruleString) {
    return defaultState;
  }

  try {
    const rule = RRule.fromString(rruleString);
    const options = rule.origOptions;

    let endCondition: EndConditionValue = { type: 'never' };
    if (options.until) {
      endCondition = { type: 'until', until: options.until };
    } else if (options.count) {
      endCondition = { type: 'count', count: options.count };
    }

    let weekdays: number[] = [startDate.getDay()];
    if (options.byweekday) {
      const byweekday = Array.isArray(options.byweekday)
        ? options.byweekday
        : [options.byweekday];
      weekdays = byweekday.map((w) => {
        if (typeof w === 'number') return w;
        if (w instanceof Weekday) return w.weekday;
        return 0;
      });
    }

    let monthDay: MonthDayValue = {
      type: 'dayOfMonth',
      dayOfMonth: startDate.getDate()
    };

    const bymonthday = Array.isArray(options.bymonthday)
      ? options.bymonthday
      : options.bymonthday !== undefined
        ? [options.bymonthday]
        : [];
    const firstMonthDay = bymonthday[0];
    if (firstMonthDay !== undefined && firstMonthDay !== null) {
      monthDay = {
        type: 'dayOfMonth',
        dayOfMonth: firstMonthDay
      };
    } else if (options.bysetpos && options.byweekday) {
      const pos = Array.isArray(options.bysetpos)
        ? options.bysetpos[0]
        : options.bysetpos;
      const wd = Array.isArray(options.byweekday)
        ? options.byweekday[0]
        : options.byweekday;
      const weekday =
        typeof wd === 'number' ? wd : wd instanceof Weekday ? wd.weekday : 0;
      monthDay = {
        type: 'nthWeekday',
        nthWeekday: { n: pos ?? 1, weekday }
      };
    }

    return {
      frequency: options.freq ?? Frequency.WEEKLY,
      interval: options.interval ?? 1,
      weekdays,
      monthDay,
      endCondition
    };
  } catch {
    return defaultState;
  }
}

function buildRRuleString(state: RecurrenceState): string {
  const options: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: state.frequency,
    interval: state.interval
  };

  if (state.frequency === Frequency.WEEKLY) {
    options.byweekday = state.weekdays.map((w) => new Weekday(w));
  }

  if (state.frequency === Frequency.MONTHLY) {
    if (state.monthDay.type === 'dayOfMonth' && state.monthDay.dayOfMonth) {
      options.bymonthday = [state.monthDay.dayOfMonth];
    } else if (
      state.monthDay.type === 'nthWeekday' &&
      state.monthDay.nthWeekday
    ) {
      options.bysetpos = [state.monthDay.nthWeekday.n];
      options.byweekday = [new Weekday(state.monthDay.nthWeekday.weekday)];
    }
  }

  if (state.endCondition.type === 'until' && state.endCondition.until) {
    options.until = state.endCondition.until;
  } else if (state.endCondition.type === 'count' && state.endCondition.count) {
    options.count = state.endCondition.count;
  }

  const rule = new RRule(options);
  return rule.toString().replace('RRULE:', '');
}

export function RecurrenceEditor({
  value,
  onChange,
  startDate,
  disabled = false
}: RecurrenceEditorProps) {
  const [state, setState] = useState<RecurrenceState>(() =>
    parseRRuleString(value, startDate)
  );

  useEffect(() => {
    setState(parseRRuleString(value, startDate));
  }, [value, startDate]);

  const handleChange = useCallback(
    (newState: RecurrenceState) => {
      setState(newState);
      onChange(buildRRuleString(newState));
    },
    [onChange]
  );

  const handleFrequencyChange = useCallback(
    (frequency: Frequency) => {
      handleChange({ ...state, frequency });
    },
    [state, handleChange]
  );

  const handleIntervalChange = useCallback(
    (interval: number) => {
      handleChange({ ...state, interval });
    },
    [state, handleChange]
  );

  const handleWeekdaysChange = useCallback(
    (weekdays: number[]) => {
      handleChange({ ...state, weekdays });
    },
    [state, handleChange]
  );

  const handleMonthDayChange = useCallback(
    (monthDay: MonthDayValue) => {
      handleChange({ ...state, monthDay });
    },
    [state, handleChange]
  );

  const handleEndConditionChange = useCallback(
    (endCondition: EndConditionValue) => {
      handleChange({ ...state, endCondition });
    },
    [state, handleChange]
  );

  return (
    <div className="space-y-4" data-testid="recurrence-editor">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-sm">Repeat</span>
        <FrequencySelect
          value={state.frequency}
          onChange={handleFrequencyChange}
          disabled={disabled}
        />
      </div>

      <IntervalInput
        value={state.interval}
        frequency={state.frequency}
        onChange={handleIntervalChange}
        disabled={disabled}
      />

      {state.frequency === Frequency.WEEKLY && (
        <div className="space-y-2">
          <p className="font-medium text-sm">On</p>
          <WeekdayPicker
            value={state.weekdays}
            onChange={handleWeekdaysChange}
            disabled={disabled}
          />
        </div>
      )}

      {state.frequency === Frequency.MONTHLY && (
        <MonthDayPicker
          value={state.monthDay}
          onChange={handleMonthDayChange}
          disabled={disabled}
        />
      )}

      <EndConditionPicker
        value={state.endCondition}
        onChange={handleEndConditionChange}
        disabled={disabled}
      />
    </div>
  );
}
