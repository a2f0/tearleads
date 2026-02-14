import {
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  WindowStatusBar
} from '@tearleads/window-manager';
import { ArrowLeft, CarFront, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { VehiclesManager } from '@/components/vehicles';
import { VehiclesWindowDetail } from './VehiclesWindowDetail';
import { VehiclesWindowList } from './VehiclesWindowList';
import type { ViewMode } from './VehiclesWindowMenuBar';
import { VehiclesWindowMenuBar } from './VehiclesWindowMenuBar';
import { VehiclesWindowNew } from './VehiclesWindowNew';

const VEHICLES_WINDOW_DEFAULT_WIDTH = 900;
const VEHICLES_WINDOW_DEFAULT_HEIGHT = 620;
const VEHICLES_WINDOW_MIN_WIDTH = 680;
const VEHICLES_WINDOW_MIN_HEIGHT = 420;

type WindowView = 'list' | 'detail' | 'create';

interface VehiclesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function VehiclesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: VehiclesWindowProps) {
  const [currentView, setCurrentView] = useState<WindowView>('list');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [refreshToken, setRefreshToken] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleSelectVehicle = useCallback((vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    setCurrentView('detail');
  }, []);

  const handleCreateVehicle = useCallback(() => {
    setCurrentView('create');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedVehicleId(null);
    setCurrentView('list');
  }, []);

  const handleVehicleCreated = useCallback((vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    setCurrentView('detail');
    setRefreshToken((value) => value + 1);
  }, []);

  const handleVehicleDeleted = useCallback(() => {
    setSelectedVehicleId(null);
    setCurrentView('list');
    setRefreshToken((value) => value + 1);
  }, []);

  const statusText =
    currentView === 'detail'
      ? 'Viewing vehicle details'
      : currentView === 'create'
        ? 'Creating new vehicle'
        : 'Browsing vehicles';

  return (
    <FloatingWindow
      id={id}
      title="Vehicles"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={VEHICLES_WINDOW_DEFAULT_WIDTH}
      defaultHeight={VEHICLES_WINDOW_DEFAULT_HEIGHT}
      minWidth={VEHICLES_WINDOW_MIN_WIDTH}
      minHeight={VEHICLES_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full flex-col">
        <VehiclesWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNewVehicle={handleCreateVehicle}
          onClose={onClose}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {currentView !== 'list' ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBack}
                data-testid="vehicles-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <>
                <WindowControlButton
                  icon={<CarFront className="h-3 w-3" />}
                  onClick={handleCreateVehicle}
                  data-testid="vehicles-window-control-new"
                >
                  New
                </WindowControlButton>
                <WindowControlButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  onClick={handleRefresh}
                  data-testid="vehicles-window-control-refresh"
                >
                  Refresh
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="relative flex-1 overflow-hidden">
          {currentView === 'detail' && selectedVehicleId ? (
            <VehiclesWindowDetail
              vehicleId={selectedVehicleId}
              onDeleted={handleVehicleDeleted}
            />
          ) : currentView === 'create' ? (
            <VehiclesWindowNew
              onCreated={handleVehicleCreated}
              onCancel={handleBack}
            />
          ) : viewMode === 'list' ? (
            <VehiclesWindowList
              onSelectVehicle={handleSelectVehicle}
              onCreateVehicle={handleCreateVehicle}
              refreshToken={refreshToken}
              onRefresh={handleRefresh}
            />
          ) : (
            <div className="min-h-0 flex-1 p-3">
              <VehiclesManager />
            </div>
          )}
        </div>
        <WindowStatusBar>{statusText}</WindowStatusBar>
      </div>
    </FloatingWindow>
  );
}
