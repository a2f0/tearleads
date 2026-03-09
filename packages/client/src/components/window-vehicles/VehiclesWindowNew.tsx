// one-component-per-file: allow
// Local JSX helpers keep the instance-scoped form logic readable in one place.
import {
  normalizeVehicleProfile,
  useVehiclesRuntime
} from '@tearleads/vehicles';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOnInstanceChange } from '@/hooks/app';

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

export function VehiclesWindowNew({
  onCreated,
  onCancel
}: VehiclesWindowNewProps) {
  const { databaseState, repository } = useVehiclesRuntime();
  const [isSaving, setIsSaving] = useState(false);

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [formErrors, setFormErrors] = useState<VehicleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const currentInstanceIdRef = useRef(databaseState.currentInstanceId);

  useEffect(() => {
    currentInstanceIdRef.current = databaseState.currentInstanceId;
  }, [databaseState.currentInstanceId]);

  useOnInstanceChange(
    useCallback(() => {
      setMake('');
      setModel('');
      setYear('');
      setColor('');
      setIsSaving(false);
      setFormErrors({});
      setFormError(null);
    }, [])
  );

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

    let operationInstanceId: string | null = null;

    try {
      if (!repository || !currentInstanceIdRef.current) {
        setFormError('Unable to create vehicle right now. Please try again.');
        setIsSaving(false);
        return;
      }

      operationInstanceId = currentInstanceIdRef.current;
      const newVehicle = await repository.createVehicle(normalized.value);
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      if (newVehicle === null) {
        setFormError('Unable to create vehicle right now. Please try again.');
        return;
      }
      onCreated(newVehicle.id);
    } catch (err) {
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      console.error('Failed to create vehicle:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      if (operationInstanceId === currentInstanceIdRef.current) {
        setIsSaving(false);
      }
    }
  }, [color, make, model, onCreated, repository, year]);

  const formState: VehicleFormState = {
    make,
    model,
    year,
    color,
    isSaving,
    formErrors,
    formError
  };

  const renderVehicleField = (
    id: string,
    label: string,
    value: string,
    placeholder: string,
    error: string | undefined,
    onChange: (nextValue: string) => void,
    autoFocus = false
  ) => {
    return (
      <div className="space-y-1">
        <label
          htmlFor={id}
          className="font-medium text-muted-foreground text-sm"
        >
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
  };

  const renderContent = () => {
    if (databaseState.isLoading) {
      return (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      );
    }

    if (!databaseState.isUnlocked) {
      return <InlineUnlock description="to create vehicles" />;
    }

    return (
      <div className="space-y-4">
        <h2 className="font-semibold text-sm">New Vehicle</h2>
        <div className="space-y-3 rounded-md border p-3">
          {renderVehicleField(
            'new-vehicle-make',
            'Make',
            formState.make,
            'Tesla',
            formState.formErrors.make,
            setMake,
            true
          )}
          {renderVehicleField(
            'new-vehicle-model',
            'Model',
            formState.model,
            'Model Y',
            formState.formErrors.model,
            setModel
          )}
          {renderVehicleField(
            'new-vehicle-year',
            'Year',
            formState.year,
            '2024',
            formState.formErrors.year,
            setYear
          )}
          {renderVehicleField(
            'new-vehicle-color',
            'Color',
            formState.color,
            'Midnight Silver',
            formState.formErrors.color,
            setColor
          )}

          {formState.formError ? (
            <p className="text-destructive text-sm" role="alert">
              {formState.formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={formState.isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void handleSave();
              }}
              disabled={formState.isSaving}
            >
              {formState.isSaving ? 'Creating...' : 'Create Vehicle'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      {renderContent()}
    </div>
  );
}
