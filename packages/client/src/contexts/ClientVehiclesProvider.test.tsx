import type { VehiclesRuntimeProviderProps } from '@tearleads/app-vehicles';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientVehiclesProvider } from './ClientVehiclesProvider';

const mockCreateVehicleRepository = vi.fn();
const mockDb = { name: 'vehicles-db' };

let lastProviderProps: VehiclesRuntimeProviderProps | null = null;

vi.mock('@tearleads/app-vehicles', () => {
  return {
    createVehicleRepository: (db: unknown) => mockCreateVehicleRepository(db),
    VehiclesRuntimeProvider: (props: VehiclesRuntimeProviderProps) => {
      lastProviderProps = props;
      return (
        <div data-testid="vehicles-runtime-provider">{props.children}</div>
      );
    }
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    db: mockDb,
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

describe('ClientVehiclesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastProviderProps = null;
    mockCreateVehicleRepository.mockReturnValue({
      getVehicleById: vi.fn(async () => null),
      listVehicles: vi.fn(async () => []),
      createVehicle: vi.fn(async () => null),
      updateVehicle: vi.fn(async () => null),
      deleteVehicle: vi.fn(async () => false)
    });
  });

  it('renders children inside VehiclesRuntimeProvider', () => {
    render(
      <ClientVehiclesProvider>
        <div data-testid="child">Child content</div>
      </ClientVehiclesProvider>
    );

    expect(screen.getByTestId('vehicles-runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('passes database state and repository to the runtime provider', () => {
    render(
      <ClientVehiclesProvider>
        <div>Child</div>
      </ClientVehiclesProvider>
    );

    expect(mockCreateVehicleRepository).toHaveBeenCalledWith(mockDb);
    expect(lastProviderProps?.databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    expect(lastProviderProps?.repository).not.toBeNull();
  });
});
