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
      const nextErrors: VehicleFormErrors = {};
      for (const err of normalized.errors) {
        if (err.field === 'make') nextErrors.make = err.error;
        if (err.field === 'model') nextErrors.model = err.error;
        if (err.field === 'year') nextErrors.year = err.error;
        if (err.field === 'color') nextErrors.color = err.error;
      }
      setFormErrors(nextErrors);
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

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="to create vehicles" />
      )}

      {isUnlocked && (
        <div className="space-y-4">
          <h2 className="font-semibold text-sm">New Vehicle</h2>
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <label
                htmlFor="new-vehicle-make"
                className="font-medium text-muted-foreground text-sm"
              >
                Make
              </label>
              <Input
                id="new-vehicle-make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Tesla"
                aria-invalid={Boolean(formErrors.make)}
                autoFocus
              />
              {formErrors.make && (
                <p className="text-destructive text-sm">{formErrors.make}</p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="new-vehicle-model"
                className="font-medium text-muted-foreground text-sm"
              >
                Model
              </label>
              <Input
                id="new-vehicle-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model Y"
                aria-invalid={Boolean(formErrors.model)}
              />
              {formErrors.model && (
                <p className="text-destructive text-sm">{formErrors.model}</p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="new-vehicle-year"
                className="font-medium text-muted-foreground text-sm"
              >
                Year
              </label>
              <Input
                id="new-vehicle-year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2024"
                aria-invalid={Boolean(formErrors.year)}
              />
              {formErrors.year && (
                <p className="text-destructive text-sm">{formErrors.year}</p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="new-vehicle-color"
                className="font-medium text-muted-foreground text-sm"
              >
                Color
              </label>
              <Input
                id="new-vehicle-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Midnight Silver"
                aria-invalid={Boolean(formErrors.color)}
              />
              {formErrors.color && (
                <p className="text-destructive text-sm">{formErrors.color}</p>
              )}
            </div>

            {formError && (
              <p className="text-destructive text-sm" role="alert">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving}
              >
                {isSaving ? 'Creating...' : 'Create Vehicle'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
