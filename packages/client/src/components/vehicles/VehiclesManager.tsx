import { normalizeVehicleProfile } from '@tearleads/vehicles';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { CarFront, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle,
  type VehicleRecord
} from '@/db/vehicles';

interface VehicleFormErrors {
  make?: string;
  model?: string;
  year?: string;
  color?: string;
}

export function VehiclesManager() {
  const { t } = useTranslation('vehicles');
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null
  );

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');

  const [errors, setErrors] = useState<VehicleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const refreshVehicles = useCallback(async () => {
    setIsLoading(true);
    const nextVehicles = await listVehicles();
    setVehicles(nextVehicles);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshVehicles();
  }, [refreshVehicles]);

  const sortedVehicles = useMemo(
    () =>
      [...vehicles].sort((left, right) => {
        if (right.updatedAt.getTime() !== left.updatedAt.getTime()) {
          return right.updatedAt.getTime() - left.updatedAt.getTime();
        }

        const makeComparison = left.make.localeCompare(right.make, undefined, {
          sensitivity: 'base'
        });
        if (makeComparison !== 0) {
          return makeComparison;
        }

        return left.model.localeCompare(right.model, undefined, {
          sensitivity: 'base'
        });
      }),
    [vehicles]
  );

  const resetForm = useCallback(() => {
    setSelectedVehicleId(null);
    setMake('');
    setModel('');
    setYear('');
    setColor('');
    setErrors({});
    setFormError(null);
  }, []);

  const setFormFromVehicle = useCallback((vehicle: VehicleRecord) => {
    setSelectedVehicleId(vehicle.id);
    setMake(vehicle.make);
    setModel(vehicle.model);
    setYear(vehicle.year === null ? '' : String(vehicle.year));
    setColor(vehicle.color ?? '');
    setErrors({});
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const parsedYear = year.trim().length === 0 ? null : Number(year);
      const normalized = normalizeVehicleProfile({
        make,
        model,
        year: parsedYear,
        color
      });

      if (!normalized.ok) {
        const nextErrors: VehicleFormErrors = {};
        for (const error of normalized.errors) {
          if (error.field === 'make') {
            nextErrors.make = error.error;
          }
          if (error.field === 'model') {
            nextErrors.model = error.error;
          }
          if (error.field === 'year') {
            nextErrors.year = error.error;
          }
          if (error.field === 'color') {
            nextErrors.color = error.error;
          }
        }
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      setFormError(null);
      setIsSaving(true);

      const savedVehicle =
        selectedVehicleId === null
          ? await createVehicle(normalized.value)
          : await updateVehicle(selectedVehicleId, normalized.value);

      setIsSaving(false);

      if (savedVehicle === null) {
        setFormError(t('unableToSaveVehicle'));
        return;
      }

      await refreshVehicles();
      setFormFromVehicle(savedVehicle);
    },
    [
      color,
      make,
      model,
      refreshVehicles,
      selectedVehicleId,
      setFormFromVehicle,
      t,
      year
    ]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteVehicle(id);
      if (selectedVehicleId === id) {
        resetForm();
      }
      await refreshVehicles();
    },
    [refreshVehicles, resetForm, selectedVehicleId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <form
        className="space-y-3 rounded-md border p-3"
        onSubmit={handleSubmit}
        aria-label={t('vehicleForm')}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <label
              htmlFor="vehicle-make"
              className="font-medium text-muted-foreground text-sm"
            >
              {t('make')}
            </label>
            <Input
              id="vehicle-make"
              value={make}
              onChange={(event) => setMake(event.target.value)}
              placeholder="Tesla"
              aria-invalid={Boolean(errors.make)}
            />
            {errors.make ? (
              <p className="text-destructive text-sm">{errors.make}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="vehicle-model"
              className="font-medium text-muted-foreground text-sm"
            >
              {t('model')}
            </label>
            <Input
              id="vehicle-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model Y"
              aria-invalid={Boolean(errors.model)}
            />
            {errors.model ? (
              <p className="text-destructive text-sm">{errors.model}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="vehicle-year"
              className="font-medium text-muted-foreground text-sm"
            >
              {t('year')}
            </label>
            <Input
              id="vehicle-year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2024"
              aria-invalid={Boolean(errors.year)}
            />
            {errors.year ? (
              <p className="text-destructive text-sm">{errors.year}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="vehicle-color"
              className="font-medium text-muted-foreground text-sm"
            >
              {t('color')}
            </label>
            <Input
              id="vehicle-color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="Midnight Silver"
              aria-invalid={Boolean(errors.color)}
            />
            {errors.color ? (
              <p className="text-destructive text-sm">{errors.color}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetForm}>
            {t('newVehicle')}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {selectedVehicleId === null ? t('saveVehicle') : t('updateVehicle')}
          </Button>
        </div>

        {formError ? (
          <p className="text-destructive text-sm" role="alert">
            {formError}
          </p>
        ) : null}
      </form>

      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        {isLoading ? (
          <div className="flex h-full min-h-40 items-center justify-center p-6 text-center text-muted-foreground">
            {t('loadingVehicles')}
          </div>
        ) : sortedVehicles.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <CarFront className="h-5 w-5" />
            <p>{t('noVehiclesYet')}</p>
            <p className="text-sm">{t('addFirstVehicle')}</p>
          </div>
        ) : (
          <div className="h-full overflow-auto" data-testid="vehicles-table">
            <table
              className={WINDOW_TABLE_TYPOGRAPHY.table}
              aria-label={t('vehiclesTable')}
            >
              <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                <tr>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    {t('make')}
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    {t('model')}
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    {t('year')}
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    {t('color')}
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    {t('actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedVehicles.map((vehicle) => (
                  <WindowTableRow key={vehicle.id}>
                    <td
                      className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-medium`}
                    >
                      {vehicle.make}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                      {vehicle.model}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                      {vehicle.year === null
                        ? t('notApplicable')
                        : String(vehicle.year)}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                      {vehicle.color === null
                        ? t('notApplicable')
                        : vehicle.color}
                    </td>
                    <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setFormFromVehicle(vehicle)}
                          aria-label={`${t('edit')} ${vehicle.make} ${vehicle.model}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(vehicle.id)}
                          aria-label={`${t('delete')} ${vehicle.make} ${vehicle.model}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('delete')}
                        </Button>
                      </div>
                    </td>
                  </WindowTableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
