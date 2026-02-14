import { useVirtualizer } from '@tanstack/react-virtual';
import { CarFront, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useDatabaseContext } from '@/db/hooks';
import { deleteVehicle, listVehicles, type VehicleRecord } from '@/db/vehicles';

const ROW_HEIGHT_ESTIMATE = 56;

interface VehiclesWindowListProps {
  onSelectVehicle: (vehicleId: string) => void;
  onCreateVehicle: () => void;
  refreshToken?: number;
  onRefresh?: () => void;
}

export function VehiclesWindowList({
  onSelectVehicle,
  onCreateVehicle,
  refreshToken,
  onRefresh
}: VehiclesWindowListProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    vehicle: VehicleRecord;
    x: number;
    y: number;
  } | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchVehicles = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);
    try {
      const result = await listVehicles();
      setVehicles(result);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to load vehicles:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken triggers a re-fetch intentionally
  useEffect(() => {
    if (isUnlocked) {
      void fetchVehicles();
    }
  }, [isUnlocked, fetchVehicles, refreshToken]);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(focusTimer);
  }, []);

  const filteredVehicles = useMemo(() => {
    if (searchQuery.trim().length === 0) return vehicles;

    const searchLower = searchQuery.toLowerCase();
    return vehicles.filter((vehicle) => {
      const yearStr = vehicle.year !== null ? String(vehicle.year) : '';
      const searchable = [
        vehicle.make,
        vehicle.model,
        yearStr,
        vehicle.color ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(searchLower);
    });
  }, [vehicles, searchQuery]);

  const virtualizer = useVirtualizer({
    count: filteredVehicles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? 0) : 0;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? 0)
      : 0;

  const handleVehicleClick = useCallback(
    (vehicle: VehicleRecord) => {
      onSelectVehicle(vehicle.id);
    },
    [onSelectVehicle]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, vehicle: VehicleRecord) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ vehicle, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      onSelectVehicle(contextMenu.vehicle.id);
      setContextMenu(null);
    }
  }, [contextMenu, onSelectVehicle]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      await deleteVehicle(contextMenu.vehicle.id);
      setHasFetched(false);
      await fetchVehicles();
    } catch (err) {
      console.error('Failed to delete vehicle:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, fetchVehicles]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const clearEmptySpaceContextMenu = useCallback(() => {
    setEmptySpaceContextMenu(null);
  }, []);

  const handleNewVehicleFromEmptySpace = useCallback(() => {
    onCreateVehicle();
    setEmptySpaceContextMenu(null);
  }, [onCreateVehicle]);

  const handleRefresh = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  const getDisplayName = (vehicle: VehicleRecord) => {
    const parts = [];
    if (vehicle.year !== null) parts.push(String(vehicle.year));
    parts.push(vehicle.make, vehicle.model);
    return parts.join(' ');
  };

  const getSecondaryInfo = (vehicle: VehicleRecord) => {
    return vehicle.color ?? 'No color specified';
  };

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-sm">Vehicles</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateVehicle}
            className="h-7 px-2"
            data-testid="window-create-vehicle-button"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="h-7 px-2"
            disabled={loading}
            data-testid="window-refresh-vehicles-button"
          >
            <Loader2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="vehicles" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading vehicles...
          </div>
        ) : vehicles.length === 0 && hasFetched ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center"
            onContextMenu={handleEmptySpaceContextMenu}
          >
            <CarFront className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No vehicles yet</p>
              <p className="text-muted-foreground text-xs">
                Create your first vehicle
              </p>
            </div>
            <Button
              size="sm"
              onClick={onCreateVehicle}
              data-testid="window-empty-create-vehicle"
            >
              <Plus className="mr-1 h-3 w-3" />
              Create
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
            <div
              ref={parentRef}
              className="flex-1 overflow-auto rounded-lg border"
              data-testid="vehicles-scroll-container"
              onContextMenu={handleEmptySpaceContextMenu}
            >
              <div className="sticky top-0 z-10 space-y-2 bg-background p-2">
                <Input
                  type="search"
                  placeholder="Search vehicles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  ref={searchInputRef}
                  className="h-8 text-base"
                  data-testid="window-vehicles-search"
                />
                <VirtualListStatus
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  loadedCount={filteredVehicles.length}
                  itemLabel="vehicle"
                />
              </div>
              <div
                className="relative w-full"
                style={{ height: `${virtualizer.getTotalSize()}px` }}
              >
                {virtualItems.map((virtualItem) => {
                  const vehicle = filteredVehicles[virtualItem.index];
                  if (!vehicle) return null;

                  return (
                    <div
                      key={vehicle.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className="absolute top-0 left-0 w-full px-1 py-0.5"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`
                      }}
                    >
                      <ListRow
                        onContextMenu={(e) => handleContextMenu(e, vehicle)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
                          onClick={() => handleVehicleClick(vehicle)}
                        >
                          <CarFront className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-xs">
                              {getDisplayName(vehicle)}
                            </p>
                            <p className="truncate text-muted-foreground text-xs">
                              {getSecondaryInfo(vehicle)}
                            </p>
                          </div>
                        </button>
                      </ListRow>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            onClick={handleGetInfo}
            data-testid="context-menu-view"
          >
            View
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Trash2 className="h-3 w-3" />}
            onClick={() => {
              void handleDelete();
            }}
            data-testid="context-menu-delete"
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {emptySpaceContextMenu && (
        <ContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={clearEmptySpaceContextMenu}
        >
          <ContextMenuItem
            icon={<Plus className="h-3 w-3" />}
            onClick={handleNewVehicleFromEmptySpace}
            data-testid="context-menu-new-vehicle"
          >
            New Vehicle
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
