import {
  cn,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheckBig
} from 'lucide-react';
import type { ComponentPropsWithoutRef, FormEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { normalizeBusinessIdentifiers } from '../lib/businessIdentifiers.js';

interface BusinessRecord {
  id: string;
  name: string;
  dunsNumber?: string;
  ein?: string;
}

interface BusinessFormErrors {
  name?: string;
  dunsNumber?: string;
  ein?: string;
}

type SortColumn = 'name' | 'dunsNumber' | 'ein' | 'status';
type SortDirection = 'asc' | 'desc';

const EMPTY_VALUE_LABEL = 'N/A';

interface BusinessesButtonProps extends ComponentPropsWithoutRef<'button'> {}

function BusinessesButton({ className, ...props }: BusinessesButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md border px-4 py-2 font-medium text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

interface BusinessesInputProps extends ComponentPropsWithoutRef<'input'> {}

function BusinessesInput({ className, ...props }: BusinessesInputProps) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border bg-background px-3 py-1 text-base ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  );
}

function createBusinessId(): string {
  return crypto.randomUUID();
}

function formatDunsNumber(value?: string): string {
  if (!value) {
    return EMPTY_VALUE_LABEL;
  }

  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
}

function formatEin(value?: string): string {
  if (!value) {
    return EMPTY_VALUE_LABEL;
  }

  return `${value.slice(0, 2)}-${value.slice(2)}`;
}

function hasValidIdentifier(business: BusinessRecord): boolean {
  return Boolean(business.dunsNumber || business.ein);
}

function compareTextValues(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function compareOptionalValues(left?: string, right?: string): number {
  const leftValue = left ?? '';
  const rightValue = right ?? '';

  if (leftValue.length === 0 && rightValue.length === 0) {
    return 0;
  }
  if (leftValue.length === 0) {
    return 1;
  }
  if (rightValue.length === 0) {
    return -1;
  }

  return compareTextValues(leftValue, rightValue);
}

export function BusinessesManager() {
  const [name, setName] = useState('');
  const [dunsNumber, setDunsNumber] = useState('');
  const [ein, setEin] = useState('');
  const [errors, setErrors] = useState<BusinessFormErrors>({});
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedName = name.trim();
      const nextErrors: BusinessFormErrors = {};
      if (trimmedName.length === 0) {
        nextErrors.name = 'Business name is required';
      }

      const normalizedIdentifiers = normalizeBusinessIdentifiers({
        dunsNumber,
        ein
      });
      const normalizedValue = normalizedIdentifiers.ok
        ? normalizedIdentifiers.value
        : {};

      if (!normalizedIdentifiers.ok) {
        for (const error of normalizedIdentifiers.errors) {
          nextErrors[error.field] = error.error;
        }
      }

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      setBusinesses((previous) => [
        ...previous,
        {
          id: createBusinessId(),
          name: trimmedName,
          ...normalizedValue
        }
      ]);
      setName('');
      setDunsNumber('');
      setEin('');
    },
    [dunsNumber, ein, name]
  );

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) =>
          currentDirection === 'asc' ? 'desc' : 'asc'
        );
        return currentColumn;
      }

      setSortDirection('asc');
      return column;
    });
  }, []);

  const sortedBusinesses = useMemo(() => {
    const entries = [...businesses];

    entries.sort((left, right) => {
      const sortResult = (() => {
        switch (sortColumn) {
          case 'name':
            return compareTextValues(left.name, right.name);
          case 'dunsNumber':
            return compareOptionalValues(left.dunsNumber, right.dunsNumber);
          case 'ein':
            return compareOptionalValues(left.ein, right.ein);
          case 'status': {
            const leftStatus = Number(hasValidIdentifier(left));
            const rightStatus = Number(hasValidIdentifier(right));
            return leftStatus - rightStatus;
          }
          default:
            return 0;
        }
      })();

      if (sortResult === 0) {
        return compareTextValues(left.name, right.name);
      }

      return sortDirection === 'asc' ? sortResult : -sortResult;
    });

    return entries;
  }, [businesses, sortColumn, sortDirection]);

  const getSortIcon = useCallback(
    (column: SortColumn) => {
      if (sortColumn !== column) {
        return null;
      }

      return sortDirection === 'asc' ? (
        <ChevronUp className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      );
    },
    [sortColumn, sortDirection]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <form
        className="space-y-3 rounded-md border p-3"
        onSubmit={handleSubmit}
        aria-label="Add business form"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label
              htmlFor="business-name"
              className="font-medium text-muted-foreground text-sm"
            >
              Business Name
            </label>
            <BusinessesInput
              id="business-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc."
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <label
              htmlFor="business-duns"
              className="font-medium text-muted-foreground text-sm"
            >
              DUNS Number
            </label>
            <BusinessesInput
              id="business-duns"
              value={dunsNumber}
              onChange={(event) => setDunsNumber(event.target.value)}
              placeholder="12-345-6789"
              aria-invalid={Boolean(errors.dunsNumber)}
            />
            {errors.dunsNumber && (
              <p className="text-destructive text-sm">{errors.dunsNumber}</p>
            )}
          </div>
          <div className="space-y-1">
            <label
              htmlFor="business-ein"
              className="font-medium text-muted-foreground text-sm"
            >
              EIN
            </label>
            <BusinessesInput
              id="business-ein"
              value={ein}
              onChange={(event) => setEin(event.target.value)}
              placeholder="12-3456789"
              aria-invalid={Boolean(errors.ein)}
            />
            {errors.ein && (
              <p className="text-destructive text-sm">{errors.ein}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <BusinessesButton type="submit">Save Business</BusinessesButton>
        </div>
      </form>

      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        {businesses.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Building2 className="h-5 w-5" />
            <p>No businesses yet</p>
            <p className="text-sm">Add your first business above.</p>
          </div>
        ) : (
          <div className="h-full overflow-auto" data-testid="businesses-table">
            <table
              className={WINDOW_TABLE_TYPOGRAPHY.table}
              aria-label="Businesses table"
            >
              <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                <tr>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                      onClick={() => handleSortChange('name')}
                    >
                      Business Name
                      {getSortIcon('name')}
                    </button>
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                      onClick={() => handleSortChange('dunsNumber')}
                    >
                      DUNS Number
                      {getSortIcon('dunsNumber')}
                    </button>
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                      onClick={() => handleSortChange('ein')}
                    >
                      EIN
                      {getSortIcon('ein')}
                    </button>
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                      onClick={() => handleSortChange('status')}
                    >
                      Status
                      {getSortIcon('status')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedBusinesses.map((business) => (
                  <WindowTableRow key={business.id}>
                    <td
                      className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-medium`}
                    >
                      {business.name}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                      {formatDunsNumber(business.dunsNumber)}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                      {formatEin(business.ein)}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                      {hasValidIdentifier(business) ? (
                        <span className="flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400">
                          <CircleCheckBig className="h-3.5 w-3.5" />
                          Valid
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {EMPTY_VALUE_LABEL}
                        </span>
                      )}
                    </td>
                  </WindowTableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(errors.dunsNumber || errors.ein) && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
          <CircleAlert className="h-4 w-4" />
          Fix validation errors before saving.
        </div>
      )}
    </div>
  );
}
