import { normalizeBusinessIdentifiers } from '@tearleads/businesses';
import { Building2, CircleAlert, CircleCheckBig } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

const EMPTY_VALUE_LABEL = 'N/A';

function createBusinessId(): string {
  return crypto.randomUUID();
}

export function BusinessesManager() {
  const [name, setName] = useState('');
  const [dunsNumber, setDunsNumber] = useState('');
  const [ein, setEin] = useState('');
  const [errors, setErrors] = useState<BusinessFormErrors>({});
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
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
            <Input
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
            <Input
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
            <Input
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
          <Button type="submit">Save Business</Button>
        </div>
      </form>

      <section className="min-h-0 flex-1 overflow-auto rounded-md border">
        {businesses.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Building2 className="h-5 w-5" />
            <p>No businesses yet</p>
            <p className="text-sm">Add your first business above.</p>
          </div>
        ) : (
          <div className="divide-y">
            {businesses.map((business) => {
              const duns = business.dunsNumber
                ? `${business.dunsNumber.slice(0, 2)}-${business.dunsNumber.slice(2, 5)}-${business.dunsNumber.slice(5)}`
                : EMPTY_VALUE_LABEL;
              const formattedEin = business.ein
                ? `${business.ein.slice(0, 2)}-${business.ein.slice(2)}`
                : EMPTY_VALUE_LABEL;

              return (
                <article
                  key={business.id}
                  className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[1fr_auto_auto_auto]"
                >
                  <div className="font-medium">{business.name}</div>
                  <div className="text-muted-foreground text-sm">{duns}</div>
                  <div className="text-muted-foreground text-sm">
                    {formattedEin}
                  </div>
                  {business.dunsNumber || business.ein ? (
                    <div className="flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400">
                      <CircleCheckBig className="h-3.5 w-3.5" />
                      Valid
                    </div>
                  ) : null}
                </article>
              );
            })}
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
