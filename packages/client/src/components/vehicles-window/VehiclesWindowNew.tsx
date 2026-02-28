import { normalizeVehicleProfile } from '@tearleads/vehicles';
import { useCallback, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatabaseContext } from '@/db/hooks';
import { createVehicle } from '@/db/vehicles';

interface VehicleFormErrors {
  make?: string;
  model?: string;
  year?: string;
  color?: string;
}

interface VehiclesWindowNewProps {
  onCreated: (vehicleId: string) => void;
  onCancel: () => void;
}

type VehicleFormState = {
  make: string;
  model: string;
  year: string;
  color: string;
  isSaving: boolean;
  formErrors: VehicleFormErrors;
  formError: string | null;
};

function mapValidationErrors(errors: { field: string; error: string }[]) {
  const nextErrors: VehicleFormErrors = {};
  for (const err of errors) {
    if (err.field === 'make') nextErrors.make = err.error;
    if (err.field === 'model') nextErrors.model = err.error;
    if (err.field === 'year') nextErrors.year = err.error;
    if (err.field === 'color') nextErrors.color = err.error;
  }
  return nextErrors;
}

type VehicleFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error: string | undefined;
  autoFocus?: boolean;
  onChange: (value: string) => void;
};

function renderVehicleField({
  id,
  label,
  value,
  placeholder,
  error,
  autoFocus = false,
  onChange
}: VehicleFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-medium text-muted-foreground text-sm">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        autoFocus={autoFocus}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

function renderVehicleForm(
  state: VehicleFormState,
  onCancel: () => void,
  onSave: () => void,
  onMakeChange: (value: string) => void,
  onModelChange: (value: string) => void,
  onYearChange: (value: string) => void,
  onColorChange: (value: string) => void
) {
  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-sm">New Vehicle</h2>
      <div className="space-y-3 rounded-md border p-3">
        {renderVehicleField({
          id: 'new-vehicle-make',
          label: 'Make',
          value: state.make,
          placeholder: 'Tesla',
          error: state.formErrors.make,
          autoFocus: true,
          onChange: onMakeChange
        })}
        {renderVehicleField({
          id: 'new-vehicle-model',
          label: 'Model',
          value: state.model,
          placeholder: 'Model Y',
          error: state.formErrors.model,
          onChange: onModelChange
        })}
        {renderVehicleField({
          id: 'new-vehicle-year',
          label: 'Year',
          value: state.year,
          placeholder: '2024',
          error: state.formErrors.year,
          onChange: onYearChange
        })}
        {renderVehicleField({
          id: 'new-vehicle-color',
          label: 'Color',
          value: state.color,
          placeholder: 'Midnight Silver',
          error: state.formErrors.color,
          onChange: onColorChange
        })}

        {state.formError ? (
          <p className="text-destructive text-sm" role="alert">
            {state.formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={state.isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={state.isSaving}
          >
            {state.isSaving ? 'Creating...' : 'Create Vehicle'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function renderVehiclesNewContent(
  isLoading: boolean,
  isUnlocked: boolean,
  form: VehicleFormState,
  onCancel: () => void,
  onSave: () => void,
  onMakeChange: (value: string) => void,
  onModelChange: (value: string) => void,
  onYearChange: (value: string) => void,
  onColorChange: (value: string) => void
) {
  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    return <InlineUnlock description="to create vehicles" />;
  }

  return renderVehicleForm(
    form,
    onCancel,
    onSave,
    onMakeChange,
    onModelChange,
    onYearChange,
    onColorChange
  );
}

export function VehiclesWindowNew({
  onCreated,
  onCancel
}: VehiclesWindowNewProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [isSaving, setIsSaving] = useState(false);

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [formErrors, setFormErrors] = useState<VehicleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    const parsedYear = year.trim().length === 0 ? null : Number(year);
    const normalized = normalizeVehicleProfile({
      make,
      model,
      year: parsedYear,
      color
    });

    if (!normalized.ok) {
      setFormErrors(mapValidationErrors(normalized.errors));
      return;
    }

    setFormErrors({});
    setFormError(null);
    setIsSaving(true);

    try {
      const newVehicle = await createVehicle(normalized.value);
      if (newVehicle === null) {
        setFormError('Unable to create vehicle right now. Please try again.');
        return;
      }
      onCreated(newVehicle.id);
    } catch (err) {
      console.error('Failed to create vehicle:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setIsSaving(false);
    }
  }, [make, model, year, color, onCreated]);

  const formState: VehicleFormState = {
    make,
    model,
    year,
    color,
    isSaving,
    formErrors,
    formError
  };

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      {renderVehiclesNewContent(
        isLoading,
        isUnlocked,
        formState,
        onCancel,
        () => {
          void handleSave();
        },
        setMake,
        setModel,
        setYear,
        setColor
      )}
    </div>
  );
}
