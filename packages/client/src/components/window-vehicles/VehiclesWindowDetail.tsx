// component-complexity: allow
// The host-runtime rebinding changes are kept in this existing detail view for #3044.
import {
  normalizeVehicleProfile,
  useVehiclesRuntime,
  type VehicleRecord
} from '@tearleads/app-vehicles';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
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

interface VehiclesWindowDetailProps {
  vehicleId: string;
  onDeleted: () => void;
}

export function VehiclesWindowDetail({
  vehicleId,
  onDeleted
}: VehiclesWindowDetailProps) {
  const { databaseState, repository } = useVehiclesRuntime();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
      setVehicle(null);
      setLoading(false);
      setError(null);
      setIsEditing(false);
      setIsSaving(false);
      setDeleteDialogOpen(false);
      setMake('');
      setModel('');
      setYear('');
      setColor('');
      setFormErrors({});
      setFormError(null);
    }, [])
  );

  const fetchVehicle = useCallback(async () => {
    if (
      !databaseState.isUnlocked ||
      !repository ||
      !databaseState.currentInstanceId ||
      !vehicleId
    ) {
      return;
    }

    const fetchInstanceId = databaseState.currentInstanceId;
    setLoading(true);
    setError(null);

    try {
      const result = await repository.getVehicleById(vehicleId);
      if (fetchInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      if (!result) {
        setVehicle(null);
        setError('Vehicle not found');
        return;
      }
      setVehicle(result);
      setMake(result.make);
      setModel(result.model);
      setYear(result.year === null ? '' : String(result.year));
      setColor(result.color ?? '');
    } catch (err) {
      if (fetchInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      console.error('Failed to fetch vehicle:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchInstanceId === currentInstanceIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    databaseState.currentInstanceId,
    databaseState.isUnlocked,
    repository,
    vehicleId
  ]);

  useEffect(() => {
    if (databaseState.isUnlocked && repository && vehicleId) {
      void fetchVehicle();
    }
  }, [databaseState.isUnlocked, fetchVehicle, repository, vehicleId]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setFormErrors({});
    setFormError(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (vehicle) {
      setMake(vehicle.make);
      setModel(vehicle.model);
      setYear(vehicle.year === null ? '' : String(vehicle.year));
      setColor(vehicle.color ?? '');
    }
    setFormErrors({});
    setFormError(null);
    setIsEditing(false);
  }, [vehicle]);

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

    let operationInstanceId: string | null = null;

    try {
      if (!repository || !currentInstanceIdRef.current) {
        setFormError('Unable to save vehicle right now. Please try again.');
        setIsSaving(false);
        return;
      }

      operationInstanceId = currentInstanceIdRef.current;
      const updatedVehicle = await repository.updateVehicle(
        vehicleId,
        normalized.value
      );
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      if (updatedVehicle === null) {
        setFormError('Unable to save vehicle right now. Please try again.');
        return;
      }
      setVehicle(updatedVehicle);
      setIsEditing(false);
    } catch (err) {
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      console.error('Failed to update vehicle:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      if (operationInstanceId === currentInstanceIdRef.current) {
        setIsSaving(false);
      }
    }
  }, [color, make, model, repository, vehicleId, year]);

  const handleDelete = useCallback(async () => {
    if (!repository || !currentInstanceIdRef.current) {
      return;
    }

    const operationInstanceId = currentInstanceIdRef.current;
    try {
      await repository.deleteVehicle(vehicleId);
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      onDeleted();
    } catch (err) {
      if (operationInstanceId !== currentInstanceIdRef.current) {
        return;
      }
      console.error('Failed to delete vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }, [onDeleted, repository, vehicleId]);

  const handleDeleteConfirm = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  const handleDeleteConfirmed = useCallback(() => {
    setDeleteDialogOpen(false);
    void handleDelete();
  }, [handleDelete]);

  const formatYearValue = (yearValue: number | null): string => {
    return yearValue === null ? 'Not specified' : String(yearValue);
  };

  const formatColorValue = (colorValue: string | null): string => {
    return colorValue === null || colorValue.trim().length === 0
      ? 'Not specified'
      : colorValue;
  };

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      {databaseState.isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!databaseState.isLoading && !databaseState.isUnlocked && (
        <InlineUnlock description="this vehicle" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {databaseState.isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading vehicle...
        </div>
      )}

      {databaseState.isUnlocked && !loading && !error && vehicle && (
        <div className="flex min-h-0 flex-1 flex-col space-y-4">
          {isEditing ? (
            <div className="space-y-4">
              <h2 className="font-semibold text-sm">Edit Vehicle</h2>
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <label
                    htmlFor="detail-vehicle-make"
                    className="font-medium text-muted-foreground text-sm"
                  >
                    Make
                  </label>
                  <Input
                    id="detail-vehicle-make"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    placeholder="Tesla"
                    aria-invalid={Boolean(formErrors.make)}
                  />
                  {formErrors.make && (
                    <p className="text-destructive text-sm">
                      {formErrors.make}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="detail-vehicle-model"
                    className="font-medium text-muted-foreground text-sm"
                  >
                    Model
                  </label>
                  <Input
                    id="detail-vehicle-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Model Y"
                    aria-invalid={Boolean(formErrors.model)}
                  />
                  {formErrors.model && (
                    <p className="text-destructive text-sm">
                      {formErrors.model}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="detail-vehicle-year"
                    className="font-medium text-muted-foreground text-sm"
                  >
                    Year
                  </label>
                  <Input
                    id="detail-vehicle-year"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2024"
                    aria-invalid={Boolean(formErrors.year)}
                  />
                  {formErrors.year && (
                    <p className="text-destructive text-sm">
                      {formErrors.year}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="detail-vehicle-color"
                    className="font-medium text-muted-foreground text-sm"
                  >
                    Color
                  </label>
                  <Input
                    id="detail-vehicle-color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="Midnight Silver"
                    aria-invalid={Boolean(formErrors.color)}
                  />
                  {formErrors.color && (
                    <p className="text-destructive text-sm">
                      {formErrors.color}
                    </p>
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
                    onClick={handleCancel}
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
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <h2 className="font-semibold text-sm">
                  {vehicle.year !== null ? `${vehicle.year} ` : ''}
                  {vehicle.make} {vehicle.model}
                </h2>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEdit}
                    data-testid="vehicle-edit-button"
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteConfirm}
                    data-testid="vehicle-delete-button"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground text-sm">Make</span>
                  <span className="font-medium text-sm">{vehicle.make}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground text-sm">Model</span>
                  <span className="font-medium text-sm">{vehicle.model}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground text-sm">Year</span>
                  <span className="font-medium text-sm">
                    {formatYearValue(vehicle.year)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Color</span>
                  <span className="font-medium text-sm">
                    {formatColorValue(vehicle.color)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="text-muted-foreground text-xs">
                  Created: {vehicle.createdAt.toLocaleDateString()}
                </div>
                <div className="text-muted-foreground text-xs">
                  Updated: {vehicle.updatedAt.toLocaleDateString()}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={handleDeleteCancel}
            aria-hidden="true"
          />
          <div
            className="relative z-10 mx-4 w-full max-w-sm rounded-lg border bg-background p-4 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-vehicle-dialog-title"
            data-testid="delete-vehicle-dialog"
          >
            <h3
              id="delete-vehicle-dialog-title"
              className="font-semibold text-sm"
            >
              Delete Vehicle
            </h3>
            <p className="mt-2 text-muted-foreground text-sm">
              Are you sure you want to delete this vehicle? This action cannot
              be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteCancel}
                data-testid="cancel-delete-vehicle-button"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteConfirmed}
                data-testid="confirm-delete-vehicle-button"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
